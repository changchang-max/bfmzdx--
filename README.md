# 智能查寝 · 打卡助手

面向手机浏览器的一体化打卡工具：输入学号密码 → 地图上自选虚拟位置 → 上传照片 → 一键完成「智能查寝」归宿打卡。

服务端用 Playwright 真实登录学校统一身份认证（CAS），在官方页面里注入虚拟定位与照片，再调用官方打卡接口，因此打卡记录、坐标、照片与真人手机打卡完全同构。

---

## 1. 快速开始

```powershell
npm install
copy .env.example .env              # 然后编辑 .env 填入自己的学号密码
npx playwright install chromium      # 首次需要，下载约 130MB
npm run env:check                    # 确认凭据已正确读取（输出已脱敏）
npm start                            # 默认 http://127.0.0.1:8787
```

> 源码里不存任何账号密码：`server/src/env.mjs` 会自动读取根目录 `.env`，该文件已被 `.gitignore` 忽略。网页端仍由使用者自己在页面上输入凭据，`NMU_USER / NMU_PASS` 只服务于命令行脚本和调试脚本。

### 手机访问(也可电脑直接访问)
> 手机访问需先防火墙放行电脑的8787端口
1. 手机与电脑连同一个 Wi-Fi；
2. 电脑上执行 `ipconfig`，找到「无线局域网适配器 WLAN → IPv4 地址」，例如 `192.168.1.23`；
3. 手机浏览器打开 `http://192.168.1.23:8787`；
4. 若打不开：Windows 防火墙放行 Node（` netsh advfirewall firewall add rule name="zncq" dir=in action=allow protocol=TCP localport=8787`），或临时关闭防火墙。

> 想换端口：`$env:PORT=9000; npm start`。局域网内其他设备也可访问，会话按浏览器标签各自独立。

---

## 2. 使用流程

| 步骤 | 操作 | 说明 |
|---|---|---|
| 1 | 输入学号 + 智慧校园密码 → 登录 | 后端建立独立浏览器会话，约 5–20 秒；密码不落盘，会话 90 分钟闲置后自动销毁 |
| 2 | 选择位置 | 点地图任意位置、拖动橙色标记，或点顶部签到点胶囊（东1—东4、西1—西2 学生社区、东区博雅楼…） |
| 3 | 看范围提示 | 绿色 = 在签到范围内；橙色 = 不在范围并给出「还差多少米」 |
| 4 | 上传照片 | 「拍照」直接调用后摄，「相册」从相册选图；需本人出镜的宿舍照片 |
| 5 | 点「打卡」 | 定位注入 → 照片上传 → 提交打卡，10–40 秒返回结果与逐步日志 |

只有同时满足 **在打卡时段内 + 在签到范围内 + 有照片 + 今日未打卡** 时按钮才可点，这与学校服务端的校验一致。

- 本账号打卡时段：**22:59 – 23:55**（由 `getKqInfo` 实时读取，不同楼栋可能不同）
- 时段外按钮置灰并提示原因；服务端同样会拒绝（返回 `#E101080000000 当前时间不在考勤时段内`）

---

## 3. 技术实现

```
手机浏览器  ──HTTP──▶  Express (server/src/server.mjs)
                          │  每用户一个 Playwright Chromium Context
                          ▼
                 cas.nmu.edu.cn 统一认证  ──▶  xsfw.nmu.edu.cn 智能查寝
```

关键接口（均已实测）：

| 用途 | 接口 |
|---|---|
| 登录 | `POST https://cas.nmu.edu.cn/cas/login`（RSA 加密密码，由页面 JS 自行完成） |
| 查寝信息 | `POST /xsfw/sys/swmzncqapp/kqController/getKqInfo.do` → 宿舍、时段、`DD_LIST` 签到点、`QD_INFO` 当日状态 |
| 照片上传 | `POST /xsfw/sys/uploadcomponent/upload/uploadFile.do`（走页面自带上传控件，自动换取 `DZ_DKZP` 令牌） |
| 提交打卡 | `POST /xsfw/sys/swmzncqapp/kqController/addKqInfo.do`，`data={"KQWZXX","JDZB","WDZB","DZ_QDDD","DZ_DKZP"}` |

### 虚拟定位是怎么生效的

站点 `maputil.js` 取位置的入口是 `SDK.getCurrentPosition()`，拿到结果后写入全局 `window.curlng / curlat`，再用百度 `getDistance()` 与 `DD_LIST` 比对，最后把 `JDZB/WDZB` 原样提交。

