import { createRequire } from 'node:module';
const require = createRequire('/home/thomas/.aeolus/trierarch/worktrees/aeolus-fleet/build-core-1753-band/package.json');
const sharp = require('sharp');
const [a, b, d, out] = process.argv.slice(2);
const A = sharp(a); const meta = await A.metadata();
// before | after | amplified difference
const diff = await sharp(a).composite([{ input: b, blend: 'difference' }]).linear(8, 0).toBuffer();
await sharp({ create: { width: meta.width * 3 + 20, height: meta.height, channels: 4, background: '#ffffff' } })
  .composite([{ input: a, left: 0, top: 0 }, { input: b, left: meta.width + 10, top: 0 }, { input: diff, left: meta.width * 2 + 20, top: 0 }])
  .png().toFile(out);
