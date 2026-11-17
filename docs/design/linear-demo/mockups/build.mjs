/** Documentation-only renderer. MOCKUP_TOOLS is a separate npm tool directory. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
const require=createRequire(import.meta.url);
const here=resolve('docs/design/linear-demo/mockups');
const tools=process.env.MOCKUP_TOOLS;
const { build }=require(tools+'/node_modules/esbuild');
await build({entryPoints:[here+'/screens.jsx'],bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:here+'/render.cjs',nodePaths:[tools+'/node_modules'],alias:{'@aeolus-fleet/ui':here+'/parts.jsx'}});
execFileSync(process.execPath,[here+'/render.cjs',here+'/artboards'],{stdio:'inherit'});
writeFileSync(here+'/compiled-input.css',readFileSync(here+'/input.css','utf8').replace('"tailwindcss"',JSON.stringify(tools+'/node_modules/tailwindcss')));
execFileSync(tools+'/node_modules/.bin/tailwindcss',['-i',here+'/compiled-input.css','-o',here+'/artboards/mockups.css','--minify'],{stdio:'inherit'});
writeFileSync(here+'/artboards/mockups.css',readFileSync(here+'/artboards/mockups.css','utf8')+'\n'+readFileSync(here+'/layout.css','utf8'));
for(const file of ['render.cjs','compiled-input.css'])unlinkSync(here+'/'+file);
