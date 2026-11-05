'use strict';
/**
 * 图鉴渲染（@napi-rs/canvas）
 *   - 分栏布局，按列数自动分张，单张内存可控
 *   - 液态玻璃背景（渐变 + 光晕 + 噪点，不联网）
 *   - 贴官方 大隐藏/小隐藏 角标；已抽到镭射的卡贴「镭射款」
 */
const fs = require('node:fs');
const path = require('node:path');

const FONT_FILE = require('node:path').join(__dirname, '..', 'assets', 'font.ttf');

let Canvas = null;
/** 按需加载画布（没装也不影响抽卡/积分） */
function getCanvas() {
  if (Canvas) return Canvas;
  try {
    Canvas = require('@napi-rs/canvas');
  } catch (e) {
    throw new Error('图鉴需要 @napi-rs/canvas，请先执行： npm i @napi-rs/canvas');
  }
  // ★ 注册包内自带中文字体（服务器没有中文字体时，文字会变方框）
  try {
    if (!getCanvas._fontDone) {
      if (fs.existsSync(FONT_FILE)) {
        Canvas.GlobalFonts.registerFromPath(FONT_FILE, 'VSingerSans');
      }
      getCanvas._fontDone = true;
    }
  } catch { /* 忽略字体问题 */ }
  return Canvas;
}

const TW = 140;
const TH = 200;
const LABEL_H = 62;
const GAP = 12;
const PAD = 24;
const HEAD = 100;
const POOL_TITLE_H = 34;
const SERIES_H = 44;
const COLS_PER_COL = 8;
const COLW = COLS_PER_COL * TW + (COLS_PER_COL - 1) * GAP;
const ROWH = TH + LABEL_H;

const SERIES_NAMES = {
  171: '天依游学记系列',
  282: 'VSinger 纪念系列',
  102550: '洛天依收藏集',
  106977: '乐正绫单人集',
  108477: '洛天依珍藏集',
  112860: '生日纪念系列',
  113552: 'Vsinger 新像集',
  113562: '回声系列',
};

const SERIES_COLOR = {
  天依游学记系列: '#428cdc',
  洛天依收藏集: '#5678dc',
  乐正绫单人集: '#dc5a6e',
  言和珍藏集: '#5abea0',
  vsinger: '#9678dc',
  Vsinger集: '#9682e6',
};

const TIER_COLOR = { 40: '#ff6078', 30: '#ffb050', 20: '#96beff', 10: '#bec4d2' };
const TIER_NAME = { 40: '大隐藏', 30: '小隐藏', 20: '稀有', 10: '普通' };

function tierOf(v) {
  const sc = Number((v && v.card_scarcity) || 10);
  if (sc === 40) return 40;
  if (sc === 30) return 30;
  if (sc === 20) return 20;
  return 10;
}

