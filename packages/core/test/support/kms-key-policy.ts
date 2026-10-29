/**
 * The company's key policy in front of LocalStack's KMS. LocalStack without a
 * licence keeps no key policy and no grant: every call is allowed. This proxy
 * answers a call naming a key whose grant the company took away as AWS KMS
 * does, AccessDeniedException in the KMS JSON protocol, and passes every other
 * call on untouched, so the AWS KMS adapter meets the refusal over the wire.
 * It answers the same for a key bound to one fleet, as a key policy with a
 * condition on the encryption context does (decision 0068, B3), when a call
 * names another fleet's context. It can also hold a key's calls unanswered,
 * as a KMS that does not answer.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';

import { z } from 'zod';

const KMS_JSON = 'application/x-amz-json-1.1';
const BAD_REQUEST = 400;

const FLEET_CONTEXT_KEY = 'aeolus:fleet';

const contextSchema = z.record(z.string(), z.string()).optional();

/** The fields of a KMS request that name a key, and the encryption contexts it carries. */
const keyFieldsSchema = z.object({
  KeyId: z.string().optional(),
  SourceKeyId: z.string().optional(),
  DestinationKeyId: z.string().optional(),
  EncryptionContext: contextSchema,
  SourceEncryptionContext: contextSchema,
  DestinationEncryptionContext: contextSchema,
});

export interface KmsKeyPolicy {
  /** Where the adapter reaches the KMS through the policy. */
  readonly endpoint: string;
  refuseGrant(companyKey: string): void;
  /** Grants the key for this fleet's encryption context alone. */
  bindToFleet(companyKey: string, fleetId: string): void;
  /** Leaves every call naming the key unanswered. */
  holdCalls(companyKey: string): void;
  close(): Promise<void>;
}

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

interface Named {
  keys: string[];
  /** The fleet ids the call's encryption contexts name. */
  fleets: (string | undefined)[];
}

function namedIn(body: Buffer): Named {
  const parsed = keyFieldsSchema.safeParse(JSON.parse(body.toString('utf8')));
  if (!parsed.success) {
    return { keys: [], fleets: [] };
  }
  const { data } = parsed;
  return {
    keys: [data.KeyId, data.SourceKeyId, data.DestinationKeyId].filter((key) => key !== undefined),
    fleets: [data.EncryptionContext, data.SourceEncryptionContext, data.DestinationEncryptionContext]
      .filter((context) => context !== undefined)
      .map((context) => context[FLEET_CONTEXT_KEY]),
  };
}

function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string' && name !== 'host' && name !== 'content-length') {
      headers.set(name, value);
    }
  }
  return headers;
}

export async function startKmsKeyPolicy(kmsEndpoint: string): Promise<KmsKeyPolicy> {
  const refused = new Set<string>();
  const held = new Set<string>();
  const bound = new Map<string, string>();
  const isOutsideItsFleet = ({ keys, fleets }: Named): boolean =>
    keys.some((key) => {
      const fleetId = bound.get(key);
      return fleetId !== undefined && fleets.some((named) => named !== fleetId);
    });

  const server: Server = createServer((request, response) => {
    void (async () => {
      const body = await bodyOf(request);
      const named = namedIn(body);
      if (named.keys.some((key) => held.has(key))) {
        return;
      }
      if (named.keys.some((key) => refused.has(key)) || isOutsideItsFleet(named)) {
        response.writeHead(BAD_REQUEST, { 'content-type': KMS_JSON });
        response.end(JSON.stringify({ __type: 'AccessDeniedException', message: 'The key policy does not grant the installation this key.' }));
        return;
      }
      const answer = await fetch(new URL(request.url ?? '/', kmsEndpoint), { method: request.method, headers: headersOf(request), body });
      response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? KMS_JSON });
      response.end(Buffer.from(await answer.arrayBuffer()));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The KMS key policy proxy listens on no TCP port.');
  }
  const { port } = address;

  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    refuseGrant: (companyKey) => {
      refused.add(companyKey);
    },
    bindToFleet: (companyKey, fleetId) => {
      bound.set(companyKey, fleetId);
    },
    holdCalls: (companyKey) => {
      held.add(companyKey);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => { resolve(); });
      }),
  };
}
