// Evidence for #1755: every Harbour link tile, light and dark, normal / hover / active / focus-visible,
// from two static Storybooks (before = main 2e8f61c, after = feature head), plus paused mid-hover frames.
// Usage: node capture-tiles.mjs <before-url> <after-url> <out-dir>
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const require = createRequire('/home/thomas/.aeolus/trierarch/worktrees/aeolus-fleet/build-core-1753-band/package.json');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const [beforeUrl, afterUrl, out] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const STORY = 'iframe.html?id=harbour-harbourtile--light-and-dark&viewMode=story';
const results = { tiles: [], midHover: [] };

const STORIES = ['alert', 'awaiting-crew', 'blocked', 'working', 'idle'];

async function openStory(base, story, theme) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/iframe.html?id=harbour-harbourtile--${story}&viewMode=story&globals=theme:${theme}`);
  await page.locator('[data-testid=harbour-tile]').waitFor();
  // The band runs by design in both; freeze it at the same frame so it does not differ by chance.
  await page.addStyleTag({ content: '[data-testid=harbour-tile-live]{animation-play-state:paused!important;animation-delay:-1200ms!important}' });
  await page.waitForTimeout(300);
  return page;
}

async function shot(page, index, name) {
  const tile = page.locator('[data-testid=harbour-tile]').nth(index);
  const box = await tile.boundingBox();
  const margin = 6;
  const path = `${out}/${name}.png`;
  await page.screenshot({ path, clip: { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin } });
  return path;
}

async function tileInfo(page, index) {
  return page.locator('[data-testid=harbour-tile]').nth(index).evaluate((tile) => ({ state: tile.dataset.state, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', border: getComputedStyle(tile).borderTopColor, outline: `${getComputedStyle(tile).outlineStyle} ${getComputedStyle(tile).outlineWidth}`, transform: getComputedStyle(tile).transform, shadow: getComputedStyle(tile).boxShadow, pointerEvents: getComputedStyle(tile).pointerEvents, radius: getComputedStyle(tile).borderTopLeftRadius }));
}

async function captureAll(version, base) {
  const shots = [];
  for (const theme of ['light', 'dark']) for (const story of STORIES) {
  const page = await openStory(base, story, theme);
  const index = 0;
  {
    const info = await tileInfo(page, index);
    const id = `${info.theme}-${info.state}`;
    const tile = page.locator('[data-testid=harbour-tile]').nth(index);
    await page.mouse.move(790, 490);
    await page.waitForTimeout(400);
    shots.push({ id, mode: 'normal', path: await shot(page, index, `${version}-${id}-normal`), ...(await tileInfo(page, index)) });
    await tile.hover();
    await page.waitForTimeout(400);
    shots.push({ id, mode: 'hover', path: await shot(page, index, `${version}-${id}-hover`), ...(await tileInfo(page, index)) });
    await page.mouse.down();
    await page.waitForTimeout(400);
    shots.push({ id, mode: 'active', path: await shot(page, index, `${version}-${id}-active`), ...(await tileInfo(page, index)), isActive: await tile.evaluate((t) => t.matches(':active')) });
    await page.mouse.up();
    await page.mouse.move(790, 490);
    await page.waitForTimeout(400);
    // Keyboard focus: Tab from the element before it.
    await page.evaluate((i) => { const tiles = document.querySelectorAll('[data-testid=harbour-tile]'); (i === 0 ? document.body : tiles[i - 1]).focus?.(); if (i === 0) document.activeElement?.blur?.(); }, index);
    if (index === 0) await page.locator('body').click({ position: { x: 790, y: 490 } });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    shots.push({ id, mode: 'focus-visible', path: await shot(page, index, `${version}-${id}-focus`), ...(await tileInfo(page, index)), isFocusVisible: await tile.evaluate((t) => t.matches(':focus-visible')) });
    await page.evaluate(() => document.activeElement?.blur?.());
  }
  // Mid-hover frames: start the hover, pause every transition at 0/37/75/112 ms and read the border.
  {
    const info = await tileInfo(page, index);
    for (const at of [0, 37, 75, 112]) {
      await page.mouse.move(790, 490);
      await page.waitForTimeout(400);
      await page.locator('[data-testid=harbour-tile]').nth(index).hover();
      const border = await page.locator('[data-testid=harbour-tile]').nth(index).evaluate((tile, ms) => {
        const transitions = tile.getAnimations();
        for (const t of transitions) { t.pause(); t.currentTime = ms; }
        const c = document.createElement('canvas').getContext('2d');
        c.fillStyle = getComputedStyle(tile).borderTopColor; c.fillRect(0, 0, 1, 1);
        const pixel = [...c.getImageData(0, 0, 1, 1).data].join(',');
        const timings = transitions.map((t) => `${t.transitionProperty} ${t.effect.getTiming().duration} ${t.effect.getTiming().easing}`);
        for (const t of transitions) t.finish();
        return { pixel, timings };
      }, at);
      results.midHover.push({ version, id: `${info.theme}-${info.state}`, at, ...border });
    }
  }
  await page.close();
  }
  return shots;
}

function diff(pathA, pathB, excludeBottomRows = 0) {
  const a = PNG.sync.read(require('node:fs').readFileSync(pathA));
  const b = PNG.sync.read(require('node:fs').readFileSync(pathB));
  if (a.width !== b.width || a.height !== b.height) return { sizeDiffers: true, a: [a.width, a.height], b: [b.width, b.height] };
  let differing = 0;
  let maxDelta = 0;
  const end = (a.height - excludeBottomRows) * a.width * 4;
  for (let i = 0; i < end; i += 4) {
    const delta = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (delta > 2) differing += 1;
    maxDelta = Math.max(maxDelta, delta);
  }
  return { differing, total: a.width * a.height, maxDelta };
}

const before = await captureAll('before', beforeUrl);
const after = await captureAll('after', afterUrl);
for (const shotAfter of after) {
  const shotBefore = before.find((s) => s.id === shotAfter.id && s.mode === shotAfter.mode);
  results.tiles.push({ id: shotAfter.id, mode: shotAfter.mode, before: { border: shotBefore.border, outline: shotBefore.outline, transform: shotBefore.transform, radius: shotBefore.radius }, after: { border: shotAfter.border, outline: shotAfter.outline, transform: shotAfter.transform, radius: shotAfter.radius, pointerEvents: shotAfter.pointerEvents, isActive: shotAfter.isActive, isFocusVisible: shotAfter.isFocusVisible }, diff: diff(shotBefore.path, shotAfter.path), ...(shotAfter.id.endsWith('working') ? { diffAboveBand: diff(shotBefore.path, shotAfter.path, 18) } : {}) });
}
await writeFile(`${out}/tiles.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log('done', results.tiles.length, 'pairs');
