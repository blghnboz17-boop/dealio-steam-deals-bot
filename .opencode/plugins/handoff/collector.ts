import { isSafeRelativePath, sanitizeRelativePath } from "./redaction.js";
import type { TodoStatus } from "./schema.js";
import { safeIdentifier } from './durable-values.js';

const MAX_TODOS = 100;
const MAX_MESSAGES = 50;
const MAX_PATHS = 200;

type SessionReadOptions = {
  readonly path: { readonly id: string };
  readonly query: { readonly directory: string; readonly limit?: number };
  readonly signal: AbortSignal;
};

type SessionReadResult = {
  readonly data: unknown;
  readonly error: unknown;
};

export type SessionReadClient = {
  readonly session: {
    readonly todo: (options: SessionReadOptions) => Promise<SessionReadResult>;
    readonly messages: (options: SessionReadOptions) => Promise<SessionReadResult>;
    readonly diff: (options: SessionReadOptions) => Promise<SessionReadResult>;
  };
};

export type SessionTokenCounts = {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
};

export type SanitizedTodo = {
  readonly id: string;
  readonly summary: string;
  readonly status: TodoStatus;
  readonly evidencePaths: readonly string[];
};

export type CollectedSessionSnapshot = {
  readonly todos: readonly SanitizedTodo[];
  readonly changedPaths: readonly string[];
  readonly messageIds: readonly string[];
  readonly tokens: SessionTokenCounts;
  readonly redaction: {
    readonly fields: number;
    readonly values: number;
    readonly paths: number;
    readonly truncated: number;
  };
};

export type SessionCollectionResult =
  | { readonly kind: "collected"; readonly snapshot: CollectedSessionSnapshot }
  | { readonly kind: "unavailable"; readonly reason: "queue-timeout" | "sdk-read-failed"; readonly uncertainty: readonly ["history-not-reconstructed"] };

export type SessionCollectionInput = {
  readonly client: SessionReadClient;
  readonly directory: string;
  readonly sessionId: string;
  readonly timeoutMs: number;
};

type PropertyBag = { readonly [key: string]: unknown };

function isPropertyBag(value: unknown): value is PropertyBag {
  return typeof value === "object" && value !== null;
}

