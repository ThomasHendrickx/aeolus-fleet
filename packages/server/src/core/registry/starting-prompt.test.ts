import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { startingPromptText } from './starting-prompt.js';

const shipId = createIdGenerator()('ship');
const MCP_URL = 'https://fleet.example.com/mcp';

describe('the starting prompt text', () => {
  const text = startingPromptText({ mcpUrl: MCP_URL, shipId, secret: 'aeolus_sk_v1_abc' });
  const lines = text.split('\n');

  it('carries the fleet MCP URL, the ship id and the secret, one per line', () => {
    expect(lines).toEqual(
      expect.arrayContaining([`Fleet MCP URL: ${MCP_URL}`, `Ship id: ${shipId}`, 'Ship secret: aeolus_sk_v1_abc']),
    );
  });

  it('gives the one-line command that adds the fleet MCP server to Claude Code, for a session without its tools', () => {
    expect(lines).toContain(`claude mcp add --transport http --scope user aeolus ${MCP_URL}`);
  });

  it('tells the session how to pick its location: DEVICE, CLOUD, SERVER, or OTHER with a few words', () => {
    const kinds = lines.flatMap((line) => /^- ([A-Z]+): /.exec(line)?.[1] ?? []);

    expect(kinds).toEqual(['DEVICE', 'CLOUD', 'SERVER', 'OTHER']);
    expect(lines).toContain('- OTHER: none of these, with a few words on where you run');
  });

  it('ends by telling the session to call register', () => {
    expect(lines.at(-1)).toBe('Call register.');
  });

  it('holds identity only: no call but register and no crew token, since the protocol comes from the fleet', () => {
    expect(text).not.toMatch(/\b(whoami|send|receive|ack|deregister)\b|crew token/i);
  });

  it('reads as approved, in full', () => {
    expect(text).toBe(
      [
        'You crew a ship in an Aeolus fleet.',
        '',
        `Fleet MCP URL: ${MCP_URL}`,
        `Ship id: ${shipId}`,
        'Ship secret: aeolus_sk_v1_abc',
        '',
        "Its tools come from the fleet's MCP server at that URL. If this session has none of them, add the server with this command, then start the session again with this prompt:",
        `claude mcp add --transport http --scope user aeolus ${MCP_URL}`,
        '',
        'Your location is where this session runs:',
        "- DEVICE: a personal computer, such as the operator's laptop",
        '- CLOUD: a hosted agent service, such as Claude Code on the web',
        '- SERVER: a server the operator runs, such as a VPS',
        '- OTHER: none of these, with a few words on where you run',
        '',
        'Call register.',
      ].join('\n'),
    );
  });
});
