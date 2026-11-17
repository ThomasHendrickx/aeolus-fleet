/** Build documentation artboards from the checked-out real UI parts. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, cpSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { build } = require(process.env.MOCKUP_TOOLS + '/node_modules/esbuild');
const here = resolve('docs/design/hosted-onboarding/mockups');
await build({entryPoints:[here+'/screens.jsx'],bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:here+'/render.cjs',nodePaths:[process.env.MOCKUP_TOOLS+'/node_modules'],alias:{'@aeolus-fleet/ui':here+'/parts.jsx'},packages:undefined});
execFileSync(process.execPath,[here+'/render.cjs',here+'/artboards'],{stdio:'inherit'});
const entries=JSON.parse(readFileSync(here+'/artboards/manifest.json','utf8'));
for(const id of [...new Set(entries.map(e=>e.id))]){
 const rows=entries.filter(e=>e.id===id);
 const title=rows[0].title;
 const body=rows.map(e=>`<section id="${e.name}"><h2>${e.era} · ${e.path} · ${e.state}</h2><p><a href="${e.name}.html">Open responsive artboard</a></p><div class="pair"><figure><figcaption>Phone · 375 × 812</figcaption><iframe title="${title} ${e.era} ${e.state} phone" src="${e.name}.html" width="375" height="812"></iframe></figure><figure><figcaption>Desktop · 1440 × 1000 (scaled to fit this review sheet)</figcaption><div class="desktop-preview"><iframe title="${title} ${e.era} ${e.state} desktop" src="${e.name}.html" width="1440" height="1000"></iframe></div></figure></div></section>`).join('');
 writeFileSync(here+`/artboards/sheet-${id}.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M${id} ${title}: phone and desktop</title><link rel="stylesheet" href="mockups.css"><body><main><a href="index.html">All screens</a><h1>M${id} ${title}: before and after</h1>${body}</main></body></html>`);
}
let index=readFileSync(here+'/artboards/index.html','utf8');
index=index.replaceAll(/<h2>M(\d+) · ([^<]+)<\/h2>/g,'<h2><a href="sheet-$1.html">M$1 · $2: phone and desktop</a></h2>');
writeFileSync(here+'/artboards/index.html',index);

const temporaryCss=here+'/compiled-input.css';
writeFileSync(temporaryCss,readFileSync(here+'/input.css','utf8').replace('"tailwindcss"',JSON.stringify(process.env.MOCKUP_TOOLS+'/node_modules/tailwindcss')));
execFileSync(process.env.MOCKUP_TOOLS+'/node_modules/.bin/tailwindcss',['-i',temporaryCss,'-o',here+'/artboards/mockups.css','--minify'],{stdio:'inherit'});
writeFileSync(here+'/artboards/mockups.css',readFileSync(here+'/artboards/mockups.css','utf8')+'\n'+readFileSync(here+'/layout.css','utf8'));
unlinkSync(temporaryCss);
unlinkSync(here+'/render.cjs');

cpSync('packages/console/public/brand',here+'/artboards/brand',{recursive:true});
for(const entry of entries){const file=here+'/artboards/'+entry.name+'.html';writeFileSync(file,readFileSync(file,'utf8').replaceAll('/brand/','brand/'));}
