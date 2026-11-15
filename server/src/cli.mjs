/**
 * 命令行探针：不经过网页，直接验证登录 / 状态 / 打卡链路
 *
 *   node server/src/cli.mjs state
 *   node server/src/cli.mjs checkin --lng 106.109536 --lat 38.500879 --photo artifacts/test-photo.png
 *
 * 账号密码不再写在源码里：默认读 .env 的 NMU_USER / NMU_PASS，
 * 也可临时用 --user / --pass 覆盖（注意 shell 历史会留下明文）。
 */
import { credentials, numberEnv } from './env.mjs';
import { NmuSession, closeBrowser } from './nmu.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'state';
const get = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

let user;
let pass;
try {
  ({ username: user, password: pass } = credentials({ user: get('user'), pass: get('pass') }));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const s = new NmuSession();
try {
  const state = await s.login(user, pass);
  console.log('== 登录成功 ==');
  console.log(JSON.stringify({ user: state.user, window: state.window, flags: state.flags, today: state.today }, null, 2));
  console.log('签到点：');
  for (const p of state.points) console.log(`  - ${p.name}  ${p.lng},${p.lat}  ±${p.radius}m`);

  if (cmd === 'checkin') {
    const lng = Number(get('lng', String(numberEnv('CHECKIN_LNG', 106.109536))));
    const lat = Number(get('lat', String(numberEnv('CHECKIN_LAT', 38.500879))));
    const photo = get('photo', 'artifacts/test-photo.png');
    const r = await s.checkin({ lng, lat, photoPath: photo });
    console.log('\n== 打卡结果 ==', r.code, r.message);
    for (const st of r.steps || []) console.log(` [${st.ok ? '√' : '×'}] ${st.text}`);
    if (r.raw) console.log('RAW:', JSON.stringify(r.raw));
  }
} catch (e) {
  console.error('ERROR', e.code, e.message);
  process.exitCode = 1;
} finally {
  await s.close().catch(() => {});
  await closeBrowser();
}
process.exit(process.exitCode || 0);