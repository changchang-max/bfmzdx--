import { chromium } from 'playwright';
import fs from 'node:fs';
import { appUrl } from '../server/src/env.mjs';
const TARGET = appUrl();
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
const info = await page.evaluate(() => {
  const out = [];
  // walk all visible elements, record tag/class/text short
  document.querySelectorAll('*').forEach(el => {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
    const t = (el.innerText || '').trim();
    const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (own && own.length < 20) out.push(`${el.tagName}.${(el.className||'').toString().slice(0,40)} -> "${own}"`);
  });
  return out.slice(0, 120);
});
console.log(info.join('\n'));
const pw = await page.evaluate(() => {
  const p = Array.from(document.querySelectorAll('input[name=password]')).find(e => e.offsetParent !== null);
  let node = p, chain = [];
  for (let i = 0; i < 6 && node; i++) { chain.push(node.tagName + '.' + (node.className||'').toString().slice(0,60)); node = node.parentElement; }
  return chain.join(' < ');
});
console.log('PWCHAIN:', pw);
fs.writeFileSync('artifacts/visible.txt', info.join('\n'));
await browser.close();