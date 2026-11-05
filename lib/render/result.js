'use strict';
/** 抽卡结果布局：浅色玻璃手账风 */
const path = require('node:path');
const fs = require('node:fs');
const theme = require('./theme');
const kit = require('./kit');

function pickWallpaper(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
    if (!files.length) return null;
    return path.join(dir, files[Math.floor(Math.random() * files.length)]);
  } catch { return null; }
}

async function render(o) {
  const { Canvas, tagsDir, thumbsDir, outDir } = o;
  const results = o.results || [];
  const n = Math.max(1, results.length);
  const perRow = n <= 3 ? n : Math.min(5, n);
  const rows = Math.ceil(n / perRow);
  const cw = n === 1 ? 300 : 170;
  const ch = Math.round(cw * 1.43);
  const label = theme.CARD.label;
  const gap = theme.CARD.gap;
  const pad = theme.SPACE.xl;
  const head = 132;
  const panelPad = 20;

  const W = Math.max(640, pad * 2 + panelPad * 2 + perRow * cw + (perRow - 1) * gap);
  const H = head + rows * (ch + label + gap) + panelPad * 2 + pad;

  const canvas = Canvas.createCanvas(W, H);
  const g = canvas.getContext('2d');

  const wall = o.wallpaperDir ? pickWallpaper(o.wallpaperDir) : null;
  await kit.background(g, Canvas, W, H, wall);

  kit.header(g, {
    x: pad,
    y: 28,
    W: W - pad * 2,
    title: o.title,
    subtitle: `共 ${n} 张 ｜ 抽卡结果`,
    badge: o.badge != null ? o.badge : '',
    badgeSub: o.badgeSub || '',
    progress: o.progress || 0,
  });

  // 白色玻璃大面板
  const px = pad;
  const py = head - 12;
  const pw = W - pad * 2;
  const ph = rows * (ch + label + gap) + panelPad * 2 - gap;
  kit.panel(g, px, py, pw, ph, { radius: theme.RADIUS.xl, fill: 'rgba(255,255,255,0.72)' });

  const rowW = perRow * cw + (perRow - 1) * gap;
  const x0 = px + Math.round((pw - rowW) / 2);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const hash = r.hash || r.h;
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = x0 + col * (cw + gap);
    const y = py + panelPad + row * (ch + label + gap);

    let img = null;
    const f = hash ? path.join(thumbsDir, hash + '.jpg') : '';
    if (f && fs.existsSync(f)) {
      try { img = await Canvas.loadImage(f); } catch { img = null; }
    }

    await kit.card(g, Canvas, {
      img, x, y, w: cw, h: ch,
      name: (r.card && r.card.card_name) || '',
      rate: r.card && r.card.rate_pct,
      tier: theme.tierOf(r.card),
      laser: Boolean(r.laser),
      tagsDir,
      owned: true,
      nameSize: cw >= 260 ? 22 : 17,
      metaSize: cw >= 260 ? 17 : 13,
    });
  }

  kit.footer(g, W, H, 'VSinger 收藏集 · 天依抽卡手账');

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `draw_${Date.now()}.jpg`);
  fs.writeFileSync(out, await canvas.encode('jpeg', 90));
  return out;
}

module.exports = { render };
