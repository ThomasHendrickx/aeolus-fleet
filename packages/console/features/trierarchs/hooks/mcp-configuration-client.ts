import type { McpConfiguration, McpReplacement, McpServer } from '../services/mcp-configuration';

/** Only the existing console door is used. No retries, request logging or value-bearing errors. */
export type McpSaveResult =
  | { kind: 'saved'; version: number }
  | { kind: 'stale' }
  | { kind: 'no-answer' }
  | { kind: 'body-too-large' }
  | { kind: 'refused'; message: string };
const NO_ANSWER = 'The trierarch plugin did not answer: read mcp.get before replacing again';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function resultData(value: unknown): unknown {
  return isRecord(value) && isRecord(value.result) ? value.result.data : undefined;
}
function errorMessage(value: unknown): string {
  return isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string' ? value.error.message : NO_ANSWER;
}
function isServer(value: unknown): value is McpServer {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.url === 'string' &&
    Array.isArray(value.tools) &&
    value.tools.every((tool: unknown) => typeof tool === 'string') &&
    (value.credential === undefined ||
      (isRecord(value.credential) && typeof value.credential.header === 'string' && typeof value.credential.secret === 'string'))
  );
}
function isConfiguration(value: unknown): value is McpConfiguration {
  return (
    isRecord(value) &&
    typeof value.version === 'number' &&
    Number.isSafeInteger(value.version) &&
    value.version >= 0 &&
    Array.isArray(value.servers) &&
    value.servers.every(isServer) &&
    Array.isArray(value.secrets) &&
    value.secrets.every((secret: unknown) => typeof secret === 'string')
  );
}

export async function readMcpConfiguration(fetchImplementation: typeof fetch = fetch): Promise<McpConfiguration> {
  const response = await fetchImplementation('/api/trierarch-plugin/mcp.get', { cache: 'no-store' });
  const answer: unknown = await response.json();
  if (!response.ok) throw new Error(errorMessage(answer));
  const data = resultData(answer);
  if (!isConfiguration(data)) throw new Error('The trierarch plugin answered with an invalid MCP configuration');
  // Project metadata explicitly: unexpected fields can never enter the query cache.
  return {
    version: data.version,
    servers: data.servers.map(({ name, url, tools, credential }) => ({
      name,
      url,
      tools,
      ...(credential === undefined ? {} : { credential: { header: credential.header, secret: credential.secret } }),
    })),
    secrets: data.secrets,
  };
}

export async function replaceMcpConfiguration(input: McpReplacement, fetchImplementation: typeof fetch = fetch): Promise<McpSaveResult> {
  try {
    const response = await fetchImplementation('/api/trierarch-plugin/mcp.replace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (response.status === 409) return { kind: 'stale' };
    if (response.status === 413) return { kind: 'body-too-large' };
    if (response.status === 502) return { kind: 'no-answer' };
    const answer: unknown = await response.json();
    if (!response.ok) return { kind: 'refused', message: errorMessage(answer) };
    const data = resultData(answer);
    return isRecord(data) && typeof data.version === 'number' && Number.isSafeInteger(data.version) && data.version > 0
      ? { kind: 'saved', version: data.version }
      : { kind: 'no-answer' };
  } catch {
    return { kind: 'no-answer' };
  }
}
