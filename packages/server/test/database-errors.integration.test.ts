import type { SendInput } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { LISTENER_APPLICATION_NAME } from '../src/adapters/prisma/delivery-notices.js';
import { createApp } from '../src/app.js';
import type { Caller } from '../src/core/shared/caller.js';
import type { AppRouter } from '../src/index.js';
import { createUseCases } from '../src/wiring.js';
import { runServerCommand } from './support/commands.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createEmptyDatabase, createMigratedDatabase, prisma } from './support/database.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// A database error's message can carry what the request held: Postgres
// quotes values back. The log holds such an error by its codes only, so no
// request data reaches it. Here Postgres refuses every message with its
// payload in the error's words, as a failing constraint or cast would.

/** Makes Postgres refuse every row inserted into the table, quoting the column's value in its message. */
async function refuseInserts(database: PrismaClient, table: { name: string; column: string }): Promise<void> {
  // Both names are the constants of this file, never outside input.
  await database.$executeRawUnsafe(
    `CREATE FUNCTION refuse_${table.name}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused %', NEW.${table.column}; END $$ LANGUAGE plpgsql`,
  );
  await database.$executeRawUnsafe(
    `CREATE TRIGGER refuse_${table.name} BEFORE INSERT ON ${table.name} FOR EACH ROW EXECUTE FUNCTION refuse_${table.name}()`,
  );
}

/** A log line of a database error: its codes, and nothing of its message. */
const databaseFailureLine = z.object({
  msg: z.string(),
  database: z.object({ code: z.string().optional(), sqlState: z.string().optional(), kind: z.string().optional() }),
});

/** The database codes of the first line with this message, or undefined when no such line logged them. */
function databaseCodesIn(lines: Record<string, unknown>[], msg: string) {
  return lines.map((line) => databaseFailureLine.safeParse(line).data).find((line) => line?.msg === msg)?.database;
}

