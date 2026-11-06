import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONSOLE_PAGE_TITLE } from './page-title';

const appDir = join(import.meta.dirname, '..', 'app');

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('the Console page title', () => {
  it('is <Surface> · Aeolus', () => {
    expect(CONSOLE_PAGE_TITLE).toBe('Console · Aeolus');
  });

  it('is set by the root layout', () => {
    const layout = readFileSync(join(appDir, 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/export const metadata: Metadata = \{\s*title: CONSOLE_PAGE_TITLE,?\s*\}/);
  });

  it('is not replaced by any other layout or page', () => {
    const overriding = sourcesUnder(appDir)
      .filter((path) => path !== join(appDir, 'layout.tsx'))
      .filter((path) => /export (const metadata|(async )?function generateMetadata)/.test(readFileSync(path, 'utf8')));
    expect(overriding).toEqual([]);
  });
});
