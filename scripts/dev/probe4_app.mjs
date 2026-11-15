import { chromium } from 'playwright';
import fs from 'node:fs';
import { appUrl, credentials } from '../server/src/env.mjs';

const TARGET = appUrl();
const { username: USER, password: PASS } = credentials();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  geolocation: { latitude: 38.4963, longitude: 106.1399, accuracy: 20 },
  permissions: ['geolocation'],
});
const page = await ctx.newPage();

const reqs = [];
page.on('request', r => { const u = r.url(); if (!/\.(js|css|png|jpg|woff2?|svg|ico)(\?|$)/.test(u)) reqs.push({ m: r.method(), u, body: (r.postData() || '').slice(0, 600) }); });
const resps = [];
page.on('response', async r => {
  const u = r.url();
  if (/\/xsfw\/sys\/swmzncqapp\//.test(u) && !/\.(js|css|png|jpg|woff2?|svg|ico)(\?|$)/.test(u)) {
    let txt = '';
    try { txt = (await r.text()).slice(0, 1500); } catch {}
    resps.push({ s: r.status(), u, txt });
  }
});

await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);
await page.locator('input[name=username]:visible').first().fill(USER);
await page.locator('input[name=password]:visible').first().fill(PASS);
await page.locator('input[name=button]').first().click();
await page.waitForTimeout(9000);
console.log('URL:', page.url());
console.log('TITLE:', await page.title());

fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/kq.html', await page.content());
await page.screenshot({ path: 'artifacts/kq.png' });

console.log('\n===== REQUESTS =====');
for (const r of reqs) console.log(r.m, r.u.replace('https://xsfw.nmu.edu.cn', ''), r.body ? '\n   BODY: ' + r.body : '');
console.log('\n===== APP RESPONSES =====');
for (const r of resps) console.log(`[${r.s}] ${r.u.replace('https://xsfw.nmu.edu.cn', '')}\n   ${r.txt.replace(/\s+/g, ' ').slice(0, 700)}`);

// dump text of page
const txt = await page.evaluate(() => document.body.innerText);
console.log('\n===== PAGE TEXT =====\n' + txt);
await browser.close();