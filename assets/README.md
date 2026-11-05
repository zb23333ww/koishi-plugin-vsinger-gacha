# 素材说明

本目录随 npm 包发布的内容：

| 文件 | 说明 |
| --- | --- |
| `catalog.json` | 423 张卡的基础数据（名称、档位、概率、所属奖池、act_id） |
| `pool_rules.json` | 43 个奖池的保底规则（400 抽大隐藏 / 40 抽隐藏） |
| `thumbs/` | 423 张 140×200 缩略图（图鉴直接用，共约 4.7MB） |
| `tags/` | 官方「大隐藏 / 小隐藏」角标 + 社区复刻「镭射款」角标 |

## 原图与动态卡

原图 1366MB（423 张 PNG 1242×1863）和动态卡 1059MB（145 个 mp4）不进 git 仓库，
放在 GitHub Releases 的 `assets-cards.tar` / `assets-videos.tar` 里。

下载后解压到 `cardsDir`（默认 `data/vsinger-gacha/cards`）：

```
cards/
├── 0a1b2c....png      # catalog.json 里 file 字段对应的文件名
├── videos/0a1b2c....mp4
└── holo/0a1b2c....jpg # 可选：镭射版（普卡的 15% 全息版）
```

也可以直接跑 `npm run fetch-assets -- --dir <cardsDir>` 从 B 站接口重新抓取。
