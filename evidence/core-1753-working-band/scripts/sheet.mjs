import { createRequire } from 'node:module';
const require = createRequire('/home/thomas/.aeolus/trierarch/worktrees/aeolus-fleet/build-core-1753-band/package.json');
const sharp = require('sharp');
const dir = process.argv[2] ?? '/tmp/b1753/tiles';
const states = ['alert', 'awaitingCrew', 'blocked', 'working', 'idle'];
const modes = ['normal', 'hover', 'active', 'focus'];
for (const theme of ['light', 'dark']) {
  const first = await sharp(`${dir}/before-${theme}-alert-normal.png`).metadata();
  const w = first.width, h = first.height, gap = 8;
  const layers = [];
  states.forEach((state, row) => modes.forEach((mode, m) => ['before', 'after'].forEach((version, v) => {
    layers.push({ input: `${dir}/${version}-${theme}-${state}-${mode}.png`, left: (m * 2 + v) * (w + gap), top: row * (h + gap) });
  })));
  await sharp({ create: { width: 8 * (w + gap), height: 5 * (h + gap), channels: 4, background: theme === 'dark' ? '#000' : '#fff' } }).composite(layers).png().toFile(`${dir}/sheet-${theme}.png`);
}
console.log('ok');
