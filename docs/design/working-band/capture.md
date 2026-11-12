# Reproduce the screen evidence

From the repository root, after `npm ci` and `npx playwright install chromium`, run:

```sh
node --input-type=module <<'JS'
import { chromium } from 'playwright';
import {writeFile} from 'node:fs/promises';
const root=process.cwd(),browser=await chromium.launch({headless:true}),page=await browser.newPage();const checks=[];
for(const [device,width,height] of [['desktop',1440,1000],['phone',390,844]])for(const theme of ['light','dark'])for(const mode of ['before','after'])for(const reduce of [0,1]){await page.setViewportSize({width,height});await page.goto(`file://${root}/docs/design/working-band/preview.html?theme=${theme}&mode=${mode}&reduce=${reduce}`);await page.waitForTimeout(400);await page.screenshot({path:`${root}/docs/design/working-band/evidence/${device}-${theme}-${mode}${reduce?'-reduced':''}.png`,fullPage:true});checks.push({device,theme,mode,reduce,...await page.locator('i').first().evaluate(e=>({duration:getComputedStyle(e).animationDuration,animation:getComputedStyle(e).animationName,opacity:getComputedStyle(e).opacity}))});}
await page.goto(`file://${root}/docs/design/working-band/preview.html`);const start=await page.locator('.tile').first().boundingBox();for(const state of ['alert','awaitingCrew','blocked','idle','working']){await page.selectOption('#state',state);await page.waitForTimeout(220);const box=await page.locator('.tile').first().boundingBox();if(JSON.stringify(box)!==JSON.stringify(start))throw Error('Tile moved');checks.push({state,box,word:await page.locator('.word').first().textContent(),bands:await page.locator('.tile').first().locator('i').count()});await page.screenshot({path:`${root}/docs/design/working-band/evidence/state-${state}.png`,fullPage:true});}
await page.emulateMedia({reducedMotion:'reduce'});checks.push({osReduced:await page.locator('i').first().evaluate(e=>getComputedStyle(e).animationName)});await writeFile(`${root}/docs/design/working-band/evidence/checks.json`,JSON.stringify(checks,null,2));await browser.close();console.log('Captured 16 comparisons and 5 state screens; state boxes stable; OS reduced motion checked.');

JS
```
