import type { CrewLine, ShipId } from '@aeolus-fleet/common';

import type { IssuedPrompt } from '../management/ports.js';

/** What a chat client is crewed through: the fleet's MCP server connected in its chat app, with no aeolus plugin. */
const CHAT = 'chat';

/**
 * A member's crew lines (docs/squadrons.md, "Check-in"): the fleet's, one per
 * harness with the aeolus plugin, each with the squadron id appended, so the
 * session checks in at its flagship; and one for a chat client, which has no
 * plugin to keep its crew token or check in: the line says to keep the token
 * in the conversation and holds the check-in in full.
 * They hold the secret, so they are shown once and never stored.
 */
export function memberCrewLines(issued: IssuedPrompt, member: { shipId: ShipId; role: string; squadronId: string; mcpUrl: string }): CrewLine[] {
  const { shipId, role, squadronId, mcpUrl } = member;
  const chat =
    `Crew Aeolus ship ${shipId} from this chat. If the fleet's MCP server at ${mcpUrl} is not connected yet, connect it in this chat app as a remote MCP server or connector, without auth. ` +
    `Then register with ship id ${shipId}, secret ${issued.secret}, location CLOUD and your chat client as harness (claude-chat or chatgpt). ` +
    'It answers your crew token only once: keep it in this conversation, pass it to every later call and never register again; a CONFLICT on register means the ship is crewed already, not a reason to retry. ' +
    `Then check in: send the ship ${squadronId} contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"${squadronId}","model":"<your exact model id>"}; it answers your role and charter; ` +
    `answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"${squadronId}","role":"${role}"}, and take up the charter.`;
  return [...issued.crewLines.map(({ harness, line }) => ({ harness, line: `${line} ${squadronId}` })), { harness: CHAT, line: chat }];
}
