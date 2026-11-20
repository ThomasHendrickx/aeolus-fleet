/** Documentation screenshots only: where the account menu's items go. Run from the repository root. No app server or network. */
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
const findings = [];
const states = ['account', 'argo', 'viewer', 'single'];

for (const width of [375, 1440]) {
  const height = width === 375 ? 812 : 1000;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  let pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => pageErrors.push(request.url()));
  const open = async (state, { era = 'after', theme = 'light', view = 'settings', squadrons = false } = {}) => {
    pageErrors = [];
    await page.goto(`file://${folder}/items.html?state=${state}&era=${era}&theme=${theme}&view=${view}${squadrons ? '&squadrons=1' : ''}`);
    await page.evaluate(() => document.fonts.ready);
  };
  const capture = async ({ state, shot, era = 'after', theme = 'light' }) => {
    const name = `items-${state}-${shot}-${era}-${width}-${theme}.png`;
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.menu, .panel, .dialog');
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        panelScrolls: panel ? panel.scrollHeight > panel.clientHeight : false,
        panelClipped: panel ? panel.getBoundingClientRect().bottom > window.innerHeight + 1 : false,
        phoneTargets: window.innerWidth < 640
          ? [...document.querySelectorAll('.launcher, .account, .menu a, .menu button, .panel button, .setting-row, .segmented button, .tab, .tour button')].filter((node) => node.getBoundingClientRect().height < 44).length
          : 0,
        tabsOverflow: [...document.querySelectorAll('.tab span')].some((node) => node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().width > node.parentElement.getBoundingClientRect().width + 1),
        fontsReady: document.fonts.check('13px Geist'),
      };
    });
    await page.screenshot({ path: `${output}/${name}`, fullPage: false });
    const record = { name, width, height, state, shot, era, theme, ...layout, pageErrors: [...pageErrors] };
    records.push(record);
    if (layout.overflow || layout.panelClipped || layout.phoneTargets || layout.tabsOverflow || !layout.fontsReady || pageErrors.length) findings.push(record);
  };
  const isFocused = (selector) => page.locator(selector).first().evaluate((node) => node === document.activeElement);

  for (const state of states) {
    for (const theme of ['light', 'dark']) {
      await open(state, { era: 'before', theme });
      await capture({ state, shot: 'menu', era: 'before', theme });
      await open(state, { theme });
      await capture({ state, shot: 'settings', theme });
      await open(state, { theme, view: 'account' });
      await capture({ state, shot: 'account-panel', theme });
      if (width === 1440) {
        // Keyboard shortcuts by keyboard: the row opens the dialog, Escape closes it and returns focus to the row.
        await open(state, { theme });
        await page.locator('#shortcuts').focus();
        await page.keyboard.press('Enter');
        if (!await isFocused('#dialog-close')) findings.push({ width, state, theme, interaction: 'Keyboard shortcuts opens its dialog with focus inside' });
        await capture({ state, shot: 'shortcuts', theme });
        await page.keyboard.press('Escape');
        if (await page.locator('.dialog').count() !== 0 || !await isFocused('#shortcuts')) findings.push({ width, state, theme, interaction: 'Escape closes the dialog and returns focus to Keyboard shortcuts' });
      }
    }
  }
  // The phone tab bar at its most tabs: squadrons and the trierarch plugin on, Settings last.
  for (const theme of ['light', 'dark']) {
    await open('argo', { theme, squadrons: true });
    await capture({ state: 'argo', shot: 'most-tabs', theme });
  }

  // Feedback frames come from pressing the controls, not from alternate markup.
  for (const state of ['account', 'argo', 'single']) {
    await open(state);
    await page.locator('#theme-dark').click();
    if (!await page.evaluate(() => document.documentElement.classList.contains('dark')) || await page.locator('#theme-dark').getAttribute('aria-pressed') !== 'true') findings.push({ width, state, interaction: 'Choosing Dark shows it at once' });
    if (!await isFocused('#theme-dark')) findings.push({ width, state, interaction: 'Focus stays on the chosen theme' });
    await capture({ state, shot: 'theme-chosen' });
  }
  await open('account');
  await page.locator('#sign-in-as-argo').click();
  if (await page.locator('#sign-in-as-argo').textContent() !== 'Signing in as argo' || !await page.locator('#sign-in-as-argo').isDisabled()) findings.push({ width, interaction: 'Sign in as argo shows it is working' });
  await capture({ state: 'account', shot: 'signing-in-as-argo' });
  for (const state of states) {
    await open(state);
    await page.locator('#tour').click();
    if (!await isFocused('#tour-next')) findings.push({ width, state, interaction: 'Take the tour opens its first step with focus on Next' });
    await capture({ state, shot: 'tour' });
  }
  await page.close();
}
await browser.close();
writeFileSync(`${folder}/capture-items-results.json`, `${JSON.stringify({ captures: records.length, findings, records }, null, 2)}\n`);
console.log(`${records.length} screenshot captures; ${findings.length} findings.`);
if (findings.length) { console.log(JSON.stringify(findings, null, 2)); process.exitCode = 1; }
