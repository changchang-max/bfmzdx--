import { chromium } from 'playwright';
import fs from 'node:fs';
import { appUrl, credentials } from '../server/src/env.mjs';

const { username: USER, password: PASS } = credentials();
const TARGET = appUrl();
const log = (...a) => { console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a); };
const watchdog = setTimeout(() => { log('WATCHDOG'); process.exit(2); }, 150000);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  geolocation: { latitude: 38.500879, longitude: 106.109536, accuracy: 30 }, permissions: ['geolocation'],
});
const page = await ctx.newPage();
const saved = {};
page.on('response', async r => {
  const u = r.url();
  if (/getKqInfo\.do|xscq\.do(\?|$)|dwdk\.html|xscq\.html/.test(u)) {
    try { saved[u.split('/').pop().split('?')[0]] = await r.text(); log('saved', u.slice(-50)); } catch {}
  }
});
log('goto');
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 });
log('filled');
await page.waitForTimeout(1500);
await page.locator('input[name=username]:visible').first().fill(USER);
await page.locator('input[name=password]:visible').first().fill(PASS);
await page.locator('input[name=button]').first().click();
log('clicked, waiting');
await page.waitForTimeout(9000);
log('URL', page.url());
for (const [k, v] of Object.entries(saved)) {
  fs.writeFileSync('artifacts/r_' + k, v);
  log('WROTE', k, v.length);
}
const state = await page.evaluate(() => ({ curlng: window.curlng, curlat: window.curlat, hasBMap: !!window.BMap }));
log('STATE', JSON.stringify(state));
log('GEO', await page.evaluate(() => new Promise(res => {
  if (!navigator.geolocation) return res('no api');
  let done = false;
  const t = setTimeout(() => { if (!done) { done = true; res('TIMEOUT'); } }, 3000);
  navigator.geolocation.getCurrentPosition(p => { if (!done) { done = true; clearTimeout(t); res('OK ' + p.coords.latitude + ',' + p.coords.longitude); } }, e => { if (!done) { done = true; clearTimeout(t); res('ERR ' + e.code + ' ' + e.message); } });
})));
log('TEXT', await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ')));
clearTimeout(watchdog);
await browser.close();
log('done');