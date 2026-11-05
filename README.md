# koishi-plugin-vsinger-gacha

[![npm](https://img.shields.io/npm/v/koishi-plugin-vsinger-gacha?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-vsinger-gacha)
[![license](https://img.shields.io/github/license/USERNAME/koishi-plugin-vsinger-gacha?style=flat-square)](LICENSE)

> 六位 VSinger 角色的 B 站收藏集抽卡插件：423 张官方卡、43 个奖池、真实概率 + 保底、镭射版、签到积分与图鉴长图。

VSinger 收藏集抽卡插件（Koishi 4.x）：六位角色的官方收藏集卡池、签到积分、图鉴长图，一次性安装即可用。

## 功能

- **423 张官方卡 / 43 个奖池**（含已下架奖池），按系列分组
- **官方抽卡机制**：`card_scarcity` 真实概率、**400 抽大隐藏保底 / 40 抽隐藏保底**、同稀有度未拥有优先
- **镭射版**：普卡 15% 概率出全息镭射图，抽到会记入图鉴
- **积分系统内置**（不依赖签到插件）：签到、打工、蹭饭、摸鱼、每日红包
- **图鉴长图**：液态玻璃背景 + 官方「大隐藏/小隐藏」角标 + 镭射标，超大图自动分张防 OOM
- **管理指令**：给卡（管理员可凭空发，普通用户须自己拥有）、设/加积分、查积分

## 安装

```bash
# 方式一：npm（发布后）
npm i koishi-plugin-vsinger-gacha

# 方式二：直接装 GitHub 仓库
npm i USERNAME/koishi-plugin-vsinger-gacha

# 下载卡图（423 张，约 800MB；建议在日本/香港或挂代理的机器上执行）
npx koishi-plugin-vsinger-gacha 2>/dev/null || node node_modules/koishi-plugin-vsinger-gacha/scripts/fetch-assets.mjs --dir data/vsinger-gacha/cards
```

> **不想下卡图也能玩**：抽卡、积分、管理、**图鉴**都正常（包内自带 423 张 140×200 缩略图，4.7MB），
> 只有「抽取时的原图预览」和「/获取卡」需要完整卡图。
> 需要动态卡 mp4 时加 `--videos`（约 1.1GB）。
> 卡图接口偶尔限流（HTTP 412），脚本每张间隔 250ms，失败清单会打印，重跑即可补齐。

然后在 `koishi.yml` 里启用：

```yaml
plugins:
  vsinger-gacha:
    cardsDir: data/vsinger-gacha/cards
    laserChance: 0.15
    adminUsers:
      - '你的用户ID'
```

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
