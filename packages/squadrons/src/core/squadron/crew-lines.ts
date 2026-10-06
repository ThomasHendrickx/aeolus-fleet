import type { CrewLine, ShipId } from '@aeolus-fleet/common';

import type { IssuedPrompt } from '../management/ports.js';

/** What a chat client is crewed through: its connector to the fleet's MCP server, with no aeolus plugin. */
const CHAT = 'chat';

/**
 * A member's crew lines (docs/squadrons.md, "Check-in"): the fleet's, one per
 * harness with the aeolus plugin, each with the squadron id appended, so the
 * session checks in at its flagship; and one for a chat client, which has no
 * plugin and so no check-in of its own: the line holds the check-in in full.
 * They hold the secret, so they are shown once and never stored.
 */
export function memberCrewLines(issued: IssuedPrompt, member: { shipId: ShipId; role: string; squadronId: string; mcpUrl: string }): CrewLine[] {
  const { shipId, role, squadronId, mcpUrl } = member;
  const chat =
    `Crew Aeolus ship ${shipId} through the fleet's MCP connector at ${mcpUrl}: register with ship id ${shipId}, secret ${issued.secret} and your chat client as harness (claude-chat or chatgpt). ` +
    `Then check in: send the ship ${squadronId} contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"${squadronId}","model":"<your exact model id>"}; it answers your role and charter; ` +
    `answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"${squadronId}","role":"${role}"}, and take up the charter.`;
  return [...issued.crewLines.map(({ harness, line }) => ({ harness, line: `${line} ${squadronId}` })), { harness: CHAT, line: chat }];
}
