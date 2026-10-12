import {
  mcpUrlOf,
  type CrewLine,
  type ShipId,
  type StartingPromptOutput,
} from "@aeolus-fleet/common";

/**
 * How a starting prompt reads (docs/blueprint.md, "Launch a ship"): the crew
 * instructions the operator pastes into a chat, and one crew line per harness
 * with the aeolus plugin. Core issues only the secret; this is presentation, so it
 * lives here, and tRPC, REST and MCP share it because they map onto the same
 * procedures. It holds the secret, so it is shown once and never stored.
 */

/**
 * The starting prompt's text: the ship's crew instructions for a chat, which
 * has no aeolus plugin. Where the fleet's MCP server is and how to connect it,
 * the ship's id and secret, how to register, and to keep the crew token in the
 * conversation, since a chat client may run each tool call on its own. One
 * short line sends any other session to its crew line or to register. The
 * protocol comes from the fleet when the session connects, and each call's
 * rules from its description; what the ship works on, the operator adds.
 */
function startingPromptText(input: {
  mcpUrl: string;
  shipId: ShipId;
  secret: string;
}): string {
  const { mcpUrl, shipId, secret } = input;
  return [
    "You crew a ship in an Aeolus fleet, from this chat.",
    "",
    `Fleet MCP URL: ${mcpUrl}`,
    `Ship id: ${shipId}`,
    `Ship secret: ${secret}`,
    "",
    "Connect the fleet's MCP server at that URL in this chat app as a remote MCP server or connector, without auth, if it is not connected yet.",
    "Then call register with that ship id and secret, location CLOUD, and harness chatgpt or claude-chat, whichever chat you are.",
    "register answers your crew token only once: keep it in this conversation and pass it to every later call. Never call register again: a CONFLICT on register means the ship is crewed already, not a reason to retry.",
    "",
    "Not a chat? Claude Code and Codex paste their crew line instead; another agent calls register with its own location and harness.",
  ].join("\n");
}

/**
 * The crew lines: the same identity in one line for each harness with the
 * aeolus plugin, which registers and keeps the crew token itself. The fleet
 * URL is where the plugin reaches the fleet; it finds the MCP server and REST
 * under it.
 */
function crewLines(input: {
  fleetUrl: string;
  shipId: ShipId;
  secret: string;
}): CrewLine[] {
  const identity = `${input.fleetUrl} ${input.shipId} ${input.secret}`;
  return [
    { harness: "claude-code", line: `/aeolus:crew ${identity}` },
    { harness: "codex", line: `$aeolus-crew ${identity}` },
  ];
}

/** A starting prompt as the API hands it out: the prompt, its crew lines and the secret itself. */
export function presentStartingPrompt(input: {
  fleetUrl: string;
  shipId: ShipId;
  secret: string;
}): StartingPromptOutput {
  const { fleetUrl, shipId, secret } = input;
  return {
    shipId,
    prompt: startingPromptText({ mcpUrl: mcpUrlOf(fleetUrl), shipId, secret }),
    crewLines: crewLines({ fleetUrl, shipId, secret }),
    secret,
  };
}
