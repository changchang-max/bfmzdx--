import { chromium } from 'playwright';
import { appUrl, credentials } from '../server/src/env.mjs';
const { username: USER, password: PASS } = credentials();
const TARGET = appUrl();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const W = { lng: 106.109536, lat: 38.500879 };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
});
await ctx.addInitScript(`window.__VIRTUAL_GEO__=${JSON.stringify(W)};
  (function(){ const g=navigator.geolocation; if(g){ g.getCurrentPosition=(ok)=>ok({coords:{latitude:__VIRTUAL_GEO__.lat,longitude:__VIRTUAL_GEO__.lng,accuracy:15},timestamp:Date.now()}); g.watchPosition=(ok)=>1; }
  let s; Object.defineProperty(window,'SDK',{configurable:true,get(){return s;},set(v){s=v; if(v&&typeof v==='object'){ v.getCurrentPosition=function(){ return Promise.resolve({longitude:__VIRTUAL_GEO__.lng,latitude:__VIRTUAL_GEO__.lat,isGaode:false,accuracy:15}); }; }}});
})();`);
const page = await ctx.newPage();
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1500);
await page.locator('input[name=username]:visible').first().fill(USER);
await page.locator('input[name=password]:visible').first().fill(PASS);
await page.locator('input[name=button]').first().click();
await page.waitForTimeout(9000);

await page.locator('input[type=file]').first().setInputFiles('artifacts/test-photo.png');
await page.waitForTimeout(5000);
const fv = await page.evaluate(() => document.querySelector('#kqqd-smkq').__vue__.formValue);
log('photo token:', JSON.stringify(fv));

const result = await page.evaluate(async (payload) => {
  const r = await fetch('/xsfw/sys/swmzncqapp/kqController/addKqInfo.do', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: 'data=' + encodeURIComponent(JSON.stringify(payload)),
    credentials: 'include',
  });
  return { status: r.status, text: (await r.text()).slice(0, 800) };
}, { KQWZXX: '东2学生社区', JDZB: W.lng, WDZB: W.lat, DZ_QDDD: '东2学生社区', DZ_DKZP: fv.DZ_DKZP });
log('ADDKQINFO', JSON.stringify(result));
await browser.close();
log('bye');
process.exit(0);