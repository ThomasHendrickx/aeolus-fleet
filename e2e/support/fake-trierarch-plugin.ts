import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * The trierarch plugin as the console meets it in the end-to-end tests:
 * connected, one machine that reports Claude Code with two models, the
 * fleet's enabled models kept in memory with models.list, models.enable and
 * models.disable answering them (decision 0063), and every crew settings
 * check fitting. Its tRPC answers have the plugin's shape, so the console
 * parses them as it parses the real one's.
 */

export interface FakeTrierarchPlugin {
  url: string;
  /** The fleet's enabled models as the plugin holds them now. */
  enabledModels(): readonly string[];
  stop(): Promise<void>;
}

/** The models the one machine's Claude Code reports, its default first. */
export const REPORTED_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const;

const MACHINE = {
  shipId: 'shp_01j9k2t4qzr3a9w6m2v5n7trmc',
  name: 'trierarch-mac',
  status: 'crewed',
  lastSeenAt: new Date().toISOString(),
  isSilent: false,
  report: null,
  details: {
    harnesses: [{ harness: 'claude-code', options: { type: 'object', properties: { model: { enum: REPORTED_MODELS, default: REPORTED_MODELS[0] } }, additionalProperties: false }, flags: [] }],
    workspaces: { repositories: ['aeolus-fleet'], folders: [] },
    caps: { ships: 4, running: 2 },
    kept: [],
    orphans: [],
    version: '0.32.0',
  },
};

function answer(response: ServerResponse, data: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ result: { data } }));
}

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
  }
  return JSON.parse(body);
}

function modelOf(input: unknown): string {
  return typeof input === 'object' && input !== null && 'model' in input && typeof input.model === 'string' ? input.model : '';
}

export async function startFakeTrierarchPlugin(): Promise<FakeTrierarchPlugin> {
  const enabled = new Set<string>();
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      switch (path) {
        case '/api/version':
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ trierarchPlugin: '0.32.0' }));
          return;
        case '/trpc/connection.status':
          answer(response, { enabled: true, state: 'connected', ship: null, lastShipId: null });
          return;
        case '/trpc/machines.list':
          answer(response, [MACHINE]);
          return;
        case '/trpc/requests.check':
          answer(response, { kind: 'fits' });
          return;
        case '/trpc/models.list':
          answer(response, [...enabled]);
          return;
        case '/trpc/models.enable':
          enabled.add(modelOf(await bodyOf(request)));
          answer(response, [...enabled]);
          return;
        case '/trpc/models.disable':
          enabled.delete(modelOf(await bodyOf(request)));
          answer(response, [...enabled]);
          return;
        default:
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: `No procedure ${path}` } }));
      }
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const bound = server.address();
  if (bound === null || typeof bound === 'string') {
    throw new Error('the fake trierarch plugin listens on no port');
  }
  return {
    url: `http://127.0.0.1:${String(bound.port)}`,
    enabledModels: () => [...enabled],
    stop: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}
