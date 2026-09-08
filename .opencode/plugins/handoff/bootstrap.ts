import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitState } from "./git-state.js";
import { createNodeResumeReaders, validateResume } from "./resume.js";
import { parseHandoffJson, type HandoffState } from "./schema.js";

export type BootstrapResult =
  | { readonly kind: "baseline"; readonly revisionBase: number }
  | { readonly kind: "preserved"; readonly authority: HandoffState; readonly revisionBase: number }
  | { readonly kind: "unsafe" };

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export async function loadBootstrapState(input: {
  readonly worktree: string;
  readonly handoffDirectory: string;
  readonly collectGitState: () => Promise<GitState>;
}): Promise<BootstrapResult> {
  try {
    const initial = parseHandoffJson(await readFile(join(input.handoffDirectory, "BACKTO.json"), "utf8"));
    if (initial.status !== "active" && initial.status !== "blocked") {
      return { kind: "baseline", revisionBase: initial.revision };
    }
    let stableAuthority: HandoffState | undefined;
    const nodeReaders = createNodeResumeReaders(input.worktree);
    const validation = await validateResume({
      readers: {
        ...nodeReaders,
        readAuthoritativeJson: async () => {
          const serialized = await nodeReaders.readAuthoritativeJson();
          stableAuthority = parseHandoffJson(serialized);
          return serialized;
        },
      },
      collectCurrentGitState: input.collectGitState,
    });
    if (validation.status !== "safe-to-resume" || stableAuthority === undefined) return { kind: "unsafe" };
    return { kind: "preserved", authority: stableAuthority, revisionBase: stableAuthority.revision };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "baseline", revisionBase: 0 };
    return { kind: "unsafe" };
  }
}
