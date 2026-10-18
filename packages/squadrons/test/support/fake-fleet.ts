import { createServer } from 'node:http';

/** The fleet's refusal while every pool connection is taken: nothing was stored (#542). */
export const BUSY = { status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: 'The fleet is busy; nothing was stored. Make the same call again (for send, with the same idempotency key).' } };

/** One call a fleet received: its path, its headers and body, and when it came. */
export interface Asked {
  url: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: string;
  at: number;
}

/** A fleet that answers each call with the next of `answers`, the last one again once they run out, and records each call. */
export async function aFleetAnswering(answers: readonly { status: number; body: unknown }[], run: (fleetUrl: string, asked: Asked[]) => Promise<void>): Promise<void> {
  const asked: Asked[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      asked.push({ url: request.url ?? '', headers: request.headers, body, at: Date.now() });
      const answer = answers[Math.min(asked.length, answers.length) - 1] ?? BUSY;
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${String(port)}`, asked);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

