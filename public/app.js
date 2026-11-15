/* 智能查寝 · 打卡助手 —— 前端逻辑 */
(() => {
  'use strict';

  // ---------------- 坐标系（与站点 maputil.js 一致） ----------------
  const X_PI = (Math.PI * 3000.0) / 180.0;
  const gcj2bd = (lng, lat) => {
    const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
    const t = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
    return { lng: z * Math.cos(t) + 0.0065, lat: z * Math.sin(t) + 0.006 };
  };
  const bd2gcj = (lng, lat) => {
    const x = lng - 0.0065, y = lat - 0.006;
    const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
    const t = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
    return { lng: z * Math.cos(t), lat: z * Math.sin(t) };
  };
  // WGS84 -> GCJ02（手机 GPS 原始坐标）
  const wgs2gcj = (lng, lat) => {
    const a = 6378245.0, ee = 0.00669342162296594323;
    const outOfChina = lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
    if (outOfChina) return { lng, lat };
    const tfLat = (x, y) => {
      let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
      r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
      r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
      r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
      return r;
    };
    const tfLng = (x, y) => {
      let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
      r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
      r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
      r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
      return r;
    };
    let dLat = tfLat(lng - 105, lat - 35), dLng = tfLng(lng - 105, lat - 35);
    const radLat = (lat / 180) * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
    dLng = (dLng * 180) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
    return { lng: lng + dLng, lat: lat + dLat };
  };

  const distM = (aLng, aLat, bLng, bLat) => {
    const rad = Math.PI / 180, R = 6378137;
    const dLat = (bLat - aLat) * rad;
    const dLng = (bLng - aLng) * rad * Math.cos(((aLat + bLat) / 2) * rad);
    return Math.sqrt(dLat * dLat + dLng * dLng) * R;
  };

  const $ = (id) => document.getElementById(id);
  const S = {
    sid: localStorage.getItem('zncq.sid') || '',
    state: null,
    photo: null,
    photoUrl: '',
    sel: null, // {lng,lat} BD09
    map: null,
    marker: null,
    circles: [],
    busy: false,
  };

  // ---------------- 基础 UI ----------------
  const overlay = (show, title, sub) => {
    $('overlay').classList.toggle('hidden', !show);
    if (title) $('overlay-title').textContent = title;
    if (sub) $('overlay-sub').textContent = sub;
  };
  const showError = (msg) => {
    const box = $('login-error');
    box.textContent = msg;
    box.hidden = !msg;
  };
  const setBusy = (btn, on) => {
    btn.classList.toggle('is-loading', on);
    btn.disabled = on || btn.dataset.hardDisabled === '1';
  };
  async function api(path, opts = {}) {
    const r = await fetch(path, opts);
    let data = null;
    try { data = await r.json(); } catch { data = { ok: false, message: '服务返回异常' }; }
    return data;
  }

  // ---------------- 登录 ----------------
  const savedUser = localStorage.getItem('zncq.user');
  if (savedUser) $('username').value = savedUser;

  $('toggle-password').addEventListener('click', () => {
    const el = $('password');
    el.type = el.type === 'password' ? 'text' : 'password';
  });

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const username = $('username').value.trim();
    const password = $('password').value;
    if (!username || !password) return showError('请填写学号和密码');

    const btn = $('login-btn');
    setBusy(btn, true);
    overlay(true, '正在登录…', '统一身份认证 → 进入智能查寝，约 5–20 秒');
    try {
      const data = await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!data.ok) throw new Error(data.message || '登录失败');
      S.sid = data.sid;
      localStorage.setItem('zncq.sid', S.sid);
      if ($('remember').checked) localStorage.setItem('zncq.user', username);
      else localStorage.removeItem('zncq.user');
      $('password').value = '';
      S.state = data.state;
      enterApp();
    } catch (err) {
      showError(err.message);
    } finally {
      overlay(false);
      setBusy(btn, false);
    }
  });

  $('logout-btn').addEventListener('click', async () => {
    const sid = S.sid;
    S.sid = '';
    localStorage.removeItem('zncq.sid');
    $('view-app').classList.add('hidden');
    $('view-login').classList.remove('hidden');
    if (sid) api('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid }) });
  });

  $('refresh-btn').addEventListener('click', () => refreshState());

  // ---------------- 主界面 ----------------
  function enterApp() {
    $('view-login').classList.add('hidden');
    $('view-app').classList.remove('hidden');
    renderProfile();
    renderPointChips();
    ensureMap();
    renderPoints();
    // 默认选中：第一个签到点
    const p = S.state.points[0];
    if (p) selectBd(p.lng, p.lat, { pan: true });
    else $('range-text').textContent = '该账号没有可用签到点';
    updateActionState();
  }

  function renderProfile() {
    const st = S.state;
    const u = st.user || {};
    $('p-name').textContent = u.name || u.xh || '同学';
    $('avatar').textContent = (u.name || '同').slice(0, 1);
    $('p-meta').textContent = [u.dorm && u.dorm + (u.room ? ' ' + u.room : ''), u.college, u.cls].filter(Boolean).join(' · ') || u.xh || '';

    const chips = [];
    chips.push(`<span class="chip chip-static">学号 ${u.xh || '-'}</span>`);
    chips.push(`<span class="chip chip-static ${st.flags.inTime ? 'chip-ok' : 'chip-warn'}">打卡时段 ${st.window.start}–${st.window.end}${st.flags.inTime ? ' · 进行中' : ' · 未开始'}</span>`);
    if (st.today.isZcgs) chips.push(`<span class="chip chip-static chip-ok">今日已正常归宿 ${st.today.gssj || ''}</span>`);
    else if (st.today.isWg) chips.push(`<span class="chip chip-static chip-warn">今日晚归 ${st.today.gssj || ''}</span>`);
    else if (st.today.hasQd) chips.push(`<span class="chip chip-static chip-ok">今日已签到 ${st.today.gssj || ''}</span>`);
    else chips.push('<span class="chip chip-static chip-warn">今日未打卡</span>');
    if (st.flags.isQj) chips.push('<span class="chip chip-static chip-warn">离校请假</span>');
    $('status-chips').innerHTML = chips.join('');
  }

  function renderPointChips() {
    const names = [];
    for (const p of S.state.points) if (!names.includes(p.name)) names.push(p.name);
    $('point-chips').innerHTML = names
      .map((n) => `<button class="chip" type="button" data-name="${n}" aria-pressed="false">${n}</button>`)
      .join('');
    $('point-chips').querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        // 选该名称下离当前选点最近的签到点
        const cur = S.sel || S.state.points[0];
        let best = null;
        for (const p of S.state.points.filter((x) => x.name === name)) {
          const d = distM(cur.lng, cur.lat, p.lng, p.lat);
          if (!best || d < best.d) best = { p, d };
        }
        if (best) selectBd(best.p.lng, best.p.lat, { pan: true });
      });
    });
  }

  // ---------------- 地图 ----------------
  function ensureMap() {
    if (S.map) return;
    const first = S.state.points[0];
    const center = first ? bd2gcj(first.lng, first.lat) : { lng: 106.11, lat: 38.5 };
    S.map = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true })
      .setView([center.lat, center.lng], 16);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: '1234',
      maxZoom: 19,
      attribution: '© 高德地图',
    }).addTo(S.map);
    S.map.on('click', (e) => {
      const bd = gcj2bd(e.latlng.lng, e.latlng.lat);
      selectBd(bd.lng, bd.lat);
    });
    setTimeout(() => S.map.invalidateSize(), 200);
  }

  function renderPoints() {
    for (const c of S.circles) c.remove();
    S.circles = [];
    for (const p of S.state.points) {
      const g = bd2gcj(p.lng, p.lat);
      const circle = L.circle([g.lat, g.lng], {
        radius: p.radius,
        color: '#0891B2',
        weight: 1.2,
        opacity: 0.55,
        fillColor: '#22D3EE',
        fillOpacity: 0.14,
      }).addTo(S.map);
      circle.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectBd(p.lng, p.lat);
      });
      S.circles.push(circle);
    }
  }

  function selectBd(lng, lat, { pan = false } = {}) {
    S.sel = { lng, lat };
    const g = bd2gcj(lng, lat);
    if (!S.marker) {
      const icon = L.divIcon({ className: '', html: '<div class="pick-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
      S.marker = L.marker([g.lat, g.lng], { icon, draggable: true, autoPan: true }).addTo(S.map);
      S.marker.on('dragend', () => {
        const ll = S.marker.getLatLng();
        const bd = gcj2bd(ll.lng, ll.lat);
        S.sel = { lng: bd.lng, lat: bd.lat };
        refreshRange();
      });
    } else {
      S.marker.setLatLng([g.lat, g.lng]);
    }
    if (pan) S.map.panTo([g.lat, g.lng], { animate: true });
    refreshRange();
  }

  function refreshRange() {
    const { lng, lat } = S.sel;
    $('coord-text').textContent = `选点（百度 BD09）：${lng.toFixed(6)}, ${lat.toFixed(6)}`;

    let hit = null, near = null;
    for (const p of S.state.points) {
      const d = distM(lng, lat, p.lng, p.lat);
      if (!near || d < near.d) near = { p, d };
      if (d <= p.radius && (!hit || d < hit.d)) hit = { p, d };
    }
    const bar = $('range-bar');
    bar.classList.remove('is-ok', 'is-bad');
    if (hit) {
      bar.classList.add('is-ok');
      $('range-text').textContent = `在「${hit.p.name}」范围内 · 距中心 ${Math.round(hit.d)} 米（允许 ${hit.p.radius} 米）`;
    } else if (near) {
      bar.classList.add('is-bad');
      $('range-text').textContent = `不在任何签到范围内 · 最近「${near.p.name}」还差 ${Math.round(near.d)} 米（允许 ${near.p.radius} 米）`;
    }
    // 高亮当前所在范围的签到点 chip
    const activeName = hit ? hit.p.name : near ? near.p.name : '';
    $('point-chips').querySelectorAll('.chip').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.name === activeName ? 'true' : 'false');
    });
    S.inRange = !!hit;
    updateActionState();
  }

  // ---------------- 手机定位 ----------------
  $('gps-btn').addEventListener('click', () => {
    if (!navigator.geolocation) return alert('当前浏览器不支持定位');
    overlay(true, '正在获取手机定位…', '用于把选点吸附到最近的签到点');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = wgs2gcj(pos.coords.longitude, pos.coords.latitude);
        const bd = gcj2bd(g.lng, g.lat);
        let best = null;
        for (const p of S.state.points) {
          const d = distM(bd.lng, bd.lat, p.lng, p.lat);
          if (!best || d < best.d) best = { p, d };
        }
        overlay(false);
        if (best) {
          const target = best.d <= best.p.radius ? best.p : best.p;
          selectBd(target.lng, target.lat, { pan: true });
          if (best.d > best.p.radius) {
            const bar = $('range-bar');
            bar.classList.remove('is-ok');
            bar.classList.add('is-bad');
            $('range-text').textContent = `你当前离最近签到点「${best.p.name}」还有 ${Math.round(best.d)} 米，已把选点吸附到该点`;
          }
        }
      },
      (err) => {
        overlay(false);
        alert('定位失败：' + (err.message || '请检查定位权限'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });

  // ---------------- 照片 ----------------
  function setPhoto(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) return alert('请选择图片文件');
    S.photo = file;
    if (S.photoUrl) URL.revokeObjectURL(S.photoUrl);
    S.photoUrl = URL.createObjectURL(file);
    $('photo-img').src = S.photoUrl;
    $('photo-preview').classList.remove('hidden');
    $('photo-pill').textContent = `${(file.size / 1024).toFixed(0)} KB`;
    $('photo-pill').classList.add('is-ok');
    updateActionState();
  }
  $('file-camera').addEventListener('change', (e) => setPhoto(e.target.files[0]));
  $('file-album').addEventListener('change', (e) => setPhoto(e.target.files[0]));
  $('photo-remove').addEventListener('click', () => clearPhoto());

  function clearPhoto() {
    S.photo = null;
    if (S.photoUrl) URL.revokeObjectURL(S.photoUrl);
    S.photoUrl = '';
    $('photo-preview').classList.add('hidden');
    $('photo-pill').textContent = '未选择';
    $('photo-pill').classList.remove('is-ok');
    $('file-camera').value = '';
    $('file-album').value = '';
    updateActionState();
  }

  // ---------------- 打卡 ----------------
  function updateActionState() {
    const btn = $('checkin-btn');
    const st = S.state;
    if (!st) return;
    const problems = [];
    if (!S.photo) problems.push('请上传照片');
    if (!S.inRange) problems.push('请选择签到范围内位置');
    if (!st.flags.inTime) problems.push(`当前不在打卡时段（${st.window.start}–${st.window.end}）`);
    const done = st.today.isZcgs || (st.today.hasQd && !st.today.hasQdhcq);
    if (done) problems.push('今日已完成打卡');

    const disabled = problems.length > 0 || S.busy;
    btn.disabled = disabled;
    btn.dataset.hardDisabled = disabled ? '1' : '0';
    $('action-hint').textContent = problems.length ? problems.join(' · ') : '准备就绪，点击即可完成打卡';
  }

  $('checkin-btn').addEventListener('click', async () => {
    if (S.busy || !S.sel || !S.photo) return;
    S.busy = true;
    updateActionState();
    overlay(true, '正在打卡…', '定位注入 → 上传照片 → 提交，约 10–40 秒');
    const fd = new FormData();
    fd.append('sid', S.sid);
    fd.append('lng', String(S.sel.lng));
    fd.append('lat', String(S.sel.lat));
    fd.append('photo', S.photo, S.photo.name || 'photo.jpg');

    try {
      const data = await api('/api/checkin', { method: 'POST', body: fd });
      renderResult(data);
      if (data.state) {
        S.state = data.state;
        renderProfile();
        updateActionState();
      } else if (data.ok) {
        await refreshState();
      }
      if (data.ok) clearPhoto();
    } catch (e) {
      renderResult({ ok: false, message: e.message || '网络异常' });
    } finally {
      S.busy = false;
      overlay(false);
      updateActionState();
    }
  });

  function renderResult(data) {
    const card = $('result-card');
    card.classList.remove('hidden');
    const title = $('result-title');
    const msg = $('result-msg');
    title.textContent = data.ok ? '打卡成功' : '打卡未完成';
    msg.className = 'result-msg ' + (data.ok ? 'is-ok' : 'is-bad');
    msg.textContent = data.message || (data.ok ? '已完成' : '未知原因');
    const steps = (data.steps || [])
      .map((s) => `<li class="${s.ok ? 'ok' : 'bad'}">${escapeHtml(s.text)}</li>`)
      .join('');
    $('result-steps').innerHTML = steps || '<li>无过程记录</li>';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  $('result-close').addEventListener('click', () => $('result-card').classList.add('hidden'));

  async function refreshState() {
    try {
      const data = await api('/api/state?sid=' + encodeURIComponent(S.sid));
      if (data.ok) {
        S.state = data.state;
        renderProfile();
        renderPoints();
        if (S.sel) refreshRange();
        else selectBd(S.state.points[0].lng, S.state.points[0].lat, { pan: true });
        updateActionState();
      } else if (data.code === 'NO_SESSION') {
        localStorage.removeItem('zncq.sid');
        S.sid = '';
        $('view-app').classList.add('hidden');
        $('view-login').classList.remove('hidden');
        showError('会话已过期，请重新登录');
      }
    } catch { /* 忽略网络抖动 */ }
  }

  // 每 90 秒静默刷新一次状态：保持服务端会话、及时把「未开始」切成「进行中」
  setInterval(() => {
    if (!S.sid || S.busy || document.hidden) return;
    if ($('view-app').classList.contains('hidden')) return;
    refreshState();
  }, 90 * 1000);

  // ---------------- 启动：恢复会话 ----------------
  (async function boot() {
    if (!S.sid) return;
    overlay(true, '正在恢复会话…', '重新读取查寝信息');
    try {
      const data = await api('/api/state?sid=' + encodeURIComponent(S.sid));
      if (data.ok) {
        S.state = data.state;
        enterApp();
      } else {
        localStorage.removeItem('zncq.sid');
        S.sid = '';
      }
    } catch {
      /* 忽略，退回登录页 */
    } finally {
      overlay(false);
    }
  })();
})();