import { describe, expect, it } from 'vitest';

import { replaceMcpConfiguration, readMcpConfiguration } from '../hooks/mcp-configuration-client';
import { replacementFor } from './mcp-configuration';

const configuration = {
  version: 7,
  servers: [{ name: 'graph', url: 'https://graph.example.com/mcp', tools: ['query'], credential: { header: 'Authorization', secret: 'graph-key' } }],
  secrets: ['graph-key', 'unused'],
};

function answerWith(data: unknown, status = 200): typeof fetch {
  return () => Promise.resolve(Response.json(data, { status }));
}

describe('Fleet manager saves a complete MCP set from the version read', () => {
  it('adds a server and new write-only secret while retaining every other server and secret', async () => {
    // Given the version and metadata read, never secret values.
    const read = await readMcpConfiguration(answerWith({ result: { data: configuration } }));
    let sent: unknown;
    // When the manager adds a server with a new credential.
    const replacement = replacementFor(read, {
      kind: 'server',
      originalName: undefined,
      server: { name: 'docs', url: 'https://docs.example.com/mcp', tools: ['search'], credential: { header: 'X-Api-Key', secret: 'docs-key' } },
      secretValues: { 'docs-key': 'write-only-example' },
    });
    const result = await replaceMcpConfiguration(replacement, (url, init) => {
      expect(url).toBe('/api/trierarch-plugin/mcp.replace');
      if (typeof init?.body !== 'string') throw new Error('The replacement body is JSON text');
      sent = JSON.parse(init.body);
      return Promise.resolve(Response.json({ result: { data: { version: 8 } } }));
    });
    // Then one whole replacement saves the version, without returning any value.
    expect(sent).toEqual({
      expectedVersion: 7,
      servers: [
        ...configuration.servers,
        { name: 'docs', url: 'https://docs.example.com/mcp', tools: ['search'], credential: { header: 'X-Api-Key', secret: 'docs-key' } },
      ],
      secrets: ['graph-key', 'unused', 'docs-key'],
      secretValues: { 'docs-key': 'write-only-example' },
    });
    expect(result).toEqual({ kind: 'saved', version: 8 });
  });

  it('keeps a removed server’s secret and only removes an unused secret when requested', () => {
    // Given a server using graph-key and an unused secret.
    // When the server is removed, then its secret stays.
    expect(replacementFor(configuration, { kind: 'remove-server', name: 'graph' })).toEqual({
      expectedVersion: 7,
      servers: [],
      secrets: ['graph-key', 'unused'],
      secretValues: {},
    });
    // When the unused secret is removed, then the server and its credential stay.
    expect(replacementFor(configuration, { kind: 'remove-secret', name: 'unused' })).toEqual({
      expectedVersion: 7,
      servers: configuration.servers,
      secrets: ['graph-key'],
      secretValues: {},
    });
  });

  it('replaces a secret value without changing the definitions or retained names', () => {
    // Given the existing set, when a value is replaced, then only the write-only value changes.
    expect(replacementFor(configuration, { kind: 'value', name: 'graph-key', value: 'replacement-example' })).toEqual({
      expectedVersion: 7,
      servers: configuration.servers,
      secrets: configuration.secrets,
      secretValues: { 'graph-key': 'replacement-example' },
    });
  });

  it('reports a stale version without retrying a replacement', async () => {
    // Given someone saved first.
    let sends = 0;
    // When the plugin refuses the stale version.
    const result = await replaceMcpConfiguration(replacementFor(configuration, { kind: 'remove-server', name: 'graph' }), () => {
      sends += 1;
      return Promise.resolve(Response.json({ error: { message: 'The MCP configuration changed', data: { code: 'CONFLICT' } } }, { status: 409 }));
    });
    // Then the caller must read again and keep the input.
    expect(result).toEqual({ kind: 'stale' });
    expect(sends).toBe(1);
  });

  it('reports an unknown save outcome on no answer and never sends it again', async () => {
    // Given a save whose answer is lost.
    let sends = 0;
    // When the route cannot answer.
    const result = await replaceMcpConfiguration(replacementFor(configuration, { kind: 'remove-server', name: 'graph' }), () => {
      sends += 1;
      return Promise.reject(new Error('network unavailable'));
    });
    // Then only an explicit read may unblock saving.
    expect(result).toEqual({ kind: 'no-answer' });
    expect(sends).toBe(1);
  });

  it('shows the plugin refusal and distinguishes the console body limit', async () => {
    // Given a replacement, when refused, then the reason can be shown with the form kept.
    const input = replacementFor(configuration, { kind: 'remove-server', name: 'graph' });
    expect(await replaceMcpConfiguration(input, answerWith({ error: { message: 'graph: invalid header' } }, 400))).toEqual({
      kind: 'refused',
      message: 'graph: invalid header',
    });
    expect(await replaceMcpConfiguration(input, answerWith({ error: { message: 'The MCP configuration body is over 1 MiB' } }, 413))).toEqual({
      kind: 'body-too-large',
    });
  });
});
