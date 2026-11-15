import { chromium } from 'playwright';
import fs from 'node:fs';
import { appUrl } from '../server/src/env.mjs';

const TARGET = appUrl();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
});
const page = await ctx.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text().slice(0, 200)));
page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('[nav]', f.url().slice(0, 160)); });

await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
console.log('URL:', page.url().slice(0, 200));
console.log('TITLE:', await page.title());

const fields = await page.evaluate(() => Array.from(document.querySelectorAll('input,button,select,textarea')).map(el => ({
  tag: el.tagName, type: el.type, name: el.name, id: el.id, placeholder: el.placeholder,
  cls: (el.className || '').toString().slice(0, 60), vis: el.offsetParent !== null,
  txt: (el.innerText || '').slice(0, 30),
})));
console.log(JSON.stringify(fields, null, 1).slice(0, 4000));

fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/probe1.html', await page.content());
await page.screenshot({ path: 'artifacts/probe1.png', fullPage: false });
await browser.close();