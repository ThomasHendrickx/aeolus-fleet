/** The fact kept on a plugin ship when core records counted reads. */
import type { PluginReads, RecordPluginReadInput } from '@aeolus-fleet/common';

import type { Actor, NewEvent } from '../shared/events.js';
import type { Ship } from './ship.js';

export const NO_PLUGIN_READS: PluginReads = { lastFailed: null, lastGood: null, failingSince: null };

export function isActivePlugin(ship: Ship | undefined): ship is Ship {
  return ship?.kind === 'plugin' && ship.retiredAt === null;
}

export function applyPluginRead(
  ship: Ship,
  input: { read: RecordPluginReadInput; at: Date; actor: Actor },
): { pluginReads: PluginReads; event: NewEvent | null } {
  const { read, at, actor } = input;
  const current = ship.pluginReads ?? NO_PLUGIN_READS;
  const observation = { at: at.toISOString(), read: read.read };
  const event = { fleetId: ship.fleetId, shipId: ship.id, occurredAt: at, actor };

  if (read.outcome === 'failed') {
    const failure = { ...observation, reason: read.reason };
    return {
      pluginReads: { ...current, lastFailed: failure, failingSince: current.failingSince ?? failure },
      event: current.failingSince === null
        ? { ...event, type: 'PluginReadFailed', details: { read: read.read, reason: read.reason } }
        : null,
    };
  }

  return {
    pluginReads: { ...current, lastGood: observation, failingSince: null },
    event: current.failingSince === null
      ? null
      : { ...event, type: 'PluginReadRecovered', details: { read: read.read, reason: current.failingSince.reason } },
  };
}
