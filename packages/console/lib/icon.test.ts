import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// The favicon is the app mark: the Ship glyph on --primary, in the light and
// the dark theme, so the tab matches the console the operator sees.

const icon = readFileSync(new URL('../app/icon.svg', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../app/tokens.css', import.meta.url), 'utf8');

describe('the favicon', () => {
  it('is an SVG with a dark variant for a dark system theme', () => {
    expect(icon).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(icon).toContain('@media (prefers-color-scheme: dark)');
  });

  it('takes its colours from --primary and --primary-foreground, light and dark', () => {
    expect(tokens).toContain('--primary:oklch(0.34 0.08 257)');
    expect(tokens).toContain('--primary:oklch(0.86 0.055 250)');
    expect(icon).toContain('.tile { fill: #1a3860; }');
    expect(icon).toContain('.tile { fill: #b6d5f4; }');
  });
});
