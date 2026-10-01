import type { FleetId, ShipId } from '@aeolus-fleet/common';

import { issueShipSecret, type CredentialTx, type SecretTools } from '../identity/public.js';
import { recordEvent, type Actor, type EventLog } from '../shared/events.js';

/**
 * The starting prompt: the text the operator pastes into a new session to crew
 * a ship (docs/blueprint.md, "Launch a ship"). It holds the ship's secret, so
 * it is shown once and never stored.
 */

/**
 * The starting prompt's text: identity only. Where the fleet's MCP server is
 * and how to add it, the ship's id and secret, how to pick the location, and
 * to call register. The protocol comes from the fleet when the session
 * connects, and each call's rules from its description; what the ship works
 * on, the operator adds.
 */
export function startingPromptText(input: { mcpUrl: string; shipId: ShipId; secret: string }): string {
  const { mcpUrl, shipId, secret } = input;
  return [
    'You crew a ship in an Aeolus fleet.',
    '',
    `Fleet MCP URL: ${mcpUrl}`,
    `Ship id: ${shipId}`,
    `Ship secret: ${secret}`,
    '',
    "Its tools come from the fleet's MCP server at that URL. If this session has none of them, add the server with this command, then start the session again with this prompt:",
    `claude mcp add --transport http --scope user aeolus ${mcpUrl}`,
    '',
    'Your location is where this session runs:',
    "- DEVICE: a personal computer, such as the operator's laptop",
    '- CLOUD: a hosted agent service, such as Claude Code on the web',
    '- SERVER: a server the operator runs, such as a VPS',
    '- OTHER: none of these, with a few words on where you run',
    '',
    'Call register.',
  ].join('\n');
}

/**
 * The crew line: the same identity in one line, for a Claude Code session
 * with the aeolus plugin, which registers and keeps the crew token itself.
 * The fleet URL is where the plugin reaches the fleet; it finds the MCP
 * server and REST under it.
 */
export function crewLine(input: { fleetUrl: string; shipId: ShipId; secret: string }): string {
  return `/aeolus:crew ${input.fleetUrl} ${input.shipId} ${input.secret}`;
}

/** A starting prompt as a use case hands it out: once. */
export interface IssuedStartingPrompt {
  shipId: ShipId;
  /** The starting prompt, holding the ship's secret in plain text only here. */
  prompt: string;
  /** The crew line for the aeolus plugin, holding the same secret. */
  crewLine: string;
}

export interface StartingPromptTx extends CredentialTx {
  events: EventLog;
}

/** What issuing a starting prompt works with: the caller's unit of work, the secret tools and the fleet's URLs. */
export interface StartingPromptDeps {
  tx: StartingPromptTx;
  secrets: SecretTools;
  mcpUrl: string;
  fleetUrl: string;
}

/**
 * Issues a new secret for the ship and writes StartingPromptIssued. The caller
 * invalidates any earlier secret first. Returns the prompt and the crew line:
 * the one moment the secret exists in plain text.
 */
export async function issueStartingPrompt(
  deps: StartingPromptDeps,
  input: { fleetId: FleetId; shipId: ShipId; actor: Actor; at: Date },
): Promise<IssuedStartingPrompt> {
  const { tx, secrets, mcpUrl, fleetUrl } = deps;
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
  return { shipId, prompt: startingPromptText({ mcpUrl, shipId, secret }), crewLine: crewLine({ fleetUrl, shipId, secret }) };
}
