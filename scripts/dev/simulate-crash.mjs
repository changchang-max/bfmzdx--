/**
 * 端到端复现：服务运行中，把 Chromium 进程树杀掉，再重新登录一次。
 *
 *   node server/src/server.mjs        # 另开一个终端
 *   node scripts/dev/simulate-crash.mjs
 *
 * 期望：第二次登录不再返回「browser.newContext: Target page, context or browser has been closed」，
 *       而是正常失败（账号错误）或正常成功——即共享浏览器被自动重启。
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const post = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
};

function serverPid() {
  const out = execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server/src/server.mjs' } | Select-Object -ExpandProperty ProcessId",
  ]).toString().trim();
  const pids = out.split(/\s+/).filter(Boolean);
  if (!pids.length) throw new Error('没找到运行中的服务进程，先 npm start');
  return pids[0];
}

function browsersOf(pid) {
  const out = execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`,
  ]).toString().trim();
  return out.split(/\s+/).filter(Boolean);
}

const bogus = { username: '12345678', password: 'wrongpass123' };
console.log('第一次登录 …');
console.log('→', JSON.stringify(await post('/api/login', bogus)));

const pid = serverPid();
const kids = browsersOf(pid);
console.log('杀掉 Chromium 进程:', kids.join(',') || '(当前没有，先跑一次登录再试)');
for (const k of kids) {
  execFileSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${k} -Force -ErrorAction SilentlyContinue`]);
}
await new Promise((r) => setTimeout(r, 1500));

console.log('Chromium 已消失，第二次登录 …');
const res = await post('/api/login', bogus);
console.log('→', JSON.stringify(res));
const recovered = !/has been closed/i.test(JSON.stringify(res));
console.log(recovered ? '\n√ 浏览器已自动重启，登录链路恢复正常' : '\n× 仍然报 closed，请贴出终端日志');
process.exit(recovered ? 0 : 1);