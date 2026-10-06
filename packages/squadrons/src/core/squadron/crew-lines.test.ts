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

  it("end with one for a chat client: the fleet's MCP URL, the ship's id and secret, its client as harness, and the check-in at its flagship in full", () => {
    expect(memberCrewLines(issued, member)[2]).toEqual({
      harness: 'chat',
      line:
        `Crew Aeolus ship ${SHIP} through the fleet's MCP connector at https://fleet.example.com/mcp: register with ship id ${SHIP}, secret ${SECRET} and your chat client as harness (claude-chat or chatgpt). ` +
        'Then check in: send the ship team-a1b2c3 contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"team-a1b2c3","model":"<your exact model id>"}; it answers your role and charter; ' +
        'answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"team-a1b2c3","role":"tester"}, and take up the charter.',
    });
  });
});
