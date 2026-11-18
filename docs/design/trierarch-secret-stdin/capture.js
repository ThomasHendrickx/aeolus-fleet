import { chromium } from 'playwright';
import { log } from 'node:console';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const browser = await chromium.launch({headless: true});
const out = 'docs/design/trierarch-secret-stdin/mockups';
await mkdir(out, {recursive:true});
for (const width of [375,1440,1920]) for (const theme of ['light','dark']) {
  for (const place of ['join','complete','renew']) for (const change of ['before','after']) {
    const completed = `${out}/${place}-${change==='after'?'copy-failed':'before'}-${width}-${theme}.png`;
    if (existsSync(completed)) continue;
    const context = await browser.newContext({viewport:{width,height:width===375?1100:1000}, permissions:['clipboard-read','clipboard-write']});
    const page = await context.newPage();
    await page.goto(`http://localhost:6029/iframe.html?id=mockups-secretstdin--${place}-${change}&viewMode=story&globals=theme:${theme}`);
    const prefix = place === 'renew' ? 'new-setup-line' : 'join-machine';
    const line = page.getByTestId(`${prefix}-setup-line`);
    await line.waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({path:`${out}/${place}-${change}-${width}-${theme}.png`, fullPage:true});
    if (change==='after') {
      const expected = await line.textContent();
      await page.getByTestId(`${prefix}-setup-line-copy`).click();
      await page.getByRole('button', {name:/Copy the setup line/}).filter({hasText:'Copied'}).waitFor();
      const copied = await page.evaluate(()=>globalThis.navigator.clipboard.readText());
      if (copied !== expected) throw new Error('Copy did not preserve the complete setup line');
      await page.screenshot({path:`${out}/${place}-copied-${width}-${theme}.png`,fullPage:true});
      await page.waitForTimeout(1550);
      await page.evaluate(()=>Object.defineProperty(globalThis.navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('Unavailable'))}}));
      await page.getByTestId(`${prefix}-setup-line-copy`).click();
      await page.getByText('Could not copy: select the text and copy it by hand.').waitFor();
      await page.screenshot({path:`${out}/${place}-copy-failed-${width}-${theme}.png`,fullPage:true});
    }
    log(`${place} ${change} ${width} ${theme}: rendered${change==='after'?', clipboard exact, Copied feedback and failure feedback verified':''}`);
    await context.close();
  }
}
await browser.close();
