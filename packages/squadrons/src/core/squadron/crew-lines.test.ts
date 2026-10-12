import { describe, expect, it } from 'vitest';

import { memberCrewLines } from './crew-lines.js';

const SHIP = 'shp_01m3tbfspe96yf1rnr4ank0010';
const SECRET = 'aeolus_sk_v1_tester-q8r2';
const issued = {
  secret: SECRET,
  crewLines: [
    { harness: 'claude-code', line: `/aeolus:crew https://fleet.example.com ${SHIP} ${SECRET}` },
    { harness: 'codex', line: `$aeolus-crew https://fleet.example.com ${SHIP} ${SECRET}` },
  ],
};
const member = { shipId: SHIP, role: 'tester', squadronId: 'team-a1b2c3', mcpUrl: 'https://fleet.example.com/mcp' } as const;

describe("a member's crew lines", () => {
  it("are the fleet's, one per harness with the aeolus plugin, each with the squadron id, so the session checks in at its flagship", () => {
    expect(memberCrewLines(issued, member).slice(0, 2)).toEqual([
      { harness: 'claude-code', line: `/aeolus:crew https://fleet.example.com ${SHIP} ${SECRET} team-a1b2c3` },
      { harness: 'codex', line: `$aeolus-crew https://fleet.example.com ${SHIP} ${SECRET} team-a1b2c3` },
    ]);
  });

  it("end with one for a chat client: the fleet's MCP URL to connect without auth, the ship's id and secret, its client as harness, to keep the crew token in the conversation, and the check-in at its flagship in full", () => {
    expect(memberCrewLines(issued, member)[2]).toEqual({
      harness: 'chat',
      line:
        `Crew Aeolus ship ${SHIP} from this chat. If the fleet's MCP server at https://fleet.example.com/mcp is not connected yet, connect it in this chat app as a remote MCP server or connector, without auth. Then register with ship id ${SHIP}, secret ${SECRET}, location CLOUD and your chat client as harness (claude-chat or chatgpt). It answers your crew token only once: keep it in this conversation, pass it to every later call and never register again; a CONFLICT on register means the ship is crewed already, not a reason to retry. ` +
        'Then check in: send the ship team-a1b2c3 contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"team-a1b2c3","model":"<your exact model id>"}; it answers your role and charter; ' +
        'answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"team-a1b2c3","role":"tester"}, and take up the charter.',
    });
  });

  it('never tell a chat client to run claude mcp add, which configures Claude Code only', () => {
    expect(memberCrewLines(issued, member)[2]?.line).not.toContain('claude mcp add');
  });
});
