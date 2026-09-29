import type { FleetId, ShipId } from '@aeolus-fleet/common';

import { issueShipSecret, type CredentialTx, type SecretTools } from '../identity/public.js';
import { recordEvent, type Actor, type EventLog } from '../shared/events.js';

/**
 * The starting prompt: the text the operator pastes into a new session to crew
 * a ship (docs/blueprint.md, "Launch a ship"). It holds the ship's secret, so
 * it is shown once and never stored.
 */

/** A placeholder until the real text, with how to use the ship contract, is drafted (build plan, slice 8). */
export function startingPromptText(input: { fleetUrl: string; shipId: ShipId; secret: string }): string {
  return [
    'You crew a ship in an Aeolus fleet.',
    '',
    `Fleet URL: ${input.fleetUrl}`,
    `Ship id: ${input.shipId}`,
    `Ship secret: ${input.secret}`,
    '',
    'This is a placeholder starting prompt: how to use the ship contract comes later.',
  ].join('\n');
}

export interface StartingPromptTx extends CredentialTx {
  events: EventLog;
}

/** What issuing a starting prompt works with: the caller's unit of work, the secret tools and where ships reach the fleet. */
export interface StartingPromptDeps {
  tx: StartingPromptTx;
  secrets: SecretTools;
  fleetUrl: string;
}

/**
 * Issues a new secret for the ship and writes StartingPromptIssued. The caller
 * invalidates any earlier secret first. Returns the prompt: the one moment the
 * secret exists in plain text.
 */
export async function issueStartingPrompt(
  deps: StartingPromptDeps,
  input: { fleetId: FleetId; shipId: ShipId; actor: Actor; at: Date },
): Promise<string> {
  const { tx, secrets, fleetUrl } = deps;
  const { fleetId, shipId, actor, at } = input;

  const { secret, credentialId } = await issueShipSecret({ tx, ...secrets }, { fleetId, shipId, at });
  await recordEvent({ events: tx.events, ids: secrets.ids }, {
    fleetId,
    type: 'StartingPromptIssued',
    occurredAt: at,
    actor,
    shipId,
    details: { credentialId },
  });
  return startingPromptText({ fleetUrl, shipId, secret });
}
