# koishi-plugin-vsinger-gacha

[![npm](https://img.shields.io/npm/v/koishi-plugin-vsinger-gacha?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-vsinger-gacha)
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

## 安装

插件**自带全部素材**（卡池数据 + 423 张缩略图 + 官方角标），装完即用；图鉴渲染是唯一可选依赖。

### 方式 A：一条命令装（不用 npm 帐号）

```bash
npm i https://github.com/zb23333ww/koishi-plugin-vsinger-gacha/releases/download/v1.0.0/koishi-plugin-vsinger-gacha-1.0.3.tgz
```

`koishi.yml` 加一行后重启：

```yaml
plugins:
  vsinger-gacha: {}
```

### 方式 B：下载 zip 手动放（完全不用网络命令）

下载 [koishi-plugin-vsinger-gacha.zip](https://github.com/zb23333ww/koishi-plugin-vsinger-gacha/releases/download/v1.0.0/koishi-plugin-vsinger-gacha.zip) → 解压 → 整个文件夹放进 Koishi 项目的 `node_modules/` → `koishi.yml` 加 `vsinger-gacha: {}` → 重启。

### 方式 C：npm 正式包（发布后可用）

```bash
npm i koishi-plugin-vsinger-gacha
```

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


## 素材包（可选）

仓库不含 1.37GB 原图与 1.06GB 动态卡，放在 Releases：

| Release 附件 | 大小 | 内容 |
| --- | --- | --- |
| `assets-cards.tar` | 1.6 GB | 423 张 PNG（1242×1863）+ 274 张镭射版 JPG |
| `assets-videos.tar` | 1.1 GB | 145 个动态卡 mp4 |

解压到 `cardsDir` 即可，或用 `npm run fetch-assets` 重新抓取。

## 开发

```bash
npm i
node test/e2e.cjs        # 需要 @koishijs/plugin-mock + @napi-rs/canvas
```

## 免责声明

卡图、卡池信息来自哔哩哔哩「收藏集」公开接口，版权归哔哩哔哩及原作者所有；
本插件仅用于个人学习与同好群内的收藏展示，请勿用于商业用途。
