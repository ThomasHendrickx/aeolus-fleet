import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { presentStartingPrompt } from './starting-prompt-text.js';

const shipId = createIdGenerator()('ship');
const FLEET_URL = 'https://fleet.example.com';
const MCP_URL = 'https://fleet.example.com/mcp';
const presented = presentStartingPrompt({ fleetUrl: FLEET_URL, shipId, secret: 'aeolus_sk_v1_abc' });

describe('the starting prompt text: the ship\'s crew instructions for a chat', () => {
  const text = presented.prompt;
  const lines = text.split('\n');

  it('carries the fleet MCP URL, the ship id and the secret, one per line', () => {
    expect(lines).toEqual(
      expect.arrayContaining([`Fleet MCP URL: ${MCP_URL}`, `Ship id: ${shipId}`, 'Ship secret: aeolus_sk_v1_abc']),
    );
  });

  it('tells the chat to connect that URL in its chat app as a remote MCP server or connector, without auth', () => {
    expect(lines).toContain("Connect the fleet's MCP server at that URL in this chat app as a remote MCP server or connector, without auth, if it is not connected yet.");
  });

  it('tells the chat to register with the ship id and secret, location CLOUD and its chat as harness, chatgpt or claude-chat', () => {
    expect(lines).toContain('Then call register with that ship id and secret, location CLOUD, and harness chatgpt or claude-chat, whichever chat you are.');
  });

  it('tells the chat that register answers the crew token once, to keep it in the conversation for every later call, and that a CONFLICT is no reason to register again', () => {
    expect(lines).toContain(
      'register answers your crew token only once: keep it in this conversation and pass it to every later call. Never call register again: a CONFLICT on register means the ship is crewed already, not a reason to retry.',
    );
  });

  it('never tells a chat to run claude mcp add, which configures Claude Code only', () => {
    expect(text).not.toContain('claude mcp add');
  });

  it('ends with one short line for a session that is no chat: a plugin harness pastes its crew line, another agent registers with its own location and harness', () => {
    expect(lines.at(-1)).toBe('Not a chat? Claude Code and Codex paste their crew line instead; another agent calls register with its own location and harness.');
  });

  it('reads as approved, in full', () => {
    expect(text).toBe(
      [
        'You crew a ship in an Aeolus fleet, from this chat.',
        '',
        `Fleet MCP URL: ${MCP_URL}`,
        `Ship id: ${shipId}`,
        'Ship secret: aeolus_sk_v1_abc',
        '',
        "Connect the fleet's MCP server at that URL in this chat app as a remote MCP server or connector, without auth, if it is not connected yet.",
        'Then call register with that ship id and secret, location CLOUD, and harness chatgpt or claude-chat, whichever chat you are.',
        'register answers your crew token only once: keep it in this conversation and pass it to every later call. Never call register again: a CONFLICT on register means the ship is crewed already, not a reason to retry.',
        '',
        'Not a chat? Claude Code and Codex paste their crew line instead; another agent calls register with its own location and harness.',
      ].join('\n'),
    );
  });
});

describe('the crew lines', () => {
  it('gives one crew line per harness with the aeolus plugin: Claude Code and Codex, each with the fleet URL, the ship id and the secret', () => {
    expect(presented.crewLines).toEqual([
      { harness: 'claude-code', line: `/aeolus:crew ${FLEET_URL} ${shipId} aeolus_sk_v1_abc` },
      { harness: 'codex', line: `$aeolus-crew ${FLEET_URL} ${shipId} aeolus_sk_v1_abc` },
    ]);
  });
});

describe('a presented starting prompt', () => {
  it('carries the ship id and the secret itself, for a client that registers the ship for a session of its own', () => {
    expect(presented).toMatchObject({ shipId, secret: 'aeolus_sk_v1_abc' });
  });

  it('finds the MCP server under the fleet URL, keeping its path whether or not it ends in a slash', () => {
    const underPath = presentStartingPrompt({ fleetUrl: 'http://127.0.0.1:4000/aeolus/', shipId, secret: 'aeolus_sk_v1_abc' });

    expect(underPath.prompt).toContain('Fleet MCP URL: http://127.0.0.1:4000/aeolus/mcp');
  });
});
