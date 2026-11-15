/**
 * 坐标系工具
 * - BD09：百度坐标，学校签到点（DD_LIST）与提交给后端 addKqInfo 的 JDZB/WDZB 都是 BD09
 * - GCJ02：高德/腾讯瓦片坐标，前端地图展示用
 * 公式与站点自带 maputil.js 中的 gaode2baiduLocation / baidu2gaodeLocation 完全一致
 */
const X_PI = (Math.PI * 3000.0) / 180.0;

export function gcj02ToBd09(lng, lat) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  return { lng: z * Math.cos(theta) + 0.0065, lat: z * Math.sin(theta) + 0.006 };
}

export function bd09ToGcj02(lng, lat) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return { lng: z * Math.cos(theta), lat: z * Math.sin(theta) };
}

/** 米制距离（等距圆柱近似，室内量级足够准） */
export function distanceMeters(aLng, aLat, bLng, bLat) {
  const R = 6378137;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad * Math.cos(((aLat + bLat) / 2) * rad);
  return Math.sqrt(dLat * dLat + dLng * dLng) * R;
}

/** 在签到点列表中找出覆盖当前坐标的点（BD09），返回最近的命中点 */
export function matchCheckinPoint(points, lng, lat) {
  let best = null;
  for (const p of points || []) {
    const d = distanceMeters(lng, lat, Number(p.lng), Number(p.lat));
    if (d <= Number(p.radius || 0) && (!best || d < best.distance)) {
      best = { point: p, distance: d };
    }
  }
  return best;
}

/** 距离最近签到点的距离（不管是否在范围内） */
export function nearestPoint(points, lng, lat) {
  let best = null;
  for (const p of points || []) {
    const d = distanceMeters(lng, lat, Number(p.lng), Number(p.lat));
    if (!best || d < best.distance) best = { point: p, distance: d };
  }
  return best;
}