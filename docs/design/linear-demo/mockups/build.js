/**
 * Documentation-only renderer. Run from the repository root after npm ci:
 * MOCKUP_TOOLS=<directory with @tailwindcss/cli installed> node docs/design/linear-demo/mockups/build.js
 * esbuild, React, the ui package and the console parts come from the workspace.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const here = resolve('docs/design/linear-demo/mockups');
const tools = process.env.MOCKUP_TOOLS;
if (!tools) throw new Error('Set MOCKUP_TOOLS to a directory with @tailwindcss/cli installed.');
execFileSync(resolve('node_modules/.bin/esbuild'), [
  `${here}/screens.jsx`, '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic', '--log-level=warning',
  '--conditions=@aeolus-fleet/source', `--alias:next/link=${here}/link-shim.jsx`, `--outfile=${here}/render.cjs`,
], { stdio: 'inherit' });
execFileSync(process.execPath, [`${here}/render.cjs`, `${here}/artboards`], { stdio: 'inherit' });
execFileSync(`${tools}/node_modules/.bin/tailwindcss`, ['-i', `${here}/input.css`, '-o', `${here}/artboards/mockups.css`, '--minify'], { stdio: 'inherit' });
writeFileSync(`${here}/artboards/mockups.css`, `${readFileSync(`${here}/artboards/mockups.css`, 'utf8')}\n${readFileSync(`${here}/tour.css`, 'utf8')}`);
unlinkSync(`${here}/render.cjs`);
