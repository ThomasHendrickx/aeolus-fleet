import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// End-to-end and browser tests wait on what the app does: a retrying assertion,
// a known response or the part's data-state. Never a sleep, networkidle or a
// raw locator (behaviour-driven-development and web-frontend skills).

/** One probe for each file pattern the rules cover: every e2e and browser test file. */
const patterns = {
  'an e2e test': 'e2e/probe.e2e.test.ts',
  'an e2e support file': 'e2e/support/probe.ts',
  'an e2e test beside its package': 'packages/console/features/probe/probe.e2e.test.ts',
  'a browser test': 'packages/console/lib/probe.browser.test.ts',
  'a console story': 'packages/console/components/atoms/probe.stories.tsx',
  'a ui story': 'packages/ui/src/atoms/probe.stories.tsx',
};
const production = 'packages/console/lib/probe.ts';
const lint = createLint({ tsconfig: 'tsconfig.json', probes: [...Object.values(patterns), production] });

async function violations(code: string, path: string): Promise<string[]> {
  const messages = await lint(code, path);
  return [
    ...reportsOf(messages, 'no-restricted-syntax'),
    ...reportsOf(messages, 'playwright/no-wait-for-timeout'),
    ...reportsOf(messages, 'playwright/no-networkidle'),
    ...reportsOf(messages, 'playwright/no-raw-locators'),
  ];
}

const bad = {
  'a fixed sleep': "export async function f(page: { waitForTimeout(ms: number): Promise<void> }) { await page.waitForTimeout(500); }",
  'a promise around setTimeout': 'export const wait = () => new Promise((resolve) => setTimeout(resolve, 50));',
  'a promise around globalThis.setTimeout': 'export const wait = () => new Promise((resolve) => globalThis.setTimeout(resolve, 50));',
  'a promise around window.setTimeout': 'export const wait = () => new Promise((resolve) => window.setTimeout(resolve, 50));',
  'a computed setTimeout member': "export const wait = () => new Promise((resolve) => globalThis['setTimeout'](resolve, 50));",
  'networkidle': "export async function f(page: { waitForLoadState(state: string): Promise<void> }) { await page.waitForLoadState('networkidle'); }",
  'networkidle on goto': "export async function f(page: { goto(url: string, o: object): Promise<void> }) { await page.goto('/', { waitUntil: 'networkidle' }); }",
  'a CSS locator': "export const f = (page: { locator(s: string): unknown }) => page.locator('div > span');",
  'a data-testid locator': "export const f = (page: { locator(s: string): unknown }) => page.locator('[data-testid=\"fleet-row\"]');",
  'a locator in a template': 'export const f = (page: { locator(s: string): unknown }, id: string) => page.locator(`[data-testid="${id}"]:visible`);',
  'a chained locator': "export const f = (row: { locator(s: string): unknown }) => row.locator('td');",
};

describe.each(Object.entries(patterns))('the e2e rules cover %s', (_label, path) => {
  it.each(Object.entries(bad))('fails on %s', async (_what, code) => {
    expect(await violations(code, path)).not.toEqual([]);
  });

  it('passes on the testid, role and text getters and a retrying assertion', async () => {
    const code = `
      type Locator = { click(): Promise<void>; getByRole(role: string): Locator };
      export async function f(page: { getByTestId(id: string): Locator; getByText(t: string): Locator; getByRole(role: string): Locator }) {
        await page.getByTestId('fleet-row').click();
        await page.getByText('Ships').click();
        await page.getByRole('button').click();
      }
    `;

    await expect(violations(code, path)).resolves.toEqual([]);
  });
});

describe('the e2e rules stay off other files', () => {
  it('lets production code use setTimeout', async () => {
    const code = 'export const wait = () => new Promise((resolve) => setTimeout(resolve, 50));';

    await expect(violations(code, production)).resolves.toEqual([]);
  });
});
