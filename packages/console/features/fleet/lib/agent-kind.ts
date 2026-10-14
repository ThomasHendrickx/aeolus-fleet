import type { ListedShip } from '@aeolus-fleet/common';

/**
 * What sort of agent crews a ship, for the overview's Kind filter (idea
 * #401), read from what the fleet already knows rather than a stored field:
 * argo and the viewer ship are the console, a ship a console plugin runs as is
 * a plugin, a ship of type trierarch is a machine's trierarch (decision 0026),
 * and any other ship is what its crewing session's harness says (decision
 * 0018). A ship no session crews states no harness, so it is other.
 */
export const AGENT_KINDS = ['console', 'claudeCode', 'codex', 'trierarch', 'plugin', 'other'] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_KIND_WORDS: Record<AgentKind, string> = {
  console: 'Console',
  claudeCode: 'Claude Code',
  codex: 'Codex',
  trierarch: 'Trierarch',
  plugin: 'Plugin',
  other: 'Other',
};

const TRIERARCH_TYPE = 'trierarch';

const HARNESS_KINDS: Readonly<Record<string, AgentKind>> = { 'claude-code': 'claudeCode', codex: 'codex' };

/** A ship's kind; `pluginShipIds` are the ships the console's plugins run as (#368). */
export function agentKindOf(ship: Pick<ListedShip, 'id' | 'kind' | 'type' | 'harness'>, pluginShipIds: ReadonlySet<string>): AgentKind {
  if (ship.kind === 'operator' || ship.kind === 'viewer') {
    return 'console';
  }
  if (pluginShipIds.has(ship.id)) {
    return 'plugin';
  }
  if (ship.type === TRIERARCH_TYPE) {
    return 'trierarch';
  }
  return (ship.harness === null ? undefined : HARNESS_KINDS[ship.harness]) ?? 'other';
}

export function isAgentKind(value: string | null): value is AgentKind {
  return AGENT_KINDS.some((kind) => kind === value);
}
