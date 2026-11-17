/**
 * Documentation-only captures: every artboard in manifest.json, before and
 * after, at 375 and 1440 wide, as full-page PNGs; records horizontal
 * overflow, broken local links and page errors in viewport-checks.json.
 * Reduced motion shows each animation at its rest frame.
 * Run from the repository root: node docs/design/linear-demo/mockups/capture.js [id ...]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import console from 'node:console';
import process from 'node:process';

/* global document, window -- page.evaluate callbacks run in the browser page. */
import { chromium } from 'playwright';

const here = resolve('docs/design/linear-demo/mockups');
const only = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(`${here}/artboards/manifest.json`, 'utf8')).filter((frame) => only.length === 0 || only.includes(frame.id));
const widths = [
  [375, 812],
  [1440, 1000],
];
const browser = await chromium.launch();
const checks = [];
for (const [width, height] of widths) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const page = await context.newPage();
  for (const frame of manifest) {
    for (const era of ['before', 'after']) {
      const errors = [];
      page.removeAllListeners('pageerror');
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`file://${here}/artboards/${frame.id}-${era}.html`);
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        links: [...document.querySelectorAll('a[href$=".html"]')].map((link) => link.getAttribute('href')),
      }));
      const broken = [...new Set(result.links)].filter((href) => !existsSync(`${here}/artboards/${href}`));
      await page.screenshot({ path: `${here}/previews/${frame.id}-${era}-${width}.png`, fullPage: true });
      checks.push({ id: frame.id, era, width, overflow: result.overflow, brokenLinks: broken, pageErrors: errors });
    }
  }
  await context.close();
}
await browser.close();
if (only.length === 0) writeFileSync(`${here}/viewport-checks.json`, `${JSON.stringify(checks, null, 2)}\n`);
const failed = checks.filter((check) => check.overflow || check.brokenLinks.length > 0 || check.pageErrors.length > 0);
console.log(`${checks.length} captures, ${failed.length} with findings`);
for (const check of failed) console.log(JSON.stringify(check));
