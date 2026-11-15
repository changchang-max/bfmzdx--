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
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#username', USER);
await page.fill('#password', PASS);
await page.click('#login-btn');
await page.waitForSelector('#view-app:not(.hidden)', { timeout: 120000 });
await page.waitForTimeout(2000);

// 地图点击（避开左上角缩放控件）
const box = await page.locator('#map').boundingBox();
await page.mouse.click(box.x + box.width * 0.82, box.y + box.height * 0.72);
await page.waitForTimeout(600);
console.log('map click →', await page.textContent('#range-text'));
console.log('coord →', await page.textContent('#coord-text'));

await page.setInputFiles('#file-album', 'artifacts/test-photo.png');
await page.waitForTimeout(600);
await page.screenshot({ path: 'artifacts/ui-4-final.png', fullPage: false });
await page.evaluate(() => window.scrollTo(0, 260));
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/ui-5-scroll.png', fullPage: false });
await page.evaluate(() => window.scrollTo(0, 720));
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/ui-6-bottom.png', fullPage: false });
await browser.close();