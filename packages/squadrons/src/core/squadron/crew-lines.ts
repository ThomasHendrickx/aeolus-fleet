import type { CrewLine } from '@aeolus-fleet/common';

import type { IssuedPrompt } from '../management/ports.js';

/** What a chat client is crewed through: the fleet's MCP server connected in its chat app, with no aeolus plugin. */
const CHAT = 'chat';

/**
 * A member's crew lines (docs/squadrons.md, "Check-in"): the fleet's, one per
 * harness with the aeolus plugin, each with the squadron id appended, so the
 * session checks in at its flagship; and one for a chat client, which has no
 * plugin and so no check-in of its own: the fleet's crew instructions for a
 * chat, then the check-in in full. They hold the secret, so they are shown
 * once and never stored.
 */
export function memberCrewLines(issued: IssuedPrompt, member: { role: string; squadronId: string }): CrewLine[] {
  const { role, squadronId } = member;
  const chat =
    `${issued.prompt}\n\n` +
    `Once registered, check in: send the ship ${squadronId} contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"${squadronId}","model":"<your exact model id>"}; it answers your role and charter; ` +
    `answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"${squadronId}","role":"${role}"}, and take up the charter.`;
  return [...issued.crewLines.map(({ harness, line }) => ({ harness, line: `${line} ${squadronId}` })), { harness: CHAT, line: chat }];
}