describe('a database error at the doors', () => {
  let databaseUrl: string;
  let database: PrismaClient;
  let argo: Caller;
  let server: FastifyInstance;
  let address: string;
  const logLines: string[] = [];

  beforeAll(async () => {
    databaseUrl = await createMigratedDatabase();
    database = createPrismaClient(databaseUrl);
    argo = operatorCaller(
      unwrap(await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).initialiseFleet({ name: 'home fleet', ...OPERATOR })),
    );
    await refuseInserts(database, { name: 'messages', column: 'payload' });
    server = createApp({
      databaseUrl,
      publicUrl: FLEET_URL,
      logger: { level: 'info', stream: { write: (line: string) => void logLines.push(line) } },
    });
    address = await server.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await server.close();
    await database.$disconnect();
  });

  /** A ship commissioned by argo and crewed through REST: its crew token. */
  async function crewToken(name: string): Promise<string> {
    const { shipId, prompt } = unwrap(
      await createUseCases({ prisma: database, fleetUrl: FLEET_URL }).commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }),
    );
    const response = await fetch(`${address}/api/v1/ship/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
    });
    return z.object({ crewToken: z.string() }).parse(await response.json()).crewToken;
  }

  function toArgoWith(payload: string): SendInput {
    return { selector: { kind: 'ship', name: 'argo' }, payload, contentType: 'text/plain', model: 'claude-opus-5-5', idempotencyKey: payload };
  }

  /** Every log line written since `from`, parsed. */
  function linesSince(from: number): Record<string, unknown>[] {
    return logLines.slice(from).map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
  }

  it('logs a failed send at /trpc by its codes, never its message', async () => {
    const from = logLines.length;
    const token = await crewToken('trpc-sender');
    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${address}/trpc`, headers: { authorization: `Bearer ${token}` } })],
    });

    await expect(client.ship.send.mutate(toArgoWith('trpc-payload-4f1c'))).rejects.toThrow('Internal error');

    expect(logLines.slice(from).join('\n')).not.toContain('trpc-payload-4f1c');
    // Prisma's code, and the Postgres code of the refusal (raise_exception).
    expect(databaseCodesIn(linesSince(from), 'procedure failed')).toMatchObject({ code: /^P\d{4}$/, sqlState: 'P0001' });
  });

  it('logs a failed send over REST by its codes, never its message', async () => {
    const from = logLines.length;
    const token = await crewToken('rest-sender');

    const response = await fetch(`${address}/api/v1/ship/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(toArgoWith('rest-payload-9a2e')),
    });

    expect(response.status).toBe(500);
    expect(logLines.slice(from).join('\n')).not.toContain('rest-payload-9a2e');
    // Prisma's code, and the Postgres code of the refusal (raise_exception).
    expect(databaseCodesIn(linesSince(from), 'procedure failed')).toMatchObject({ code: /^P\d{4}$/, sqlState: 'P0001' });
  });

  it('logs a failed send over MCP by its codes, never its message', async () => {
    const from = logLines.length;
    const token = await crewToken('mcp-sender');
    const client = new Client({ name: 'ship-session', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));

    try {
      const result = await client.callTool({ name: 'send', arguments: { crewToken: token, ...toArgoWith('mcp-payload-7d3b') } });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }

    expect(logLines.slice(from).join('\n')).not.toContain('mcp-payload-7d3b');
    // Prisma's code, and the Postgres code of the refusal (raise_exception).
    expect(databaseCodesIn(linesSince(from), 'procedure failed')).toMatchObject({ code: /^P\d{4}$/, sqlState: 'P0001' });
  });

  it('logs the delivery listener losing its connection by its codes, never its message', async () => {
    const from = logLines.length;
    const listenerPids = () => database.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE application_name = ${LISTENER_APPLICATION_NAME} AND datname = current_database()`;
    await expect.poll(listenerPids).toHaveLength(1);
    const listeners = await listenerPids();

    for (const { pid } of listeners) {
      await database.$queryRaw`SELECT pg_terminate_backend(${pid})`;
    }

    // Postgres's code for a connection ended by an administrator.
    await expect
      .poll(() => databaseCodesIn(linesSince(from), 'delivery listener lost its connection: listening again shortly'))
      .toMatchObject({ sqlState: '57P01' });
    expect(linesSince(from).find((line) => 'reason' in line)).toBeUndefined();
  });
});

describe('a database error in a server command', () => {
  it('reports it by its codes, never its message', async () => {
    const databaseUrl = await createEmptyDatabase();
    await prisma(databaseUrl, 'migrate', 'deploy');
    const database = createPrismaClient(databaseUrl);
    try {
      await refuseInserts(database, { name: 'operators', column: 'email' });
    } finally {
      await database.$disconnect();
    }

    const result = await runServerCommand({
      script: 'fleet:init',
      args: ['--name', 'home fleet'],
      answers: ['refused-operator@example.com', OPERATOR.password, OPERATOR.password],
      env: { DATABASE_URL: databaseUrl, PUBLIC_URL: FLEET_URL },
    });

    expect(result.code).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain('refused-operator@example.com');
    expect(result.stderr).toContain('P0001');
  });
});

describe('a database error in the health check', () => {
  it('is logged by its codes, never its message', async () => {
    const logLines: string[] = [];
    const unreachable = new URL(await createEmptyDatabase());
    unreachable.hostname = '127.0.0.1';
    unreachable.port = '1';
    const server = createApp({
      databaseUrl: unreachable.toString(),
      publicUrl: FLEET_URL,
      logger: { level: 'info', stream: { write: (line: string) => void logLines.push(line) } },
    });
    try {
      const response = await server.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(503);
    } finally {
      await server.close();
    }

    const lines = logLines.map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
    expect(databaseCodesIn(lines, 'health check failed')).toMatchObject({ code: 'P2010', kind: 'DatabaseNotReachable' });
    expect(lines.find((line) => line.msg === 'health check failed')).not.toHaveProperty('reason');
  });
});
