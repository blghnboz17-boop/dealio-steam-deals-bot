import type { AdminQueryService } from '../application/admin/admin-query-service.js';
import { AdminHttpError, type AdminRoute } from './admin-server.js';
import type { LogBuffer } from './log-buffer.js';

export interface AdminRouteDependencies {
  readonly query: AdminQueryService;
  readonly logs: LogBuffer;
}

const discordId = /^\d{5,25}$/;

export function requireDiscordId(value: string | undefined): string {
  if (value === undefined || !discordId.test(value)) throw new AdminHttpError(400, 'Invalid Discord ID');
  return value;
}

export function readRoutes({ query, logs }: AdminRouteDependencies): AdminRoute[] {
  return [
    { method: 'GET', path: '/api/overview', handler: async () => ({ json: await query.overview() }) },
    { method: 'GET', path: '/api/users', handler: () => ({ json: query.users() }) },
    {
      method: 'GET',
      path: '/api/users/:id',
      handler: async ({ params }) => {
        const user = await query.user(requireDiscordId(params.id));
        if (!user) throw new AdminHttpError(404, 'User not found');
        return { json: user };
      },
    },
    {
      method: 'GET',
      path: '/api/profiles',
      handler: async ({ query: search }) => {
        const ids = (search.get('ids') ?? '').split(',').filter((id) => discordId.test(id));
        return { json: { profiles: await query.profiles(ids) } };
      },
    },
    { method: 'GET', path: '/api/guilds', handler: async () => ({ json: await query.guilds() }) },
    { method: 'GET', path: '/api/games', handler: () => ({ json: query.games() }) },
    { method: 'GET', path: '/api/system', handler: () => ({ json: query.system() }) },
    {
      method: 'GET',
      path: '/api/logs',
      handler: ({ query: search }) => ({ json: { entries: logs.list(Number(search.get('after') ?? 0) || 0) } }),
    },
    {
      method: 'GET',
      path: '/api/logs/stream',
      stream: (_request, response) => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Connection', 'keep-alive');
        response.write(': connected\n\n');
        const unsubscribe = logs.subscribe((entry) => {
          response.write(`id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`);
        });
        const keepAlive = setInterval(() => response.write(': ping\n\n'), 25_000);
        keepAlive.unref();
        response.on('close', () => {
          clearInterval(keepAlive);
          unsubscribe();
        });
      },
    },
  ];
}
