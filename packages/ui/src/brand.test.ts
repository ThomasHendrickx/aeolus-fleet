import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// The brand tokens' rules that a story cannot show: which tokens change with
// the mode, and that reduced motion stands still at the rest frame.

const brand = readFileSync(new URL('./brand.css', import.meta.url), 'utf8');

/** The custom properties a block of brand.css declares, by name. */
function declarations(selector: string): Map<string, string> {
  const start = brand.indexOf(`${selector} {`);
  const block = brand.slice(start, brand.indexOf('}', start));
  return new Map([...block.matchAll(/(--brand-[a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!]));
}

const light = declarations(':root');
const dark = declarations('.dark');
const reducedMotion = declarations('@media (prefers-reduced-motion: reduce) {\n  :root');

describe('the brand tokens', () => {
  it('give dark its own value for every neutral and for slate, and for nothing else', () => {
    expect([...dark.keys()]).toEqual([
      '--brand-slate',
      '--brand-text',
      '--brand-text-secondary',
      '--brand-line',
      '--brand-ground',
      '--brand-surface',
    ]);
    for (const [name, value] of dark) {
      expect(light.get(name), name).toBeDefined();
      expect(value, name).not.toBe(light.get(name));
    }
  });

  it('keep the meanings the same in both modes', () => {
    for (const name of ['--brand-sea', '--brand-coral', '--brand-coral-text', '--brand-amber']) {
      expect(light.get(name), name).toMatch(/^#[0-9A-F]{6}$/);
      expect(dark.has(name), name).toBe(false);
    }
  });

  it('stand still with reduced motion on: every timing takes no time and a loop runs once', () => {
    const timings = ['event', 'breath', 'story', 'drift'].flatMap((timing) => [
      `--brand-${timing}-min`,
      `--brand-${timing}-max`,
    ]);
    for (const name of [...timings, '--brand-urgent']) {
      expect(light.get(name), name).toMatch(/^\d+m?s$/);
      expect(reducedMotion.get(name), name).toBe('0s');
    }
    expect(light.get('--brand-loop')).toBe('infinite');
    expect(reducedMotion.get('--brand-loop')).toBe('1');
    expect(reducedMotion.size).toBe(timings.length + 2);
  });
});
