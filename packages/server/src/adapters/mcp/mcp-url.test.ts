import { describe, expect, it } from 'vitest';

import { mcpUrlOf } from './mcp-url.js';

describe("the fleet's MCP URL", () => {
  it('is /mcp under the public URL', () => {
    expect(mcpUrlOf('https://fleet.example.com')).toBe('https://fleet.example.com/mcp');
  });

  it('is the same whether or not the public URL ends in a slash', () => {
    expect(mcpUrlOf('https://fleet.example.com/')).toBe('https://fleet.example.com/mcp');
  });

  it('keeps the path of a public URL that has one', () => {
    expect(mcpUrlOf('http://127.0.0.1:4000/aeolus/')).toBe('http://127.0.0.1:4000/aeolus/mcp');
  });
});