function safeCounter(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseTodoStatus(value: unknown): TodoStatus | null {
  switch (value) {
    case "pending":
    case "in_progress":
    case "completed":
    case "cancelled":
      return value;
    default:
      return null;
  }
}

function parseTodos(value: unknown): { readonly todos: readonly SanitizedTodo[]; readonly values: number; readonly truncated: number } | null {
  if (!Array.isArray(value)) return null;
  const todos: SanitizedTodo[] = [];
  let values = 0;
  let truncated = value.length > MAX_TODOS ? 1 : 0;
  for (const candidate of value.slice(0, MAX_TODOS)) {
    if (!isPropertyBag(candidate) || typeof candidate["id"] !== "string") return null;
    if (typeof candidate["content"] !== "string") return null;
    const status = parseTodoStatus(candidate["status"]);
    if (status === null) return null;
    todos.push({
      id: safeIdentifier(candidate["id"]),
      summary: todoSummary(status),
      status,
      evidencePaths: [],
    });
  }
  return { todos, values, truncated };
}

function todoSummary(status: TodoStatus): string {
  switch (status) {
    case 'pending': return 'Todo pending';
    case 'in_progress': return 'Todo in progress';
    case 'completed': return 'Todo completed';
    case 'cancelled': return 'Todo cancelled';
  }
}

function addTokenCounts(total: SessionTokenCounts, candidate: PropertyBag): SessionTokenCounts | null {
  const cache = candidate["cache"];
  if (!isPropertyBag(cache)) return null;
  const input = safeCounter(candidate["input"]);
  const output = safeCounter(candidate["output"]);
  const reasoning = safeCounter(candidate["reasoning"]);
  const cacheRead = safeCounter(cache["read"]);
  const cacheWrite = safeCounter(cache["write"]);
  if (input === null || output === null || reasoning === null || cacheRead === null || cacheWrite === null) return null;
  const sums = [total.input + input, total.output + output, total.reasoning + reasoning, total.cacheRead + cacheRead, total.cacheWrite + cacheWrite];
  if (!sums.every(Number.isSafeInteger)) return null;
  return { input: sums[0] ?? 0, output: sums[1] ?? 0, reasoning: sums[2] ?? 0, cacheRead: sums[3] ?? 0, cacheWrite: sums[4] ?? 0 };
}

function parseMessages(value: unknown): { readonly messageIds: readonly string[]; readonly tokens: SessionTokenCounts } | null {
  if (!Array.isArray(value)) return null;
  const messageIds: string[] = [];
  let tokens: SessionTokenCounts = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  for (const candidate of value.slice(0, MAX_MESSAGES)) {
    if (!isPropertyBag(candidate) || !isPropertyBag(candidate["info"])) return null;
    const info = candidate["info"];
    if (typeof info["id"] !== "string") return null;
    messageIds.push(safeIdentifier(info["id"]));
    if (info["role"] === "assistant") {
      if (!isPropertyBag(info["tokens"])) return null;
      const next = addTokenCounts(tokens, info["tokens"]);
      if (next === null) return null;
      tokens = next;
    }
  }
  return { messageIds: [...new Set(messageIds)], tokens };
}

function parsePaths(root: string, value: unknown): { readonly paths: readonly string[]; readonly rejected: number } | null {
  if (!Array.isArray(value)) return null;
  const paths = new Set<string>();
  let rejected = value.length > MAX_PATHS ? value.length - MAX_PATHS : 0;
  for (const candidate of value.slice(0, MAX_PATHS)) {
    if (!isPropertyBag(candidate) || typeof candidate["file"] !== "string") return null;
    const path = sanitizeRelativePath(root, candidate["file"]);
    if (path === null || !isSafeRelativePath(path)) rejected += 1;
    else paths.add(path);
  }
  return { paths: [...paths].sort(), rejected };
}

async function boundedReads(input: SessionCollectionInput): Promise<"timeout" | readonly PromiseSettledResult<SessionReadResult>[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), input.timeoutMs);
  });
  const options = { path: { id: input.sessionId }, query: { directory: input.directory }, signal: controller.signal };
  const todoOptions = { ...options, query: { ...options.query, limit: MAX_TODOS } };
  const messagesOptions = { ...options, query: { ...options.query, limit: MAX_MESSAGES } };
  const diffOptions = { ...options, query: { ...options.query, limit: MAX_PATHS } };
  const reads = Promise.allSettled([
    Promise.resolve().then(() => input.client.session.todo(todoOptions)),
    Promise.resolve().then(() => input.client.session.messages(messagesOptions)),
    Promise.resolve().then(() => input.client.session.diff(diffOptions)),
  ]);
  const result = await Promise.race([reads, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (result === "timeout") controller.abort();
  return result;
}

export async function collectSessionSnapshot(input: SessionCollectionInput): Promise<SessionCollectionResult> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) return { kind: "unavailable", reason: "queue-timeout", uncertainty: ["history-not-reconstructed"] };
  const results = await boundedReads(input);
  if (results === "timeout") return { kind: "unavailable", reason: "queue-timeout", uncertainty: ["history-not-reconstructed"] };
  if (results.some((result) => result.status === "rejected")) return { kind: "unavailable", reason: "sdk-read-failed", uncertainty: ["history-not-reconstructed"] };
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<SessionReadResult> => result.status === "fulfilled");
  const todoResult = fulfilled[0];
  const messageResult = fulfilled[1];
  const diffResult = fulfilled[2];
  if (todoResult === undefined || messageResult === undefined || diffResult === undefined) return { kind: "unavailable", reason: "sdk-read-failed", uncertainty: ["history-not-reconstructed"] };
  if (todoResult.value.error !== undefined || messageResult.value.error !== undefined || diffResult.value.error !== undefined) return { kind: "unavailable", reason: "sdk-read-failed", uncertainty: ["history-not-reconstructed"] };
  const todos = parseTodos(todoResult.value.data);
  const messages = parseMessages(messageResult.value.data);
  const paths = parsePaths(input.directory, diffResult.value.data);
  if (todos === null || messages === null || paths === null) return { kind: "unavailable", reason: "sdk-read-failed", uncertainty: ["history-not-reconstructed"] };
  return {
    kind: "collected",
    snapshot: {
      todos: todos.todos,
      changedPaths: paths.paths,
      messageIds: messages.messageIds,
      tokens: messages.tokens,
      redaction: { fields: todos.todos.length, values: todos.values, paths: paths.rejected, truncated: todos.truncated },
    },
  };
}