function fitText(ctx2d, text, maxW) {
  let t = String(text == null ? '' : text);
  if (ctx2d.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx2d.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/** 预生成小缩略图：423 张原图逐张解码，避免同时驻留内存 */
async function ensureThumbs(game) {
  const Canvas = getCanvas();
  const dir = path.join(game.cardsDir, 'thumbs140');
  fs.mkdirSync(dir, { recursive: true });
  let made = 0;
  for (const c of game.cards) {
    const out = path.join(dir, c.h + '.jpg');
    if (fs.existsSync(out)) continue;
    const src = game.cardFile(c);
    if (!fs.existsSync(src)) continue;
    try {
      const img = await Canvas.loadImage(src);
      const cv = Canvas.createCanvas(TW * 2, TH * 2);
      const c2 = cv.getContext('2d');
      c2.drawImage(img, 0, 0, TW * 2, TH * 2);
      fs.writeFileSync(out, await cv.encode('jpeg', 80));
      made += 1;
    } catch { /* 跳过坏图 */ }
  }
  if (made) console.log('[vsinger-gacha] 生成缩略图 %d 张', made);
  return dir;
}

async function render({ game, store, uid, displayName, outDir, tagsDir, thumbsDir }) {
  const Canvas = getCanvas();

  // ★ 优先用包内自带缩略图（assets/thumbs，423 张约 4.7MB），缺失才现场生成
  let thumbs = thumbsDir && fs.existsSync(thumbsDir) ? thumbsDir : null;
  if (!thumbs) thumbs = await ensureThumbs(game);

  const u = store.user(uid);
  const owned = u.owned || {};
  const laser = u.laser || {};

  // 按系列/奖池分组
  const seriesMap = new Map();
  for (const c of game.cards) {
    const actId = String(c.v.act_id || '');
    const act = SERIES_NAMES[actId] || (c.v.act_name || `系列 ${actId || '未知'}`);
    const pool = String((Array.isArray(c.v.pool_list) && c.v.pool_list[0]) || '默认');
    if (!seriesMap.has(act)) seriesMap.set(act, new Map());
    const pm = seriesMap.get(act);
    if (!pm.has(pool)) pm.set(pool, []);
    pm.get(pool).push(c);
  }

  // 每池一块（顺序填充）
  const blocks = [];
  for (const [act, pm] of seriesMap) {
    for (const [pool, arr] of pm) {
      arr.sort((a, b) => Number(b.v.rate_pct || 0) - Number(a.v.rate_pct || 0));
      const rows = Math.max(1, Math.ceil(arr.length / COLS_PER_COL));
      const got = arr.filter((c) => (owned[c.h] || 0) > 0).length;
      blocks.push({ act, pool, arr, got, h: POOL_TITLE_H + rows * ROWH + 12 });
    }
  }
  const totalH = blocks.reduce((a, b) => a + b.h, 0);

  const chunk = (cols, n) => {
    const per = Math.ceil(cols.length / n);
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = cols.slice(i * per, (i + 1) * per);
      if (c.length) out.push(c);
    }
    return out;
  };

  const pack = (ncol) => {
    const target = Math.max(1200, (totalH / ncol) * 1.05);
    const cols = [];
    let cur = [];
    let curh = 0;
    for (const b of blocks) {
      if (cur.length && curh + b.h > target) {
        cols.push(cur);
        cur = [];
        curh = 0;
      }
      cur.push(b);
      curh += b.h;
    }
    if (cur.length) cols.push(cur);
    return cols;
  };

  let cols = pack(8);
  const colW = COLW + PAD * 2;
  const maxH = HEAD + Math.max(...cols.map((c) => c.reduce((a, b) => a + b.h, 0))) + 30;
  const px = colW * cols.length * maxH;
  let nParts = 1;
  const MAX_PX = 12e6;                     // ★ 单张画布硬上限，防 OOM
  while (nParts < 4 && px / nParts > MAX_PX) nParts += 1;
  const parts = nParts === 1 ? [cols] : chunk(cols, nParts);

  const tagBig = path.join(tagsDir, 'tag_40.webp');
  const tagSmall = path.join(tagsDir, 'tag_30.webp');
  const tagHolo = path.join(tagsDir, 'tag_holo.png');
  const imgCache = new Map();
  // ★ @napi-rs/canvas 的 loadImage 是异步的
  const load = async (file) => {
    if (!imgCache.has(file)) {
      imgCache.set(file, Promise.resolve(Canvas.loadImage(file)).catch(() => null));
    }
    return imgCache.get(file);
  };

  fs.mkdirSync(outDir, { recursive: true });
  const files = [];

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const W = PAD * 2 + part.length * COLW + (part.length - 1) * GAP * 2;
    const H = HEAD + Math.max(...part.map((c) => c.reduce((a, b) => a + b.h, 0))) + 30;
    const canvas = Canvas.createCanvas(W, H);
    const g = canvas.getContext('2d');

    // 背景：液态玻璃（渐变 + 光晕 + 噪点）
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#101a2e');
    bg.addColorStop(0.45, '#16304f');
    bg.addColorStop(1, '#0e1626');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.2, H * 0.1, 10, W * 0.2, H * 0.1, Math.max(W, H) * 0.8);
    glow.addColorStop(0, 'rgba(120,180,255,0.35)');
    glow.addColorStop(1, 'rgba(120,180,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    // 标题
    g.fillStyle = '#ffffff';
    g.font = 'bold 44px VSingerSans, sans-serif';
    g.fillText('VSinger 收藏集 · 我的图鉴', PAD, 56);
    const gotN = Object.keys(owned).length;
    const dupN = Object.values(owned).reduce((a, b) => a + Math.max(0, b - 1), 0);
    g.font = '22px VSingerSans, sans-serif';
    g.fillStyle = 'rgba(235,240,250,0.85)';
    g.fillText(`${displayName}　已收集 ${gotN}/${game.cards.length}　重复 ${dupN} 张`, PAD, 88);

    for (let ci = 0; ci < part.length; ci++) {
      const grp = part[ci];
      const x0 = PAD + ci * (COLW + GAP * 2);
      let y = HEAD;
      let prevAct = null;
      for (const blk of grp) {
        if (blk.act !== prevAct) {
          g.fillStyle = SERIES_COLOR[blk.act] || '#3c5a96';
          g.fillRect(x0, y, COLW, SERIES_H - 8);
          g.fillStyle = '#fff';
          g.font = 'bold 22px VSingerSans, sans-serif';
          g.fillText(blk.act, x0 + 12, y + 32);
          y += SERIES_H;
          prevAct = blk.act;
        }
        // 池标题（玻璃条）
        g.fillStyle = 'rgba(8,14,30,0.85)';
        g.fillRect(x0, y, COLW, POOL_TITLE_H - 10);
        g.fillStyle = '#ffd682';
        g.font = 'bold 22px VSingerSans, sans-serif';
        g.fillText(`${blk.pool}   ${blk.got}/${blk.arr.length}`, x0 + 8, y + 24);

        for (let i = 0; i < blk.arr.length; i++) {
          const c = blk.arr[i];
          const cx = x0 + (i % COLS_PER_COL) * (TW + GAP);
          const cy = y + POOL_TITLE_H + Math.floor(i / COLS_PER_COL) * ROWH;
          const n = owned[c.h] || 0;
          const tier = tierOf(c.v);
          const tcol = TIER_COLOR[tier];

          // 辉光（拥有）
          if (n) {
            g.save();
            g.shadowColor = tcol;
            g.shadowBlur = 22;
            g.fillStyle = 'rgba(0,0,0,0.6)';
            g.fillRect(cx, cy, TW, TH);
            g.restore();
          }
          const img = await load(path.join(thumbs, c.h + '.jpg'));
          if (img) {
            g.save();
            if (!n) g.globalAlpha = 0.62;
            g.drawImage(img, cx, cy, TW, TH);
            g.restore();
          } else {
            g.fillStyle = '#1b2233';
            g.fillRect(cx, cy, TW, TH);
            g.fillStyle = '#7d879c';
            g.font = '18px VSingerSans, sans-serif';
            g.fillText('缺图', cx + TW / 2 - 18, cy + TH / 2);
          }
          g.strokeStyle = n ? '#ffffff' : 'rgba(205,210,222,0.8)';
          g.lineWidth = 2;
          g.strokeRect(cx + 1, cy + 1, TW - 2, TH - 2);

          // 角标
          const tagFile = tier === 40 ? tagBig : (tier === 30 ? tagSmall : null);
          if (tagFile && fs.existsSync(tagFile)) {
            const ti = await load(tagFile);
            if (ti) {
              const w = TW * 0.46;
              g.drawImage(ti, cx + 3, cy + 3, w, (ti.height / ti.width) * w);
            }
          }
          if (laser[c.h] && fs.existsSync(tagHolo)) {
            const hi = await load(tagHolo);
            if (hi) {
              const w = TW * 0.36;
              const hh = (hi.height / hi.width) * w;
              g.drawImage(hi, cx + (TW - w) / 2, cy + TH - hh - 4, w, hh);
            }
          }

          // 文字
          g.fillStyle = n ? '#ffffff' : 'rgba(200,205,218,0.9)';
          g.font = '16px VSingerSans, sans-serif';
          g.fillText(fitText(g, c.v.card_name, TW), cx, cy + TH + 20);
          g.fillStyle = n ? tcol : 'rgba(225,230,240,0.85)';
          g.font = '13px VSingerSans, sans-serif';
          g.fillText(fitText(g, `${TIER_NAME[tier]} ${c.v.rate_pct}%`, TW), cx, cy + TH + 40);
          if (n > 1) {
            g.fillStyle = 'rgba(0,0,0,0.75)';
            g.fillRect(cx + TW - 38, cy + 4, 34, 20);
            g.fillStyle = '#8cffaa';
            g.font = 'bold 15px VSingerSans, sans-serif';
            g.fillText(`×${n}`, cx + TW - 35, cy + 19);
          }
        }
        y += blk.h;
      }
    }

    // 噪点
    g.globalAlpha = 0.05;
    for (let i = 0; i < W * H / 12000; i++) {
      g.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    g.globalAlpha = 1;

    const out = path.join(outDir, parts.length === 1 ? `handbook_${uid}.jpg` : `handbook_${uid}_${pi + 1}.jpg`);
    fs.writeFileSync(out, await canvas.encode('jpeg', 82));
    files.push(out);
  }
  return files;
}

module.exports = { render };