服务端在页面初始化前注入脚本（`server/src/nmu.mjs` 的 `geoSpoofScript`）：

1. 接管 `navigator.geolocation.getCurrentPosition / watchPosition`；
2. 用属性描述符劫持 `window.SDK` 的赋值，把 `SDK.getCurrentPosition` 换成返回自选坐标（`isGaode=false`）；
3. 每次打卡前把选点写入 `window.__VIRTUAL_GEO__` 并调用页面自身的 `getKqInfo()`，让站点自己重新计算「是否在范围内」，全程不改动站点 JS 文件。

坐标系：页面与接口使用**百度 BD09**；前端地图用高德 GCJ-02 瓦片，双向换算函数 `gcj2bd / bd2gcj` 与站点 `maputil.js` 完全一致（见 `server/src/geo.mjs`、`public/app.js`）。

---

## 4. 目录结构

```
智能查寝打卡/
├─ server/src/
│  ├─ server.mjs      Express 服务 + 会话管理 + 上传
│  ├─ nmu.mjs         CAS 登录、虚拟定位注入、照片上传、打卡提交
│  ├─ geo.mjs         BD09/GCJ02 换算、签到点匹配
│  ├─ env.mjs         .env 加载、凭据读取、日志脱敏
│  └─ cli.mjs         命令行探针（不走网页）
├─ public/
│  ├─ index.html      移动端页面
│  ├─ styles.css      设计令牌与组件样式
│  └─ app.js          地图选点、照片、打卡交互
├─ scripts/           开发调试脚本（探针、UI 测试）
└─ artifacts/         调试截图与日志（可删）
```

---

## 5. 命令行用法（排查问题用）

```powershell
# 凭据自动取自 .env（NMU_USER / NMU_PASS），命令里不必再写明文
node server/src/cli.mjs state

# 直接跑一次完整打卡（照片路径可换）
node server/src/cli.mjs checkin --lng 106.109536 --lat 38.500879 --photo artifacts/test-photo.png
```

输出会逐步打印：读取查寝信息 → 命中签到点 → 虚拟定位注入 → 照片上传 → 服务端返回。

> 调试脚本（`scripts/dev/*.mjs`）同样从 `.env` 读取凭据与微应用入口地址 `NMU_APP_URL`；
> 该地址里的 `code` / `ticket` 属于一次性令牌，同样只放在 `.env` 里，不要贴到聊天或提交。

---

## 6. 注意事项

- 服务端**会**校验打卡时段与「今日是否已打卡」，界面上的置灰只是同步了这些规则；时段未到点了也提交不上去。
- 同一网络短时间内反复登录统一认证可能触发图形验证码，此时页面会明确提示「需要人工处理」，先在浏览器手动登录一次即可恢复。
- 会话保存在服务端内存，重启服务需重新登录；`npm start` 关闭后会话即失效。
- 打卡照片与坐标由本人对自己账号操作，请自行确保照片内容真实（系统要求本人出镜的宿舍照片）。

---

## 7. 敏感信息怎么管

| 数据 | 存放位置 | 是否入库 |
|---|---|---|
| 学号 / 密码 | `.env` 的 `NMU_USER` / `NMU_PASS` | 否（`.gitignore` 已忽略 `.env*`，只提交 `.env.example` 模板） |
| 微应用入口 `code` / `ticket` | `.env` 的 `NMU_APP_URL` | 否 |
| 登录态 `storageState`（含 CAS cookie） | `artifacts/state.json`（调试产物） | 否（`artifacts/` 整目录忽略） |
| 打卡照片、上传缓存 | `.uploads/`、`artifacts/` | 否 |
| 控制台日志中的学号 | 运行时脱敏为 `20****22` | — |

要点：

1. **代码里不出现任何真实凭据**，全部经 `server/src/env.mjs` 的 `credentials()` 读取，缺失时直接报错并提示去建 `.env`。
2. 日志统一用 `mask()` 脱敏，避免终端输出、`artifacts/*.log` 泄露完整学号。
3. 如果曾把 `.env`、`artifacts/`、`state.json` 提交过：执行 `git rm --cached .env artifacts -r`，并**立即修改校园网密码**——历史提交里的密码不会因为删除文件而消失。
4. `.env` 只存在本机，换机器或重装系统后需重新创建；不要把 `.env` 内容发到群里或截图。