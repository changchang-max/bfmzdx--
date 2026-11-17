/**
 * 回归测试：Chromium 实例被关掉后，下一次登录不能抛
 *   browser.newContext: Target page, context or browser has been closed
 *
 *   node scripts/dev/browser-recover-test.mjs
 *
 * 只验证浏览器生命周期：用一个假站点代替学校页面，不发任何真实登录请求。
 */
import http from 'node:http';
import { chromium } from 'playwright';
import { getBrowser, closeBrowser, NmuSession } from '../../server/src/nmu.mjs';

const ok = [];
const bad = [];
const check = (name, pass, extra = '') => {
  (pass ? ok : bad).push(name + (extra ? ` (${extra})` : ''));
  console.log(`${pass ? '√' : '×'} ${name}${extra ? '  ' + extra : ''}`);
};

// 1) 共享浏览器被外部关掉后，getBrowser() 必须换一个新的
const b1 = await getBrowser();
await b1.close();
const b2 = await getBrowser();
check('浏览器被关闭后 getBrowser 自动重启', b1 !== b2 && b2.isConnected());

// 2) 会话：页面被关掉 -> state() 立刻给出 BROWSER_CLOSED，而不是卡 45 秒超时
const s = new NmuSession();
s.ctx = await b2.newContext();
s.page = await s.ctx.newPage();
await s.page.close();
const t0 = Date.now();
let code = '';
try {
  await s.state();
} catch (e) {
  code = e.code;
}
check('页面被关闭后 state() 立即报 BROWSER_CLOSED', code === 'BROWSER_CLOSED', `${Date.now() - t0}ms`);
check('isAlive() 能识别死会话', s.isAlive() === false);

// 3) 整个浏览器进程消失后，再开会话不报 newContext 已关闭
await closeBrowser();
await b2?.close().catch(() => {});
const b3 = await getBrowser();
const ctx3 = await b3.newContext();
const page3 = await ctx3.newPage();
check('浏览器重启后 newContext 正常', ctx3.browser() === b3 && !page3.isClosed());
await ctx3.close();

// 4) 用真实 NmuSession 走一遍页面级流程（本地假站点，避免打学校接口）
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<html><body><div id="kqqd-smkq"></div>fake app</body></html>');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const s2 = new NmuSession();
await s2.openBrowser();
await s2.page.goto(`http://127.0.0.1:${port}/`);
check('openBrowser + 页面导航正常', s2.isAlive());
// 模拟用户/系统把浏览器关掉
await (await getBrowser()).close();
await new Promise((r) => setTimeout(r, 300));
check('浏览器进程消失后 isAlive() 为 false', s2.isAlive() === false);
let code2 = '';
try {
  await s2.state();
} catch (e) {
  code2 = e.code;
}
check('浏览器消失后 state() 报 BROWSER_CLOSED', code2 === 'BROWSER_CLOSED');
await s2.close();
// 再开一个新会话仍然可用
const s3 = new NmuSession();
await s3.openBrowser();
check('浏览器再次自动重启并可用', s3.isAlive());
await s3.close();
srv.close();

await closeBrowser();
console.log(`\n通过 ${ok.length} 项，失败 ${bad.length} 项`);
process.exit(bad.length ? 1 : 0);