# koishi-plugin-vsinger-gacha

> AstrBot（Python）移植版：[astrbot_plugin_vsinger_gacha](https://github.com/zb23333ww/astrbot_plugin_vsinger_gacha)
> —— 同样的抽卡/图鉴/镭射规则，积分走 Azure 打卡。

[![npm](https://img.shields.io/npm/v/koishi-plugin-vsinger-gacha?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-vsinger-gacha)
[![CI](https://github.com/zb23333ww/koishi-plugin-vsinger-gacha/actions/workflows/ci.yml/badge.svg)](https://github.com/zb23333ww/koishi-plugin-vsinger-gacha/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/zb23333ww/koishi-plugin-vsinger-gacha?style=flat-square)](LICENSE)

> 六位 VSinger 角色的 B 站收藏集抽卡插件：423 张官方卡、43 个奖池、真实概率 + 保底、镭射版、签到积分与图鉴长图。

VSinger 收藏集抽卡插件（Koishi 4.x）：六位角色的官方收藏集卡池、签到积分、图鉴长图，一次性安装即可用。

## 功能

- **423 张官方卡 / 43 个奖池**（含已下架奖池），按系列分组
- **三级抽取范围**：全部卡池 / 整个系列 / 单个奖池（`/卡池` 合并转发给出编号，`/换池 01` 切换）
- **合并转发**：抽卡结果与图鉴以「群聊的聊天记录」发送（不支持时自动退回普通消息）
- **动态卡**：抽到动态卡额外单独发 mp4
- **官方抽卡机制**：`card_scarcity` 真实概率、**400 抽大隐藏保底 / 40 抽隐藏保底**、同稀有度未拥有优先
- **镭射版**：普卡 15% 概率出全息镭射图，抽到会记入图鉴
- **积分系统内置**（不依赖签到插件）：签到、打工、蹭饭、摸鱼、每日红包
- **图鉴长图**：液态玻璃背景 + 官方「大隐藏/小隐藏」角标 + 镭射标，超大图自动分张防 OOM
- **管理指令**：给卡（管理员可凭空发，普通用户须自己拥有）、设/加积分、查积分

## 安装（选择一种）

### 方式 A：npm 一行装（推荐）

```bash
npm i koishi-plugin-vsinger-gacha
```

`koishi.yml` 加一行后重启：

```yaml
plugins:
  vsinger-gacha: {}
```

### 方式 B：下载 tgz 直装（npm 不可用时）

```bash
npm i https://github.com/zb23333ww/koishi-plugin-vsinger-gacha/releases/latest/download/koishi-plugin-vsinger-gacha.tgz
```

### 方式 C：下载 zip 手动放

[koishi-plugin-vsinger-gacha.zip](https://github.com/zb23333ww/koishi-plugin-vsinger-gacha/releases/latest/download/koishi-plugin-vsinger-gacha.zip) → 解压 → 整个文件夹放进 Koishi 的 `node_modules/` → 配置 → 重启。

### 图鉴（可选）

`/抽卡`、`/签到`、积分、管理指令**零依赖**即可用。
只有 `/图鉴` 需要画布库，用到时再装：

```bash
npm i @napi-rs/canvas
```

没装时 `/图鉴` 会提示这一行，不影响其它功能。

### 卡图

- 抽到/查看的卡图**缺哪张自动下哪张**（约 1MB/张，可在配置里 `autoDownload: false` 关掉）
- 想一次性缓存全部：`npm run fetch-assets -- --dir data/vsinger-gacha/cards`
- 要动态卡 mp4（1.1GB）：下载 Release 的 `assets-videos.tar` 解压到 `cards/`

## 统一渲染系统（浅色玻璃手账风）

图鉴采用**横版多列布局**：奖池块打包成 3 个竖直列并排，保留系列条/池条，
一页约 90 张，宽高比接近 3:2；页眉（图标/标题/进度徽章）按画布等比放大。

所有图片统一走 `lib/render/`：插画背景（`assets/wallpapers/`）+ 白色玻璃面板 + 蓝色强调 + 档位描边卡牌。
把喜欢的插画丢进 `assets/wallpapers/` 即可随机当背景；留空则用纯浅色底。

所有图片（抽卡结果、图鉴、以后新增的图）都走同一套设计令牌与组件：

```
lib/render/
├── theme.js     设计令牌：颜色/字号/间距/圆角/档位配色
├── kit.js       组件：背景、毛玻璃面板、卡牌、角标、标题、页脚、文本截断
├── result.js    抽卡结果布局
└── handbook.js  图鉴布局（复用 kit）
```

新增图片时只写布局，样式自动统一。

## 兼容性

| 项 | 说明 |
| --- | --- |
| **Koishi** | `>=4.17.0 <6`（4.18 与 5.x RC 均验证过） |
| **Node** | `>=18` |
| **适配器** | 任意 Satori 适配器可用；OneBot 额外支持**合并转发**，其它适配器自动退回普通消息 |
| **发图** | 默认 `buffer`（base64，跨容器最稳）；可切 `file`（适配器能读同机文件时更省内存） |
| **数据库** | 不需要，数据存 `data/vsinger-gacha/*.json` |
| **图鉴** | 需要可选依赖 `@napi-rs/canvas`；没装时其它功能不受影响 |
| **字体** | 包内自带中文子集，不依赖系统字体 |
| **合并转发** | 配置 `forwardMode: auto / off` |
| **结果图** | 不支持合并转发的平台（如 QQ 官方群机器人）自动把抽卡结果渲染成**一张图**；`resultImage: auto / always / off` |

## 指令

| 指令 | 说明 |
| --- | --- |
| `签到` | 每日领积分 |
| `抽卡 [张数]` | 抽卡，默认 1 张（每张 10 分，最多 10 张） |
| `卡池` / `换池 <序号或名称>` | 查看/切换奖池（`00` = 全部奖池） |
| `获取卡 <卡名>` | 把已拥有的卡发出来 |
| `图鉴` | 生成收藏集长图（超大时自动分 2~3 张） |
| `打工` / `打工状态` / `蹭饭` / `摸鱼` / `每日红包` | 挂机攒积分 |
| `查积分 [@某人]` | 查积分 |
| `给卡 @某人 <卡名>` | 管理员直接发放；普通用户转为「自己有 → 转赠」 |
| `设积分 @某人 N` / `加积分 @某人 N` | 管理员设置/增减积分 |
| `抽卡帮助` | 指令一览 |

## 配置项

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `cardsDir` | `data/vsinger-gacha/cards` | 卡图目录 |
| `laserChance` | `0.15` | 普卡出镭射的概率 |
| `adminUsers` | `[]` | 管理员 ID（平台主人自动算管理员） |
| `pointsPerDraw` | `10` | 单抽消耗 |
| `maxDrawOnce` | `10` | 单次最多抽几张 |
| `signMin` / `signMax` | `10` / `30` | 签到积分范围 |
| `workCap` / `workHours` | `200` / `12` | 打工上限与所需小时 |
| `eatCdMin` / `moyuCdMin` | `30` / `10` | 蹭饭/摸鱼冷却（分钟） |
| `bonusMin` / `bonusMax` | `5` / `20` | 每日红包范围 |

## 用户 ID 说明（很重要）

- **主键用 QQ 号**：`onebot:123456789`
- **openid 只作为别名反查**：官方机器人（QQ 官机）的 openid **每个机器人都不一样**，
  换一个官机同一个人就是另一个 openid，**绝不能拿来当主键**
- 可选配置 `idMapFile`（QQ ↔ openid 映射表，JSON 形如 `{"users":{"QQ":"openid"}}`），
  老数据是 openid 时会自动反查成 QQ，保证换机器人不丢数据

## 数据与目录

```
<baseDir>/data/vsinger-gacha/
├── gacha.json      # 每个人拥有的卡、保底计数、镭射记录、各会话当前奖池
├── points.json     # 积分/签到/打工/冷却
├── cards/          # 卡图（fetch-assets 下载）
└── out/            # 图鉴输出
```

## 素材来源

卡图与卡池信息来自 B 站「收藏集」公开接口（`asset_bag` / `lottery`），仅供个人收藏展示使用，版权归哔哩哔哩及原作者所有。

## License

MIT


## 素材库（卡图 + 动态卡）

插件包只带**缩略图**（图鉴用）+ 卡池数据，原图和动态卡单独放在 Releases 的「素材库」：

| 附件 | 大小 | 内容 |
| --- | --- | --- |
| [`assets-cards.tar`](https://github.com/zb23333ww/koishi-plugin-vsinger-gacha/releases/download/v1.0.0/assets-cards.tar) | 1.6 GB | 423 张官方原图（1242×1863）+ 274 张镭射版 |
| [`assets-videos.tar`](https://github.com/zb23333ww/koishi-plugin-vsinger-gacha/releases/download/v1.0.0/assets-videos.tar) | 1.1 GB | 145 个动态卡 mp4 |

解压到 `cardsDir`（默认 `data/vsinger-gacha/cards`）：

```bash
tar xf assets-cards.tar  -C data/vsinger-gacha/cards
tar xf assets-videos.tar -C data/vsinger-gacha/cards
```

**不装也能用**：卡图按需单张自动下载（约 1MB/张），图鉴直接用包内缩略图。
