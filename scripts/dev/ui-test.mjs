import { chromium } from 'playwright';
import { credentials } from '../server/src/env.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const { username: USER, password: PASS } = credentials();
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
await page.screenshot({ path: 'artifacts/ui-1-login.png', fullPage: true });
console.log('login view ok');

await page.fill('#username', USER);
await page.fill('#password', PASS);
await page.click('#login-btn');
console.log('login clicked, waiting…');
await page.waitForSelector('#view-app:not(.hidden)', { timeout: 120000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'artifacts/ui-2-app.png', fullPage: true });
console.log('range:', await page.textContent('#range-text'));
console.log('chips:', await page.$$eval('#point-chips .chip', (els) => els.map((e) => e.textContent)));

// 选一个故意超出范围的点（地图点击）
const box = await page.locator('#map').boundingBox();
await page.mouse.click(box.x + 40, box.y + 40);
await page.waitForTimeout(500);
console.log('after map click range:', await page.textContent('#range-text'));

// 点 chip 回到签到点
await page.locator('#point-chips .chip').first().click();
await page.waitForTimeout(600);
console.log('after chip range:', await page.textContent('#range-text'));

// 上传照片
await page.setInputFiles('#file-album', 'artifacts/test-photo.png');
await page.waitForTimeout(800);
console.log('photo pill:', await page.textContent('#photo-pill'));
console.log('btn disabled:', await page.isDisabled('#checkin-btn'));
console.log('hint:', await page.textContent('#action-hint'));
await page.screenshot({ path: 'artifacts/ui-3-ready.png', fullPage: true });

// 点一次打卡（今天已打卡/未到时段，预期被拦下并给出明确提示）
await page.click('#checkin-btn').then(() => {}).catch(() => {});
await page.waitForTimeout(1500);
// 若按钮被禁用则直接调用接口验证错误分支
const resultText = await page.evaluate(async () => {
  const fd = new FormData();
  fd.append('sid', localStorage.getItem('zncq.sid'));
  fd.append('lng', '106.109536');
  fd.append('lat', '38.500879');
  const blob = await (await fetch('/vendor/leaflet/images/marker-icon.png')).blob();
  fd.append('photo', new File([blob], 'x.png', { type: 'image/png' }));
  const r = await fetch('/api/checkin', { method: 'POST', body: fd });
  return await r.json();
});
console.log('checkin api:', JSON.stringify(resultText).slice(0, 400));

await browser.close();