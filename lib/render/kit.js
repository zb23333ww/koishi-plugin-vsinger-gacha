'use strict';
/** 渲染基础组件：浅色玻璃拟态 */
const path = require('node:path');
const fs = require('node:fs');
const { FONT, COLOR, TIER, RADIUS, SPACE, FONT_SIZE, tierOf } = require('./theme');

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else {
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  return g;
}

/** 背景：插画铺满 + 模糊 + 白色蒙层 */
async function background(g, Canvas, W, H, wallpaper) {
  g.fillStyle = '#eef3fa';
  g.fillRect(0, 0, W, H);

  if (wallpaper && fs.existsSync(wallpaper)) {
    try {
      const img = await Canvas.loadImage(wallpaper);
      // 先用小尺寸绘制再放大 → 廉价模糊
      const SW = Math.max(24, Math.round(W / 18));
      const SH = Math.round(SW * (H / W));
      const small = Canvas.createCanvas(SW, SH);
      const sg = small.getContext('2d');
      sg.drawImage(img, 0, 0, SW, SH);
      g.save();
      g.globalAlpha = 0.72;
      g.drawImage(small, 0, 0, W, H);
      g.restore();
    } catch { /* 忽略 */ }
  }

  // 白色蒙层（左上更亮，保证文字清晰）
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.82)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.68)');
  grad.addColorStop(1, 'rgba(235,244,255,0.78)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

/** 白玻璃面板 */
function panel(g, x, y, w, h, opts = {}) {
  const r = opts.radius == null ? RADIUS.lg : opts.radius;
  g.save();
  g.shadowColor = COLOR.shadow;
  g.shadowBlur = 18;
  g.shadowOffsetY = 4;
  roundRect(g, x, y, w, h, r);
  g.fillStyle = opts.fill || COLOR.panel;
  g.fill();
  g.restore();
  g.save();
  roundRect(g, x, y, w, h, r);
  g.strokeStyle = opts.stroke || COLOR.panelBorder;
  g.lineWidth = 1.5;
  g.stroke();
  g.restore();
}

/**
 * 头部（仿手账卡）：图标 + 标题 + 副标题 + 右侧数字徽章 + 进度条
 */
function header(g, o) {
  const x = o.x;
  const y = o.y;
  const W = o.W;

  // 圆形图标
  const R = 24;
  const cx = x + R;
  const cy = y + R;
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fillStyle = COLOR.accent;
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold 26px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('♪', cx, cy + 1);
  g.textAlign = 'left';
  g.restore();

  g.textBaseline = 'top';
  g.fillStyle = COLOR.text;
  g.font = `bold ${FONT_SIZE.h1}px ${FONT}`;
  g.fillText(fit(g, o.title, `bold ${FONT_SIZE.h1}px ${FONT}`, W - 260), x + R * 2 + 14, y);

  if (o.subtitle) {
    g.fillStyle = COLOR.textSub;
    g.font = `${FONT_SIZE.body}px ${FONT}`;
    g.fillText(o.subtitle, x + R * 2 + 14, y + 40);
  }

  // 右侧徽章
  if (o.badge != null) {
    const bw = 118;
    const bh = 58;
    const bx = x + W - bw;
    panel(g, bx, y - 4, bw, bh, { radius: RADIUS.md, fill: 'rgba(255,255,255,0.95)' });
    g.fillStyle = COLOR.accent;
    g.font = `bold 26px ${FONT}`;
    g.fillText(String(o.badge), bx + 14, y + 6);
    g.fillStyle = COLOR.textSub;
    g.font = `12px ${FONT}`;
    g.fillText(String(o.badgeSub || ''), bx + 14, y + 36);
    // 进度条
    const pct = Math.max(0, Math.min(1, Number(o.progress || 0)));
    g.fillStyle = 'rgba(74,144,217,0.15)';
    roundRect(g, bx + 10, y + bh - 6, bw - 20, 5, 3);
    g.fill();
    if (pct > 0) {
      g.fillStyle = COLOR.accent;
      roundRect(g, bx + 10, y + bh - 6, Math.max(4, (bw - 20) * pct), 5, 3);
      g.fill();
    }
  }
}

/** 文本截断 */
function fit(g, text, font, maxW) {
  const s = String(text == null ? '' : text);
  g.font = font;
  if (g.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/** 卡牌组件 */
async function card(g, Canvas, o) {
  const w = o.w || 170;
  const h = o.h || Math.round(w * 1.43);
  const r = RADIUS.md;
  const tier = o.tier == null ? tierOf({ card_scarcity: o.scarcity }) : o.tier;
  const tc = (TIER[tier] || TIER[10]).color;

  g.save();
  roundRect(g, o.x, o.y, w, h, r);
  g.clip();
  g.fillStyle = COLOR.cardBg;
  g.fillRect(o.x, o.y, w, h);
  if (o.img) {
    try { g.drawImage(o.img, o.x, o.y, w, h); } catch { /* 忽略 */ }
  }
  if (o.owned === false) {
    g.fillStyle = 'rgba(255,255,255,0.38)';
    g.fillRect(o.x, o.y, w, h);
  }
  g.restore();

  g.save();
  roundRect(g, o.x + 1, o.y + 1, w - 2, h - 2, r - 1);
  g.strokeStyle = o.owned === false ? 'rgba(150,165,185,0.45)' : tc;
  g.lineWidth = o.owned === false ? 1.5 : 2.5;
  g.stroke();
  g.restore();

  const tagFile = o.tagsDir ? path.join(o.tagsDir, (TIER[tier] || {}).tag || '') : '';
  if ((TIER[tier] || {}).tag && o.tagsDir && fs.existsSync(tagFile)) {
    try {
      const ti = await Canvas.loadImage(tagFile);
      const tw = w * 0.52;
      // ★ 贴边：裁进卡片圆角内，不留内边距
      g.save();
      roundRect(g, o.x, o.y, w, h, r);
      g.clip();
      g.drawImage(ti, o.x, o.y, tw, (ti.height / ti.width) * tw);
      g.restore();
    } catch { /* 忽略 */ }
  }
  if (o.laser && o.tagsDir) {
    const holo = path.join(o.tagsDir, 'tag_holo.png');
    if (fs.existsSync(holo)) {
      try {
        const hi = await Canvas.loadImage(holo);
        const hw = w * 0.36;
        const hh = (hi.height / hi.width) * hw;
        g.drawImage(hi, o.x + (w - hw) / 2, o.y + h - hh - 6, hw, hh);
      } catch { /* 忽略 */ }
    }
  }
  if (o.count > 1) {
    g.fillStyle = 'rgba(31,42,58,0.82)';
    roundRect(g, o.x + w - 46, o.y + 6, 40, 22, 8);
    g.fill();
    g.fillStyle = '#8cffaa';
    g.font = `bold 14px ${FONT}`;
    g.fillText(`×${o.count}`, o.x + w - 40, o.y + 9);
  }

  g.fillStyle = o.owned === false ? COLOR.textDim : COLOR.text;
  g.font = `bold ${o.nameSize || FONT_SIZE.h3}px ${FONT}`;
  g.fillText(fit(g, o.name, `bold ${o.nameSize || FONT_SIZE.h3}px ${FONT}`, w), o.x, o.y + h + 6);
  if (o.rate != null || o.tierName) {
    g.fillStyle = tc;
    g.font = `${o.metaSize || FONT_SIZE.meta}px ${FONT}`;
    const meta = `${o.tierName || (TIER[tier] || TIER[10]).name}${o.rate != null ? ' ' + o.rate + '%' : ''}`;
    g.fillText(fit(g, meta, `${o.metaSize || FONT_SIZE.meta}px ${FONT}`, w), o.x, o.y + h + 30);
  }
}

/** 页脚 */
function footer(g, W, H, text) {
  g.fillStyle = COLOR.textDim;
  g.font = `${FONT_SIZE.tiny}px ${FONT}`;
  g.fillText(String(text), SPACE.lg, H - 22);
}

module.exports = { roundRect, background, panel, header, card, footer, fit };
