import { chromium } from 'playwright';
import { appUrl, credentials } from '../server/src/env.mjs';
const { username: USER, password: PASS } = credentials();
const TARGET = appUrl();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
setTimeout(() => { log('WATCHDOG'); process.exit(2); }, 170000);

// 虚拟定位：直接接管 SDK.getCurrentPosition（百度坐标 BD09）
const VIRTUAL = { lng: 106.109536, lat: 38.500879 };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
});
await ctx.addInitScript(() => {
  window.__VIRTUAL_GEO__ = { lng: 106.109536, lat: 38.500879 };
  // 1) 拦截 navigator.geolocation
  const geo = navigator.geolocation;
  if (geo) {
    geo.getCurrentPosition = (ok) => ok({
      coords: { latitude: window.__VIRTUAL_GEO__.lat, longitude: window.__VIRTUAL_GEO__.lng, accuracy: 15, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    });
    geo.watchPosition = (ok) => { geo.getCurrentPosition(ok); return 1; };
  }
  // 2) 拦截 SDK 赋值，改写 getCurrentPosition
  let sdk;
  Object.defineProperty(window, 'SDK', {
    configurable: true,
    get() { return sdk; },
    set(v) {
      sdk = v;
      if (v && typeof v === 'object') {
        v.getCurrentPosition = function () {
          return Promise.resolve({ longitude: window.__VIRTUAL_GEO__.lng, latitude: window.__VIRTUAL_GEO__.lat, isGaode: false, accuracy: 15 });
        };
      }
    },
  });
});

const page = await ctx.newPage();
page.on('console', m => { const t = m.text(); if (/签到|定位|初次进入/.test(t)) log('[console]', t.slice(0, 200)); });
page.on('request', r => { const u = r.url(); if (/addKqInfo|upload|filePubAuth/i.test(u)) log('[REQ]', r.method(), u.slice(-90), (r.postData() || '').slice(0, 200)); });
page.on('response', async r => { const u = r.url(); if (/addKqInfo|upload|filePubAuth/i.test(u)) { let t = ''; try { t = (await r.text()).slice(0, 400); } catch {} log('[RES]', r.status(), u.slice(-70), t); } });

await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1500);
await page.locator('input[name=username]:visible').first().fill(USER);
await page.locator('input[name=password]:visible').first().fill(PASS);
await page.locator('input[name=button]').first().click();
await page.waitForTimeout(9000);
log('TEXT', (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | '));
log('GEOAPI', JSON.stringify(await page.evaluate(() => ({ curlng: window.curlng, curlat: window.curlat }))));

// 找上传控件
const inputs = await page.locator('input[type=file]').count();
log('file inputs:', inputs);
if (inputs) {
  await page.locator('input[type=file]').first().setInputFiles('artifacts/test-photo.png');
  await page.waitForTimeout(6000);
  const fv = await page.evaluate(() => {
    const el = document.querySelector('#kqqd-smkq');
    const vm = el && el.__vue__;
    return vm ? { formValue: vm.formValue, canSign: vm.canSign, address: vm.address, inPostion: vm.inPostion } : 'no vm';
  });
  log('FORM STATE', JSON.stringify(fv).slice(0, 600));
  log('TEXT2', (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 400));
}
await page.screenshot({ path: 'artifacts/probe7.png', fullPage: true });
await browser.close();
log('bye');