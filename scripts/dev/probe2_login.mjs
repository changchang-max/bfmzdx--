import { chromium } from 'playwright';
import fs from 'node:fs';
import { appUrl, credentials } from '../server/src/env.mjs';

const TARGET = appUrl();
const { username: USER, password: PASS } = credentials();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();
page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('[NAV]', f.url().slice(0, 180)); });
page.on('response', r => {
  const u = r.url();
  if (u.includes('/cas/') && r.request().method() === 'POST') console.log('[POST]', r.status(), u.slice(0, 140));
});
page.on('console', m => { if (m.type() === 'error') console.log('[ERR]', m.text().slice(0, 160)); });

await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);

const uInput = page.locator('input[name=username]:visible').first();
const pInput = page.locator('input[name=password]:visible').first();
await uInput.fill(USER);
await pInput.fill(PASS);
await page.waitForTimeout(300);
await page.locator('input[name=button]').first().click();
await page.waitForTimeout(6000);
console.log('AFTER-LOGIN URL:', page.url().slice(0, 200));
console.log('TITLE:', await page.title());

fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/after_login.html', await page.content());
await page.screenshot({ path: 'artifacts/after_login.png', fullPage: false });

// dump cookies
const cookies = await ctx.cookies();
console.log('COOKIES:', cookies.map(c => `${c.domain}${c.path} ${c.name}=${String(c.value).slice(0, 12)}`).join(' | ').slice(0, 1200));
await ctx.storageState({ path: 'artifacts/state.json' });
await browser.close();