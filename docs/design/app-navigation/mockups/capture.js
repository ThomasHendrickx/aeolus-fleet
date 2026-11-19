/** Documentation screenshots only. Run from the repository root. No app server or network. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';

/* global document, window */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const folder = resolve('docs/design/app-navigation/mockups');
const output = `${folder}/screenshots`;
mkdirSync(output, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const records = [];
const states = ['fleets', 'several', 'single', 'argo', 'viewer', 'missing', 'expired'];
const extras = ['closed', 'account', 'loading', 'error', 'detail', 'long-name', 'long-name-open', 'single-fleet', 'single-fleet-open'];
const findings = [];

for (const surface of ['console', 'bridge']) {
  for (const width of [375, 1440]) {
    const height = width === 375 ? 812 : 1000;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    let pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => pageErrors.push(request.url()));
    const open = async (state, { era = 'after', theme = 'light', fail = false } = {}) => {
      pageErrors = [];
      await page.goto(`file://${folder}/index.html?surface=${surface}&state=${state}&era=${era}&theme=${theme}${fail ? '&fail=1' : ''}`);
      await page.evaluate(() => document.fonts.ready);
    };
    const capture = async (state, { era = 'after', theme = 'light' } = {}) => {
      const name = `${surface}-${state}-${era}-${width}-${theme}.png`;
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('.panel');
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          panelScrolls: panel ? panel.scrollHeight > panel.clientHeight : false,
          panelClipped: panel ? panel.getBoundingClientRect().bottom > window.innerHeight + 1 : false,
          phoneTargets: window.innerWidth < 640
            ? [...document.querySelectorAll('.launcher, .fleet, .account, .panel a, .panel button')].filter((node) => node.getBoundingClientRect().height < 44).length
            : 0,
          fontsReady: document.fonts.check('13px Geist'),
        };
      });
      await page.screenshot({ path: `${output}/${name}`, fullPage: false });
      const record = { name, surface, width, height, state, era, theme, ...layout, pageErrors: [...pageErrors] };
      records.push(record);
      if (layout.overflow || layout.panelClipped || layout.phoneTargets || !layout.fontsReady || pageErrors.length) findings.push(record);
    };
    for (const state of states) {
      for (const [era, theme] of [['before', 'light'], ['before', 'dark'], ['after', 'light'], ['after', 'dark']]) {
        await open(state, { era, theme });
        await capture(state, { era, theme });
      }
    }
    for (const state of extras) for (const theme of ['light', 'dark']) { await open(state, { theme }); await capture(state, { theme }); }

    // Fleet switching, in light and dark: every frame comes from pressing the controls.
    for (const theme of ['light', 'dark']) {
      await open('closed', { theme });
      await page.locator('#launcher').focus();
      await page.keyboard.press('Shift+Tab');
      await page.locator('#fleet').focus();
      await page.keyboard.press('Shift');
      await capture('fleet-focus', { theme });
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      if (!await page.locator('.choice[data-name="Harbour"]').evaluate((node) => node === document.activeElement)) findings.push({ surface, width, interaction: 'ArrowDown moves to the next fleet' });
      await capture('fleets-keyboard', { theme });
      await page.keyboard.press('Escape');
      if (await page.locator('.panel').count() !== 0 || !await page.locator('#fleet').evaluate((node) => node === document.activeElement)) findings.push({ surface, width, interaction: 'Escape returns focus to the fleet button' });

      await open('fleets', { theme, fail: true });
      await page.locator('.choice[data-name="Harbour"]').click();
      await page.getByRole('link', { name: 'Opening Harbour', exact: true }).waitFor();
      await capture('switching', { theme });
      await page.locator('#switch-retry:not(:disabled)').waitFor();
      await capture('switch-failed', { theme });
      await page.locator('#switch-retry').click();
      await page.locator('#switch-retry:disabled').waitFor();
      await capture('switch-retrying', { theme });
      await page.locator('.arrival').waitFor();
      await capture('switched', { theme });
    }

    // Feedback frames come from pressing the controls, not from alternate markup.
    await open('closed');
    await page.locator('#launcher').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await capture('keyboard');
    await page.keyboard.press('Escape');
    if (await page.locator('.panel').count() !== 0 || !await page.locator('#launcher').evaluate((node) => node === document.activeElement)) findings.push({ surface, width, interaction: 'Escape returns focus to the launcher' });

    await open('several');
    const other = surface === 'console' ? 'Gateway' : 'Console';
    await page.locator(`.tile[data-name="${other}"]`).click();
    await page.getByRole('link', { name: `Opening ${other}`, exact: true }).waitFor();
    await capture('opening-app');
    await page.locator('.arrival').waitFor();
    await capture('arrived-app');

    await open('account');
    await page.locator('#signout').click();
    await page.locator('#signout:disabled').waitFor();
    await capture('signing-out');

    await open('missing');
    await page.locator('#retry').click();
    await page.getByText('Loading apps…').waitFor();
    await capture('retrying');
    await page.getByText('Apps refreshed.').waitFor();
    await capture('refreshed');

    await open('expired');
    await page.locator('#signin').click();
    await page.locator('#signin:disabled').waitFor();
    await capture('signing-in');
    await page.locator('.panel').getByText(/Sign-in opens with a return/).waitFor();
    await capture('sign-in-return');
    await page.close();
  }
}
await browser.close();
writeFileSync(`${folder}/capture-results.json`, `${JSON.stringify({ captures: records.length, findings, records }, null, 2)}\n`);
console.log(`${records.length} screenshot captures; ${findings.length} findings.`);
if (findings.length) { console.log(JSON.stringify(findings, null, 2)); process.exitCode = 1; }
