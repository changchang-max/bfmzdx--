import { chromium } from 'playwright';
import { credentials } from '../server/src/env.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const { username: USER, password: PASS } = credentials();
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#username', USER);
await page.fill('#password', PASS);
await page.click('#login-btn');
await page.waitForSelector('#view-app:not(.hidden)', { timeout: 120000 });
await page.waitForTimeout(1500);

// 刷新按钮
await page.click('#refresh-btn');
await page.waitForTimeout(2500);
console.log('refresh ok, range:', await page.textContent('#range-text'));

// 会话恢复：直接重新加载页面
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
const appVisible = await page.isVisible('#view-app');
console.log('reload keeps session:', appVisible, '| range:', appVisible ? await page.textContent('#range-text') : '-');

await page.screenshot({ path: 'artifacts/ui-7-final.png', fullPage: false });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();