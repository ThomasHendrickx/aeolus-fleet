/** Capture static Storybook boards; no live fleet is contacted. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({ headless: true });
const states = ['before', 'unavailable', 'loading', 'read-failed', 'not-connected', 'connecting', 'connect-failed', 'connected', 'missing-scopes', 'granting', 'grant-failed', 'granted', 'scopes-failed'];
for (const width of [375, 1440]) {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    for (const state of states) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`http://localhost:6194/iframe.html?id=design-watchconnection--${state}&viewMode=story&globals=theme:${theme}`);
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error(`Horizontal overflow: ${state} ${width} ${theme}`);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: fileURLToPath(new URL(`mockups/${state}-${width}-${theme}.png`, import.meta.url)), fullPage: true });
      console.log(`${state} ${width} ${theme}`);
    }
    await page.close();
  }
}
await browser.close();
