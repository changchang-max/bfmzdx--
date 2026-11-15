import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { appUrl, credentials } from '../server/src/env.mjs';

const { username: USER, password: PASS } = credentials();
const TARGET = appUrl();
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  geolocation: { latitude: 38.500879, longitude: 106.109536, accuracy: 30 }, permissions: ['geolocation'],
});
const page = await ctx.newPage();
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2000);
await page.locator('input[name=username]:visible').first().fill(USER);
await page.locator('input[name=password]:visible').first().fill(PASS);
await page.locator('input[name=button]').first().click();
await page.waitForTimeout(9000);

const scripts = await page.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map(s => s.src));
console.log('SCRIPTS:', scripts.length);
fs.mkdirSync('artifacts/js', { recursive: true });
const fetched = await page.evaluate(async (urls) => {
  const out = {};
  for (const u of urls) { try { const r = await fetch(u); out[u] = await r.text(); } catch (e) { out[u] = 'ERR ' + e.message; } }
  return out;
}, scripts);
for (const [u, t] of Object.entries(fetched)) {
  const name = u.split('/').pop().split('?')[0] || 'x.js';
  fs.writeFileSync(path.join('artifacts/js', name), t);
  console.log('SAVED', name, t.length);
}
console.log('PAGE TEXT:\n' + await page.evaluate(() => document.body.innerText));
console.log('STORAGE:', JSON.stringify(await page.evaluate(() => Object.keys(localStorage).slice(0, 30))));
await ctx.storageState({ path: 'artifacts/state.json' });
await browser.close();