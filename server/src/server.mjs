/**
 * 智能查寝 · 打卡服务端
 *  - 前端：public/（手机浏览器访问）
 *  - 后端：Express + Playwright，登录学校统一认证并代用户在 sjfw 微应用里完成打卡
 */
import './env.mjs'; // 先加载 .env（PORT 等），源码中不出现任何真实凭据
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NmuSession, closeBrowser, sleep } from './nmu.mjs';
import { matchCheckinPoint, nearestPoint } from './geo.mjs';
import { mask } from './env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || 8787);
const SESSION_TTL_MS = 90 * 60 * 1000;

const app = express();
app.use(express.json({ limit: '1mb' }));

const uploadDir = path.join(ROOT, '.uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_q, f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(f.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/** sid -> { session, createdAt, lastUsed } */
const sessions = new Map();

function newSid() {
  return crypto.randomBytes(16).toString('hex');
}

function pickSession(sid) {
  const rec = sessions.get(sid);
  if (!rec) return null;
  // 浏览器/页面已经被关掉：直接判失效并清掉，避免后续操作在死页面上卡到超时
  if (typeof rec.session.isAlive === 'function' && !rec.session.isAlive()) {
    sessions.delete(sid);
    rec.session.close().catch(() => {});
    console.log('[session] 浏览器已断开，作废会话', String(sid).slice(0, 8));
    return null;
  }
  rec.lastUsed = Date.now();
  rec.session.touch();
  return rec.session;
}

// 定时清理闲置会话
setInterval(async () => {
  const now = Date.now();
  for (const [sid, rec] of sessions) {
    if (now - rec.lastUsed > SESSION_TTL_MS) {
      sessions.delete(sid);
      await rec.session.close().catch(() => {});
      console.log('[session] 清理闲置会话', sid.slice(0, 8));
    }
  }
}, 60 * 1000);

const fail = (res, code, message, extra = {}) => res.json({ ok: false, code, message, ...extra });

/** 会话已失效（含浏览器断开）时统一回收，前端据此回到登录页 */
function dropSession(sid, s) {
  if (sid) sessions.delete(sid);
  if (s) s.close().catch(() => {});
}

/** 把 Playwright 的「Target … has been closed」翻译成前端能看懂的话 */
function normalizeError(e) {
  const code = (e && e.code) || '';
  const msg = (e && e.message) || '服务器内部错误';
  if (code === 'BROWSER_CLOSED' || /Target page, context or browser has been closed|Target closed|browser has been closed/i.test(msg)) {
    return { code: 'BROWSER_CLOSED', message: '浏览器会话已断开（Chromium 被关闭或崩溃），请重新登录' };
  }
  return { code: code || 'SERVER_ERROR', message: msg };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime(), sessions: sessions.size }));

// 登录（为每个用户建立独立的浏览器会话）
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, 'BAD_INPUT', '请填写学号和密码');
  const sid = newSid();
  const session = new NmuSession();
  try {
    const state = await session.login(String(username).trim(), String(password));
    sessions.set(sid, { session, createdAt: Date.now(), lastUsed: Date.now() });
    console.log('[login] 成功', mask(username), 'dorm=', state.user.dorm || '-');
    res.json({ ok: true, sid, state });
  } catch (e) {
    await session.close().catch(() => {});
    const { code, message } = normalizeError(e);
    console.error('[login] 失败', code, message);
    fail(res, code, message);
  }
});

app.get('/api/state', async (req, res) => {
  const sid = req.query.sid;
  const s = pickSession(sid);
  if (!s) return fail(res, 'NO_SESSION', '会话已失效，请重新登录');
  try {
    const state = await s.state();
    res.json({ ok: true, state });
  } catch (e) {
    const { code, message } = normalizeError(e);
    if (code === 'BROWSER_CLOSED') dropSession(sid, s);
    fail(res, code === 'BROWSER_CLOSED' ? 'NO_SESSION' : code, code === 'BROWSER_CLOSED' ? '会话已失效，请重新登录' : message);
  }
});

// 打卡预览：只校验位置是否落在签到范围内，不提交
app.post('/api/preview', async (req, res) => {
  const { sid, lng, lat } = req.body || {};
  const s = pickSession(sid);
  if (!s) return fail(res, 'NO_SESSION', '会话已失效，请重新登录');
  const st = s.lastState || (await s.state().catch(() => null));
  if (!st) return fail(res, 'STATE_ERROR', '读取查寝信息失败');
  const hit = matchCheckinPoint(st.points, Number(lng), Number(lat));
  const near = nearestPoint(st.points, Number(lng), Number(lat));
  res.json({
    ok: true,
    inRange: !!hit,
    point: hit ? { name: hit.point.name, distance: Math.round(hit.distance), radius: hit.point.radius } : null,
    nearest: near ? { name: near.point.name, distance: Math.round(near.distance), radius: near.point.radius } : null,
    inTime: st.flags.inTime,
    window: st.window,
  });
});

// 打卡
app.post('/api/checkin', upload.single('photo'), async (req, res) => {
  const { sid, lng, lat } = req.body || {};
  const s = pickSession(sid);
  if (!s) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return fail(res, 'NO_SESSION', '会话已失效，请重新登录');
  }
  const lngN = Number(lng);
  const latN = Number(lat);
  if (!Number.isFinite(lngN) || !Number.isFinite(latN)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return fail(res, 'BAD_INPUT', '缺少有效的坐标');
  }
  if (!req.file) return fail(res, 'NO_PHOTO', '请先上传打卡照片');

  try {
    const result = await s.checkin({ lng: lngN, lat: latN, photoPath: req.file.path });
    console.log('[checkin]', mask(s.username), result.code, result.message);
    res.json(result);
  } catch (e) {
    const { code, message } = normalizeError(e);
    if (code === 'BROWSER_CLOSED') dropSession(sid, s);
    console.error('[checkin] 异常', code, message);
    fail(res, code === 'BROWSER_CLOSED' ? 'NO_SESSION' : code, code === 'BROWSER_CLOSED' ? '会话已失效，请重新登录' : message);
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

app.post('/api/logout', async (req, res) => {
  const sid = (req.body && req.body.sid) || req.query.sid;
  const rec = sessions.get(sid);
  if (rec) {
    sessions.delete(sid);
    await rec.session.close().catch(() => {});
  }
  res.json({ ok: true });
});

// —— 静态资源 ——
app.use('/vendor/leaflet', express.static(path.join(ROOT, 'node_modules/leaflet/dist')));
app.use(express.static(path.join(ROOT, 'public')));

app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return fail(res, 'FILE_TOO_LARGE', '照片超过 15MB');
  console.error('[server]', err);
  fail(res, 'SERVER_ERROR', (err && err.message) || '服务异常');
});

const server = app.listen(PORT, () => {
  console.log(`智能查寝打卡服务已启动: http://127.0.0.1:${PORT}`);
  console.log('手机与电脑在同一局域网时，用手机访问 http://<电脑局域网IP>:' + PORT);
});
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用：可能上次的服务还在运行（旧进程留着的 Chromium 也会一起占资源）。先结束旧进程再启动。`);
    process.exit(1);
  }
  throw e;
});

async function shutdown() {
  console.log('\n正在关闭…');
  server.close();
  // 各会话共用同一个浏览器，先关上下文再关浏览器
  for (const [, rec] of sessions) await rec.session.close().catch(() => {});
  sessions.clear();
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 兜底：进程异常退出时也尽量把 Chromium 收掉，避免下次启动时残留实例拖慢登录
process.on('exit', () => {
  closeBrowser().catch(() => {});
});