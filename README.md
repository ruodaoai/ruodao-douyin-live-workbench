# 抖音直播互动工作台（douyin-live-workbench）

> 英文文档：[README.en.md](./README.en.md)

面向抖音直播伴侣的 1080×1920 透明竖屏弹幕互动舞台：4 套玩法 + three.js 实时 3D 覆盖层 + 场控台。观众扣数字、送礼物、发表情即可实时改变战场。

## 4 套玩法

- 人类 VS 丧尸：扣数字加入攻防，礼物召唤援军。
- 最美家乡投票：发送「加省份」为本省投票，实时排行。
- 三国壮志：扣1/2/3 投蜀/吴/魏，礼物涨兵、火箭召白虎。
- 奔跑羊：扣1/2 分左右加推力，666 冲刺，冲线结算。

## 3D 舞台

- three.js 0.160（本地 vendor，无外网依赖）实时渲染：三条发光跑道、双基地水晶与光柱、最多 320 个 InstancedMesh 小兵、700 粒子池、gift / levelup / win 特效与电影机位晃动。
- 生图号池生成的 9:16 主视觉作为舞台背景；角色立绘作为主将全息立牌，自动去黑底、提亮并加底座光环。
- meshy.cn 下载的 GLB 可导入为主将：工作台「场控 → 3D 舞台与主将 → 导入 GLB」，指派给人类 / 丧尸主将；模型只保存在本机插件目录。
- WebGL 不可用时自动回退 Canvas2D，不中断直播。

## 场控台

- 立即上屏：字幕推送到覆盖层，默认 6 秒自动隐藏，可勾选语音播报。
- 话术库：点击即上屏，F1–F6 快捷键；「AI 生成 5 条」在未配置模型时使用本地模板。
- 自动应答：评论关键词 → 自动上屏，带人物冷却、敏感词拦截，以及手动上屏后的 3.5 秒优先窗口。
- 场控时间轴：按开播分钟提示开场 / 讲规则 / 冲榜 / 下播，点「执行」立即上屏。
- 背景音乐：搜索酷狗曲库，音量与路由可调。默认「本机播放」——工作台点一次播放后，直播伴侣采集「系统扬声器」，不依赖浏览器自动播放；「覆盖层播放」走 `/api/bgm/stream` 本地代理（支持 Range），直播伴侣采集「网页声音」，但浏览器可能拦截自动播放，需要先点一下覆盖层。两路不要同时开，避免回声。

## 素材生成

`node scripts/generate-live-assets.mjs` 调用本地生图号池（image-pool）生成 11 张舞台素材，并写入 `web/assets/media/manifest.json`。支持 `--only <key>` 与 `--force`。素材已随插件落盘，运行时不依赖号池。

| key | 用途 |
| --- | --- |
| `human-vs-zombie` | 3D 赛博废土主视觉；`humanBoss` / `zombieBoss` 为巨型 Boss 立绘，`human-hero` / `zombie-hero` 为旧版主将 |
| `hometown-vote` | 全息中国地图主视觉；`guardian` 为金色火焰虎守护兽 |
| `three-kingdoms` | 三国古战场主视觉；`three-kingdoms-shu` / `wu` / `wei` 为三阵营主将立绘 |
| `running-sheep` | 赛博竞速主视觉；`sheep` 为白毛羊群立绘，`sheep-blue` / `sheep-pink` 为旧版双羊 |
| `stage-ui` | 半透明 HUD 面板贴图（沿用旧素材） |

主视觉按 1080×1920 竖屏生成，立绘为竖版纯黑底；运行时由 `web/render/stage-kit.mjs` 统一做去背、发光与合成，2D 玩法不再只依赖 CSS 渐变。

## 技术架构

- Node 进程承载权威模拟（20Hz tick，Node 端权威、覆盖层只插值）。
- 覆盖层 three.js WebGL 渲染 + SSE 状态同步；2D 玩法保留 Canvas2D 布局。
- 本地 HTTP 服务，1080×1920 透明竖屏填入直播伴侣浏览器源。

## 互动边界

- 演示源与中继源可用；官方抖音开放平台接入需自行申请。
- 盲盒 / 抽奖 / 降米等仅为演示玩法，不承诺真实兑换。
- 直播数据只写宿主 userData，覆盖层通过 127.0.0.1 提供给直播伴侣。

## 开发与测试

    node bin/live-workbench.mjs serve --port 43119
    $files = Get-ChildItem test\*.test.mjs | ForEach-Object { $_.FullName }; node --test $files