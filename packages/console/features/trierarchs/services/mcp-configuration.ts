/** The metadata read and whole replacements of the fleet's bounded MCP set (#1735). */
import type { McpConfiguration, McpServer } from '../../../lib/trierarch-plugin-mcp-schemas';
export type { McpConfiguration, McpServer } from '../../../lib/trierarch-plugin-mcp-schemas';

export interface McpReplacement {
  readonly expectedVersion: number;
  readonly servers: readonly McpServer[];
  readonly secrets: readonly string[];
  readonly secretValues: Readonly<Record<string, string>>;
}
export type McpChange =
  | { readonly kind: 'server'; readonly originalName: string | undefined; readonly server: McpServer; readonly secretValues: Readonly<Record<string, string>> }
  | { readonly kind: 'remove-server'; readonly name: string }
  | { readonly kind: 'remove-secret'; readonly name: string }
  | { readonly kind: 'value'; readonly name: string; readonly value: string };

/** Rebase only the requested change onto the latest read, retaining all other entries. */
export function replacementFor(configuration: McpConfiguration, change: McpChange): McpReplacement {
  const base = { expectedVersion: configuration.version, servers: configuration.servers, secrets: configuration.secrets, secretValues: {} };
  switch (change.kind) {
    case 'server': {
      const hasOriginal = configuration.servers.some((server) => server.name === change.originalName);
      const servers = hasOriginal
        ? configuration.servers.map((server) => (server.name === change.originalName ? change.server : server))
        : [...configuration.servers, change.server];
      return { ...base, servers, secrets: [...new Set([...configuration.secrets, ...Object.keys(change.secretValues)])], secretValues: change.secretValues };
    }
    case 'remove-server':
      return { ...base, servers: configuration.servers.filter((server) => server.name !== change.name) };
    case 'remove-secret':
      return { ...base, secrets: configuration.secrets.filter((secret) => secret !== change.name) };
    case 'value':
      return { ...base, secretValues: { [change.name]: change.value } };
  }
}

/** What the open form says after an unsuccessful replacement. */
export type McpSaveError =
  | { kind: 'refused'; message: string }
  | { kind: 'stale'; version: number }
  | { kind: 'no-answer' }
  | { kind: 'read-failed'; message: string }
  | { kind: 'body-too-large' };
