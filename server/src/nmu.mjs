/**
 * 北方民族大学「智能查寝」自动化核心
 *
 * 流程：统一身份认证(CAS) 登录 → 进入 swmzncqapp 微应用 → getKqInfo 取签到点 →
 *       注入虚拟定位(BD09) → 上传打卡照片 → addKqInfo.do 提交打卡
 *
 * 关键事实（来自站点前端 dwdk.js / maputil.js，均已实测）：
 *   - 签到方式 CQFS=2 为「定位打卡」
 *   - 打卡提交接口：POST /xsfw/sys/swmzncqapp/kqController/addKqInfo.do
 *        body: data={"KQWZXX":地址,"JDZB":经度,"WDZB":纬度,"DZ_QDDD":签到点名称,"DZ_DKZP":照片令牌}
 *   - JDZB/WDZB 是**百度 BD09 坐标**，必须与 DD_LIST 中的签到点同一坐标系
 *   - 照片先经 uploadFile.do 上传，返回的 id 由前端加密为 DZ_DKZP 令牌
 *   - 服务端会二次校验时间窗（不在时段内返回 #E101080000000）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { matchCheckinPoint, nearestPoint, distanceMeters } from './geo.mjs';

export const HOST = 'https://xsfw.nmu.edu.cn';
export const INDEX_URL = `${HOST}/xsfw/sys/swmzncqapp/*default/index.do`;
export const ROUTE = '#/xscq/kqqdx';
const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let browserPromise = null;
export function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close().catch(() => {});
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面初始化脚本：接管 navigator.geolocation 与 SDK.getCurrentPosition，实现虚拟定位 */
function geoSpoofScript() {
  window.__VIRTUAL_GEO__ = window.__VIRTUAL_GEO__ || { lng: 106.109536, lat: 38.500879 };
  try {
    const g = navigator.geolocation;
    if (g) {
      const fake = (ok) =>
        ok({
          coords: {
            latitude: window.__VIRTUAL_GEO__.lat,
            longitude: window.__VIRTUAL_GEO__.lng,
            accuracy: 12,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        });
      g.getCurrentPosition = (ok) => fake(ok);
      g.watchPosition = (ok) => {
        fake(ok);
        return 1;
      };
    }
  } catch {}
  // SDK 对象的 getCurrentPosition 才是这个应用真正调用的入口
  let realSdk;
  Object.defineProperty(window, 'SDK', {
    configurable: true,
    get() {
      return realSdk;
    },
    set(v) {
      realSdk = v;
      if (v && typeof v === 'object') {
        v.getCurrentPosition = function () {
          return Promise.resolve({
            longitude: window.__VIRTUAL_GEO__.lng,
            latitude: window.__VIRTUAL_GEO__.lat,
            isGaode: false,
            accuracy: 12,
          });
        };
      }
    },
  });
}

export class NmuSession {
  constructor() {
    this.ctx = null;
    this.page = null;
    this.username = '';
    this.createdAt = Date.now();
    this.lastUsed = Date.now();
    this.lastState = null;
  }

  touch() {
    this.lastUsed = Date.now();
  }

  async login(username, password) {
    this.username = username;
    const browser = await getBrowser();
    this.ctx = await browser.newContext({
      userAgent: UA_MOBILE,
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      ignoreHTTPSErrors: true,
    });
    await this.ctx.addInitScript(geoSpoofScript);
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(45000);

    await this.page.goto(INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(800);

    if (/cas\.nmu\.edu\.cn/.test(this.page.url())) {
      await this.casLogin(username, password);
    }
    await this.waitApp();
    const state = await this.state();
    this.lastState = state;
    return state;
  }

  async casLogin(username, password) {
    const page = this.page;
    await page.locator('input[name=username]:visible').first().waitFor({ timeout: 45000 });
    await page.locator('input[name=username]:visible').first().fill(username);
    await page.locator('input[name=password]:visible').first().fill(password);

    // 若已出现图形验证码，说明该 IP 登录失败次数过多，需要人工处理
    const captchaVisible = await page
      .locator('input[name=captcha]:visible')
      .first()
      .isVisible()
      .catch(() => false);

    const nav = page.waitForURL((u) => u.hostname.includes('xsfw.nmu.edu.cn'), { timeout: 60000 });
    await page.locator('input[name=button]').first().click();

    try {
      await nav;
    } catch {
      const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')).catch(() => '');
      if (captchaVisible || /验证码/.test(txt)) {
        const err = new Error('统一认证要求输入图形验证码（同一网络登录失败次数过多），请先在浏览器里手动登录一次再试');
        err.code = 'CAPTCHA';
        throw err;
      }
      const m = txt.match(/(用户名|密码|账号)[^。]{0,40}?(错误|不正确|锁定|过期)/);
      const err = new Error(m ? `统一认证登录失败：${m[0]}` : `统一认证登录失败：${txt.slice(0, 120) || '超时'}`);
      err.code = 'LOGIN_FAILED';
      throw err;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(600);
  }

  /** 进入「考勤签到」页面并等待组件 ready */
  async waitApp() {
    const page = this.page;
    if (!page.url().includes('#/xscq/kqqdx')) {
      await page.goto(INDEX_URL + ROUTE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    // 站点可能把路由再重定向一次，保证停在 kqqdx
    if (!page.url().includes('#/xscq/kqqdx')) {
      await page.evaluate(() => {
        location.hash = '#/xscq/kqqdx';
      });
    }
    try {
      await page.waitForSelector('#kqqd-smkq', { timeout: 45000 });
      await page.waitForFunction(
        () => {
          const vm = document.querySelector('#kqqd-smkq') && document.querySelector('#kqqd-smkq').__vue__;
          return !!(vm && (vm.sslInfo && vm.sslInfo.SSLDM ? true : vm.hasZsxx === false));
        },
        null,
        { timeout: 45000 },
      );
    } catch (e) {
      const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')).catch(() => '');
      const err = new Error(`进入智能查寝页面失败：${txt.slice(0, 150)}`);
      err.code = 'APP_LOAD_FAILED';
      throw err;
    }
  }

  /** 读取服务端 getKqInfo 原始数据 + 页面组件状态 */
  async state() {
    const raw = await this.page.evaluate(async () => {
      const r = await fetch('/xsfw/sys/swmzncqapp/kqController/getKqInfo.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'data=' + encodeURIComponent('{}'),
        credentials: 'include',
      });
      return await r.json();
    });
    if (!raw || raw.code !== '0') {
      const err = new Error(`读取查寝信息失败：${(raw && raw.msg) || '未知错误'}`);
      err.code = 'STATE_FAILED';
      throw err;
    }
    const vm = await this.page
      .evaluate(() => {
        const el = document.querySelector('#kqqd-smkq');
        const v = el && el.__vue__;
        if (!v) return null;
        return {
          canSign: !!v.canSign,
          inPostion: !!v.inPostion,
          address: v.address || '',
          kqTime: v.kqTime || '',
          photo: (v.formValue && v.formValue.DZ_DKZP) || '',
          cqfs: v.cqfs,
        };
      })
      .catch(() => null);

    this.lastState = this.normalize(raw.data, vm);
    return this.lastState;
  }

  normalize(d, vm) {
    const c = d.CONFIG_INFO || {};
    const q = d.QD_INFO || {};
    const s = d.SSL_INFO || {};
    const points = (d.DD_LIST || []).map((p) => ({
      name: p.QDDD,
      lng: Number(p.JDZB),
      lat: Number(p.WDZB),
      radius: Number(p.YXFW || 0),
    }));
    return {
      user: {
        name: s.XM || '',
        xh: s.XH || this.username,
        dorm: s.SSLDM_DISPLAY || '',
        room: s.FJH || '',
        college: s.DWDM_DISPLAY || '',
        major: s.ZYDM_DISPLAY || '',
        cls: s.BJDM_DISPLAY || '',
      },
      window: { start: c.DZ_DKKSSJ || c.CQKSSJ || '', end: c.DZ_DKJSSJ || c.CQJSSJ || '' },
      flags: {
        inTime: !!c.IN_TIME,
        inDate: !!c.IN_DATE,
        inWgTime: !!c.IN_WG_TIME,
        cqfs: c.CQFS,
        cqfsText: c.CQFS_DISPLAY || '',
        isQj: !!d.IS_QJ,
        today: c.KQRQ || '',
      },
      today: {
        hasQd: !!q.hasQd,
        isZcgs: !!q.IS_ZCGS,
        isWg: !!q.IS_WG,
        hasQdhcq: !!q.hasQdhcq,
        gssj: q.GSSJ || '',
        last: d.QDJL_INFO || {},
      },
      points,
      vm,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** 注入虚拟定位（BD09），并触发前端重新计算「是否在签到范围」 */
  async applyLocation(lng, lat) {
    await this.page.evaluate(
      ({ lng, lat }) => {
        window.__VIRTUAL_GEO__ = { lng, lat };
        window.curlng = lng;
        window.curlat = lat;
        const el = document.querySelector('#kqqd-smkq');
        const vm = el && el.__vue__;
        if (vm && typeof vm.getKqInfo === 'function') vm.getKqInfo();
      },
      { lng, lat },
    );
    // 等待前端把 inPostion / address 算出来
    await sleep(2500);
    return this.page.evaluate(() => {
      const el = document.querySelector('#kqqd-smkq');
      const v = el && el.__vue__;
      return v ? { inPostion: !!v.inPostion, address: v.address || '', canSign: !!v.canSign } : {};
    });
  }

  /** 上传打卡照片，返回 DZ_DKZP 令牌 */
  async uploadPhoto(filePath) {
    const page = this.page;
    const input = page.locator('#kqqd-smkq input[type=file]').first();
    await input.waitFor({ state: 'attached', timeout: 20000 });
    await input.setInputFiles(filePath);
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#kqqd-smkq');
        const v = el && el.__vue__;
        return !!(v && v.formValue && v.formValue.DZ_DKZP);
      },
      null,
      { timeout: 45000 },
    );
    return page.evaluate(() => document.querySelector('#kqqd-smkq').__vue__.formValue.DZ_DKZP);
  }

  /** 提交打卡 */
  async submit({ lng, lat, qddd, address, token }) {
    return this.page.evaluate(
      async (payload) => {
        const r = await fetch('/xsfw/sys/swmzncqapp/kqController/addKqInfo.do', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: 'data=' + encodeURIComponent(JSON.stringify(payload)),
          credentials: 'include',
        });
        const text = await r.text();
        try {
          return { status: r.status, ...JSON.parse(text) };
        } catch {
          return { status: r.status, code: 'BAD_RESPONSE', msg: text.slice(0, 200) };
        }
      },
      { KQWZXX: address, JDZB: lng, WDZB: lat, DZ_QDDD: qddd, DZ_DKZP: token },
    );
  }

  /**
   * 完整打卡
   * @param {object} opt {lng, lat, photoPath}  lng/lat 为 BD09
   */
  async checkin({ lng, lat, photoPath }) {
    const steps = [];
    const push = (k, text, ok = true) => steps.push({ key: k, text, ok, at: Date.now() });

    const st = await this.state();
    push('state', `已读取查寝信息：${st.user.dorm || '宿舍未配置'}，打卡时段 ${st.window.start}-${st.window.end}`);

    if (!st.flags.inDate) {
      return { ok: false, code: 'NOT_CHECKIN_DAY', message: '今天不是考勤日，无需打卡', steps, state: st };
    }
    if (st.flags.isQj) {
      return { ok: false, code: 'ON_LEAVE', message: '当前为离校请假状态，无法打卡', steps, state: st };
    }
    if (st.today.isZcgs || (st.today.hasQd && !st.today.hasQdhcq)) {
      return {
        ok: false,
        code: 'ALREADY_DONE',
        message: `今日已完成打卡（${st.today.isZcgs ? '正常归宿' : '已签到'}${st.today.gssj ? '，' + st.today.gssj : ''}）`,
        steps,
        state: st,
      };
    }
    if (!st.flags.inTime) {
      return {
        ok: false,
        code: 'OUT_OF_WINDOW',
        message: `当前不在打卡时段（${st.window.start}-${st.window.end}），服务端会拒绝提交`,
        steps,
        state: st,
      };
    }

    const hit = matchCheckinPoint(st.points, lng, lat);
    if (!hit) {
      const near = nearestPoint(st.points, lng, lat);
      return {
        ok: false,
        code: 'OUT_OF_RANGE',
        message: near
          ? `所选位置不在任何签到范围内：最近的是「${near.point.name}」，还差 ${Math.round(near.distance)} 米（允许 ${near.point.radius} 米）`
          : '没有可用签到点',
        steps,
        state: st,
      };
    }
    push('point', `命中签到点「${hit.point.name}」，距中心 ${hit.distance.toFixed(1)} 米（允许 ${hit.point.radius} 米）`);

    const loc = await this.applyLocation(lng, lat);
    push(
      'geo',
      `虚拟定位已注入：${lng.toFixed(6)}, ${lat.toFixed(6)} → 前端判定 ${loc.inPostion ? '在范围内' : '不在范围内'}（${loc.address || '-'}）`,
      !!loc.inPostion,
    );
    if (!loc.inPostion) {
      return {
        ok: false,
        code: 'PAGE_REJECTED',
        message: '站点前端未认可该定位，请换一个更靠近签到点中心的位置',
        steps,
        state: st,
      };
    }

    if (!photoPath || !fs.existsSync(photoPath)) {
      return { ok: false, code: 'NO_PHOTO', message: '缺少打卡照片', steps, state: st };
    }
    const token = await this.uploadPhoto(photoPath);
    push('photo', `照片上传成功，已获取文件令牌 ${String(token).slice(0, 8)}…`);

    const res = await this.submit({
      lng,
      lat,
      qddd: hit.point.name,
      address: hit.point.name,
      token,
    });
    const okSubmit = res && res.code === '0';
    push('submit', okSubmit ? '服务端返回打卡成功' : `服务端拒绝：${res && res.msg ? res.msg : JSON.stringify(res)}`, okSubmit);

    const after = await this.state().catch(() => null);
    if (okSubmit) {
      return { ok: true, code: 'OK', message: '打卡成功', serverMsg: res.msg || '', steps, state: after };
    }
    return {
      ok: false,
      code: 'SERVER_REJECTED',
      message: (res && res.msg) || '服务端拒绝了本次打卡',
      raw: res,
      steps,
      state: after,
    };
  }

  async close() {
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null;
    this.page = null;
  }
}

export { sleep, distanceMeters };