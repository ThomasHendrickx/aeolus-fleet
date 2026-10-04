import type { CrewLine, ShipId, StartingPromptOutput } from '@aeolus-fleet/common';

import { mcpUrlOf } from '../mcp/mcp-url.js';

/**
 * How a starting prompt reads (docs/blueprint.md, "Launch a ship"): the text
 * the operator pastes into a new session, and one crew line per harness with
 * the aeolus plugin. Core issues only the secret; this is presentation, so it
 * lives here, and tRPC, REST and MCP share it because they map onto the same
 * procedures. It holds the secret, so it is shown once and never stored.
 */

/**
 * The starting prompt's text: identity only. Where the fleet's MCP server is
 * and how to add it, the ship's id and secret, how to pick the location, and
 * to call register. The protocol comes from the fleet when the session
 * connects, and each call's rules from its description; what the ship works
 * on, the operator adds.
 */
function startingPromptText(input: { mcpUrl: string; shipId: ShipId; secret: string }): string {
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
 * The crew lines: the same identity in one line for each harness with the
 * aeolus plugin, which registers and keeps the crew token itself. The fleet
 * URL is where the plugin reaches the fleet; it finds the MCP server and REST
 * under it.
 */
function crewLines(input: { fleetUrl: string; shipId: ShipId; secret: string }): CrewLine[] {
  const identity = `${input.fleetUrl} ${input.shipId} ${input.secret}`;
  return [
    { harness: 'claude-code', line: `/aeolus:crew ${identity}` },
    { harness: 'codex', line: `$aeolus-crew ${identity}` },
  ];
}

/** A starting prompt as the API hands it out: the prompt, its crew lines and the secret itself. */
export function presentStartingPrompt(input: { fleetUrl: string; shipId: ShipId; secret: string }): StartingPromptOutput {
  const { fleetUrl, shipId, secret } = input;
  return {
    shipId,
    prompt: startingPromptText({ mcpUrl: mcpUrlOf(fleetUrl), shipId, secret }),
    crewLines: crewLines({ fleetUrl, shipId, secret }),
    secret,
  };
}
