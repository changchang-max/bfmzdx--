/**
 * 统一的环境变量入口
 *
 * 作用：
 *  1. 自动加载项目根目录的 .env（该文件已被 .gitignore 忽略，绝不要提交）
 *  2. 提供 credentials() / appUrl() 读取敏感配置，缺失时给出可操作的报错
 *  3. 提供 mask() 用于日志脱敏，避免把学号、令牌写进控制台和日志文件
 *
 * 直接运行可自检：node server/src/env.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 项目根目录（server/src/../..） */
export const ROOT = path.resolve(HERE, '../..');
/** .env 绝对路径，与运行时的 cwd 无关 */
export const ENV_FILE = path.join(ROOT, '.env');

/** 极简 .env 解析（Node 20.12+ 用内置 loadEnvFile，老版本走这里） */
function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let val = line.slice(eq + 1).trim();
    const quoted = /^(['"`])([\s\S]*)\1$/.exec(val);
    if (quoted) val = quoted[2];
    else val = val.replace(/\s+#.*$/, ''); // 行尾注释
    if (!(key in process.env)) process.env[key] = val;
  }
  return out;
}

if (fs.existsSync(ENV_FILE)) {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV_FILE);
  else parseEnvFile(fs.readFileSync(ENV_FILE, 'utf8'));
}

export const env = process.env;

/**
 * 日志脱敏：20230001 -> 20**01，长令牌只留头尾
 */
export function mask(value) {
  const s = String(value ?? '');
  if (!s) return '';
  if (s.length <= 4) return '*'.repeat(s.length);
  if (s.length <= 8) return s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2);
  return s.slice(0, 4) + '*'.repeat(Math.max(4, s.length - 8)) + s.slice(-4);
}

const NO_CREDS = `缺少学号或密码。请在 ${ENV_FILE} 中设置 NMU_USER 与 NMU_PASS（可复制 .env.example 为 .env），或用 --user / --pass 传入。`;

/**
 * 读取账号密码：源码里不再出现任何真实值
 * @param {{ user?: string, pass?: string, fallbackEnv?: boolean }} opts
 * @returns {{ username: string, password: string }}
 */
export function credentials({ user, pass } = {}) {
  const username = String(user ?? env.NMU_USER ?? '').trim();
  const password = String(pass ?? env.NMU_PASS ?? '');
  if (!username || !password) {
    const err = new Error(NO_CREDS);
    err.code = 'NO_CREDS';
    throw err;
  }
  return { username, password };
}

/**
 * 调试脚本用的微应用入口地址（含 CAS 一次性 ticket，属于敏感信息，只放 .env）
 */
export function appUrl() {
  const url = String(env.NMU_APP_URL ?? '').trim();
  if (!url) {
    const err = new Error(`缺少 NMU_APP_URL。请在 ${ENV_FILE} 中填写智能查寝微应用入口地址（含 code / ticket 参数）。`);
    err.code = 'NO_APP_URL';
    throw err;
  }
  return url;
}

/** 可选数值配置：坐标、端口 */
export function numberEnv(name, fallback) {
  const n = Number(env[name]);
  return Number.isFinite(n) && n !== 0 ? n : fallback;
}

// 自检：node server/src/env.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const state = (k) => (env[k] ? '✔ 已设置' : '✘ 未设置');
  const redact = (k) => (env[k] ? `（${String(env[k]).length} 位，内容不显示）` : '');
  const hostOf = (u) => {
    try { return new URL(u).host; } catch { return '（格式异常）'; }
  };
  console.log(`.env 文件   : ${fs.existsSync(ENV_FILE) ? '✔ ' + ENV_FILE : '✘ 不存在（先复制 .env.example）'}`);
  console.log(`NMU_USER    : ${state('NMU_USER')}  ${env.NMU_USER ? mask(env.NMU_USER) : ''}`);
  console.log(`NMU_PASS    : ${state('NMU_PASS')}  ${redact('NMU_PASS')}`);
  console.log(`NMU_APP_URL : ${state('NMU_APP_URL')} ${env.NMU_APP_URL ? hostOf(env.NMU_APP_URL) + '（含 ticket，参数不显示）' : ''}`);
  console.log(`PORT        : ${env.PORT || '(默认 8787)'}`);
  console.log(`CHECKIN     : ${env.CHECKIN_LNG || '-'}, ${env.CHECKIN_LAT || '-'}`);
}