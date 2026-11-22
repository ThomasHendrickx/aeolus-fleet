import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// End-to-end and browser tests wait on what the app does: a retrying assertion,
// a known response or the part's data-state. Never a sleep, networkidle or a
// raw locator (behaviour-driven-development and web-frontend skills).

/** One probe for each file pattern that drives a browser. */
const drivers = {
  'an e2e test': 'e2e/probe.e2e.test.ts',
  'an e2e support file': 'e2e/support/probe.ts',
  'an e2e test beside its package': 'packages/console/features/probe/probe.e2e.test.ts',
  'a browser test': 'packages/console/lib/probe.browser.test.ts',
};
/** Stories run as browser tests too, but their fake services time their answers. */
const stories = {
  'a console story': 'packages/console/components/atoms/probe.stories.tsx',
  'a ui story': 'packages/ui/src/atoms/probe.stories.tsx',
};
const production = 'packages/console/lib/probe.ts';
const lint = createLint({ tsconfig: 'tsconfig.json', probes: [...Object.values(drivers), ...Object.values(stories), production] });

async function violations(code: string, path: string): Promise<string[]> {
  const messages = await lint(code, path);
  return [
    ...reportsOf(messages, 'browser-tests/no-restricted-syntax'),
    ...reportsOf(messages, 'playwright/no-wait-for-timeout'),
    ...reportsOf(messages, 'playwright/no-networkidle'),
  ];
}

const sleeps = {
  'a fixed sleep': 'export async function f(page: { waitForTimeout(ms: number): Promise<void> }) { await page.waitForTimeout(500); }',
};

const timers = {
  'a promise around setTimeout': 'export const wait = () => new Promise((resolve) => setTimeout(resolve, 50));',
  'a promise around globalThis.setTimeout': 'export const wait = () => new Promise((resolve) => globalThis.setTimeout(resolve, 50));',
  'a promise around window.setTimeout': 'export const wait = () => new Promise((resolve) => window.setTimeout(resolve, 50));',
  'a computed setTimeout member': "export const wait = () => new Promise((resolve) => globalThis['setTimeout'](resolve, 50));",
  'setTimeout from node:timers/promises': "import { setTimeout as sleep } from 'node:timers/promises';\nexport const wait = () => sleep(50);",
};

const networkIdle = {
  'networkidle': "export async function f(page: { waitForLoadState(state: string): Promise<void> }) { await page.waitForLoadState('networkidle'); }",
  'networkidle on goto': "export async function f(page: { goto(url: string, o: object): Promise<void> }) { await page.goto('/', { waitUntil: 'networkidle' }); }",
};

const rawLocators = {
  'a CSS locator': "export const f = (page: { locator(s: string): unknown }) => page.locator('div > span');",
  'a data-testid locator': "export const f = (page: { locator(s: string): unknown }) => page.locator('[data-testid=\"fleet-row\"]');",
  'a locator in a template': 'export const f = (page: { locator(s: string): unknown }, id: string) => page.locator(`[data-testid="${id}"]:visible`);',
  'a data-testid selector built apart from its locator': "export const selector = '[data-testid=\"fleet-row\"]';",
  'a data-testid selector built in a template': 'export const selectorOf = (id: string) => `[data-testid="${id}"]`;',
  'a locator from a variable': 'export const f = (page: { locator(s: string): unknown }, css: string) => page.locator(css);',
  'a computed locator member': "export const f = (page: Record<string, (s: string) => unknown>) => page['locator']('td');",
  'a chained locator': "export const f = (row: { locator(s: string): unknown }) => row.locator('td');",
  'a $ query': "export const f = (page: { $(s: string): unknown }) => page.$('td');",
  'a $$eval query': "export const f = (page: { $$eval(s: string, fn: () => void): unknown }) => page.$$eval('td', () => undefined);",
  'waitForSelector': "export const f = (page: { waitForSelector(s: string): unknown }) => page.waitForSelector('td');",
};

const getters = `
  type Locator = { click(): Promise<void>; getByRole(role: string): Locator };
  export async function f(page: { getByTestId(id: string): Locator; getByText(t: string): Locator; getByRole(role: string): Locator }) {
    await page.getByTestId('fleet-row').click();
    await page.getByText('Ships').click();
    await page.getByRole('button').click();
  }
`;

describe.each(Object.entries({ ...drivers, ...stories }))('the browser-test rules cover %s', (_label, path) => {
  it.each(Object.entries({ ...sleeps, ...networkIdle, ...rawLocators }))('fails on %s', async (_what, code) => {
    expect(await violations(code, path)).not.toEqual([]);
  });

  it('passes on the testid, role and text getters', async () => {
    await expect(violations(getters, path)).resolves.toEqual([]);
  });
});

describe.each(Object.entries(drivers))('the browser-test rules on timers cover %s', (_label, path) => {
  it.each(Object.entries(timers))('fails on %s', async (_what, code) => {
    expect(await violations(code, path)).not.toEqual([]);
  });
});

describe('the browser-test rules stay off what is no browser test', () => {
  it.each(Object.entries({ ...sleeps, ...timers, ...networkIdle, ...rawLocators }))('lets production code use %s', async (_what, code) => {
    await expect(violations(code, production)).resolves.toEqual([]);
  });

  it("lets a story's fake service time its answer", async () => {
    for (const path of Object.values(stories)) {
      await expect(violations(timers['a promise around setTimeout'], path)).resolves.toEqual([]);
    }
  });
});
