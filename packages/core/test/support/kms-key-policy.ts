/**
 * The company's key policy in front of LocalStack's KMS. LocalStack without a
 * licence keeps no key policy and no grant: every call is allowed. This proxy
 * answers a call naming a key whose grant the company took away as AWS KMS
 * does, AccessDeniedException in the KMS JSON protocol, and passes every other
 * call on untouched, so the AWS KMS adapter meets the refusal over the wire.
 * It can also hold a key's calls unanswered, as a KMS that does not answer.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';

import { z } from 'zod';

const KMS_JSON = 'application/x-amz-json-1.1';
const BAD_REQUEST = 400;

/** The fields of a KMS request that name a key. */
const keyFieldsSchema = z.object({
  KeyId: z.string().optional(),
  SourceKeyId: z.string().optional(),
  DestinationKeyId: z.string().optional(),
});

export interface KmsKeyPolicy {
  /** Where the adapter reaches the KMS through the policy. */
  readonly endpoint: string;
  refuseGrant(companyKey: string): void;
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

function keysNamed(body: Buffer): string[] {
  const parsed = keyFieldsSchema.safeParse(JSON.parse(body.toString('utf8')));
  if (!parsed.success) {
    return [];
  }
  return [parsed.data.KeyId, parsed.data.SourceKeyId, parsed.data.DestinationKeyId].filter((key) => key !== undefined);
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

  const server: Server = createServer((request, response) => {
    void (async () => {
      const body = await bodyOf(request);
      const named = keysNamed(body);
      if (named.some((key) => held.has(key))) {
        return;
      }
      if (named.some((key) => refused.has(key))) {
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
