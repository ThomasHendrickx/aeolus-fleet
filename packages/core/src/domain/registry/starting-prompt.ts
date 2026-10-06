import type { FleetId, ShipId } from '@aeolus-fleet/common';

import { issueShipSecret, type CredentialTx, type SecretTools } from '../identity/public.js';
import { recordEvent, type Actor, type EventLog } from '../shared/events.js';

/**
 * A starting prompt as a use case hands it out: the ship and its new secret,
 * in plain text only here and once. How it reads (the prompt text, one crew
 * line per harness) is presentation, done by the adapters
 * (adapters/trpc/starting-prompt-text.ts); core never formats it.
 */
export interface IssuedStartingPrompt {
  shipId: ShipId;
  secret: string;
}

export interface StartingPromptTx extends CredentialTx {
  events: EventLog;
}

/** What issuing a starting prompt works with: the caller's unit of work and the secret tools. */
export interface StartingPromptDeps {
  tx: StartingPromptTx;
  secrets: SecretTools;
}

/**
 * Issues a new secret for the ship and writes StartingPromptIssued. The caller
 * invalidates any earlier secret first. Returns the secret: the one moment it
 * exists in plain text.
 */
export async function issueStartingPrompt(
  deps: StartingPromptDeps,
  input: { fleetId: FleetId; shipId: ShipId; actor: Actor; at: Date },
): Promise<IssuedStartingPrompt> {
  const { tx, secrets } = deps;
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
  return { shipId, secret };
}
