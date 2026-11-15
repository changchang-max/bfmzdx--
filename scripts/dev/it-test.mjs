// 集成测试：验证虚拟定位注入后，站点自己的距离判定是否会认为「在签到范围内」
// 说明：当前不在打卡时段（22:59-23:55），站点不会触发距离计算，因此测试中临时把
//       vm.configInfo.IN_TIME 置 true 来触发真实的 getDistance() 路径，不改动服务端任何数据。
import { NmuSession, closeBrowser } from '../server/src/nmu.mjs';
import { credentials } from '../server/src/env.mjs';

const { username: USER, password: PASS } = credentials();

const s = new NmuSession();
await s.login(USER, PASS);
console.log('登录成功');

async function probe(lng, lat, label) {
  const r = await s.page.evaluate(
    ({ lng, lat }) => {
      window.__VIRTUAL_GEO__ = { lng, lat };
      window.curlng = lng;
      window.curlat = lat;
      const vm = document.querySelector('#kqqd-smkq').__vue__;
      vm.configInfo.IN_TIME = true; // 仅测试：模拟处于打卡时段
      return new Promise((resolve) => {
        vm.getDistance();
        setTimeout(() => resolve({ inPostion: vm.inPostion, address: vm.address }), 2500);
      });
    },
    { lng, lat },
  );
  console.log(`${label} → inPostion=${r.inPostion} address=${r.address}`);
  return r;
}

// 1) 签到点中心
await probe(106.109536, 38.500879, '东2学生社区中心 (106.109536,38.500879)');
// 2) 签到点中心偏 40 米（应仍在 70 米范围内）
await probe(106.109536 + 0.00045, 38.500879, '偏东约 40 米');
// 3) 远离校园（应判为不在范围）
await probe(106.2300, 38.4800, '远离校园 (106.23,38.48)');

await s.close();
await closeBrowser();
process.exit(0);