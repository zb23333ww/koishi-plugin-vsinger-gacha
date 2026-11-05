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
const kit = require('./render/kit');
const theme = require('./render/theme');
const COLOR = theme.COLOR;
const ctx_fs = require('node:fs');

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

const TW = 180;
const TH = 257;
const LABEL_H = 66;
const GAP = 14;
const PAD = 24;
const HEAD = 128;
const POOL_TITLE_H = 46;
const SERIES_H = 50;
const COLS_PER_COL = 7;
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

async function render({ game, store, uid, displayName, outDir, tagsDir, thumbsDir, wallpaperDir }) {
  const Canvas = getCanvas();

  // ★ 优先用高清缩略图（assets/thumbs_hi，423 张），其次普通缩略图
  const hiDir = path.join(__dirname, '..', 'assets', 'thumbs_hi');
  let thumbs = fs.existsSync(hiDir) && fs.readdirSync(hiDir).length
    ? hiDir
    : (thumbsDir && fs.existsSync(thumbsDir) ? thumbsDir : null);
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
  let _lastAct = null;
  for (const [act, pm] of seriesMap) {
    for (const [pool, arr] of pm) {
      arr.sort((a, b) => Number(b.v.rate_pct || 0) - Number(a.v.rate_pct || 0));
      const rows = Math.max(1, Math.ceil(arr.length / COLS_PER_COL));
      const got = arr.filter((c) => (owned[c.h] || 0) > 0).length;
      const isNewSeries = act !== _lastAct;
      // ★ 2026-11-05：系列头也要占高度，否则下一块会压到上一块的卡片上
      const h = POOL_TITLE_H + rows * ROWH + 12 + (isNewSeries ? SERIES_H : 0);
      blocks.push({ act, pool, arr, got, series: isNewSeries, h });
      _lastAct = act;
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
    // 头部高度随图标自适应（避免标题压到第一个系列条）
    const _R = Math.max(26, Math.min(72, Math.round(W * 0.017)));
    const HEADY = Math.max(HEAD, 34 + _R * 2 + 40);
    const H = HEADY + Math.max(...part.map((c) => c.reduce((a, b) => a + b.h, 0))) + 70;
    const canvas = Canvas.createCanvas(W, H);
    const g = canvas.getContext('2d');

    // 背景：插画 + 白蒙层（统一渲染系统）
    const wall = wallpaperDir ? (() => {
      try {
        const list = ctx_fs.readdirSync(wallpaperDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
        return list.length ? require('node:path').join(wallpaperDir, list[Math.floor(Math.random() * list.length)]) : null;
      } catch { return null; }
    })() : null;
    await kit.background(g, Canvas, W, H, wall);

    // 标题（统一组件）
    const gotN = Object.keys(owned).length;
    const dupN = Object.values(owned).reduce((a, b) => a + Math.max(0, b - 1), 0);
    kit.header(g, {
      x: PAD, y: 34, W: W - PAD * 2,
      title: 'VSinger 收藏集 · 我的图鉴',
      subtitle: `${displayName}　已收集 ${gotN}/${game.cards.length}　重复 ${dupN} 张`,
      badge: `${gotN}/${game.cards.length}`,
      badgeSub: '收集进度',
      progress: game.cards.length ? gotN / game.cards.length : 0,
    });

    for (let ci = 0; ci < part.length; ci++) {
      const grp = part[ci];
      const x0 = PAD + ci * (COLW + GAP * 2);
      let y = HEADY;
      let prevAct = null;
      for (const blk of grp) {
        if (blk.act !== prevAct) {
          const sh = SERIES_H - 8;
          kit.panel(g, x0, y + 2, COLW, sh, { radius: 14, fill: 'rgba(255,255,255,0.88)' });
          g.fillStyle = COLOR.accent;
          kit.roundRect(g, x0 + 12, y + 2 + (sh - 20) / 2, 5, 20, 3);
          g.fill();
          g.fillStyle = COLOR.text;
          g.font = 'bold 20px VSingerSans, sans-serif';
          g.textBaseline = 'middle';
          g.fillText(blk.act, x0 + 26, y + 2 + sh / 2);
          g.textBaseline = 'top';
          y += SERIES_H;
          prevAct = blk.act;
        }
        // 池标题（玻璃条）
        const ph = POOL_TITLE_H - 10;
        kit.panel(g, x0, y + 1, COLW, ph, { radius: 12, fill: 'rgba(255,255,255,0.78)' });
        g.textBaseline = 'middle';
        g.fillStyle = COLOR.accent;
        g.font = 'bold 18px VSingerSans, sans-serif';
        g.fillText(kit.fit(g, blk.pool, 'bold 18px VSingerSans, sans-serif', COLW - 100), x0 + 12, y + 1 + ph / 2);
        g.fillStyle = COLOR.textSub;
        g.font = '16px VSingerSans, sans-serif';
        g.textAlign = 'right';
        g.fillText(`${blk.got}/${blk.arr.length}`, x0 + COLW - 12, y + 1 + ph / 2);
        g.textAlign = 'left';
        g.textBaseline = 'top';

        for (let i = 0; i < blk.arr.length; i++) {
          const c = blk.arr[i];
          const cx = x0 + (i % COLS_PER_COL) * (TW + GAP);
          const cy = y + POOL_TITLE_H + Math.floor(i / COLS_PER_COL) * ROWH;
          const n = owned[c.h] || 0;
          const img = await load(path.join(thumbs, c.h + '.jpg'));
          await kit.card(g, Canvas, {
            img, x: cx, y: cy, w: TW, h: TH,
            name: c.v.card_name,
            rate: c.v.rate_pct,
            tier: tierOf(c.v),
            laser: Boolean(laser[c.h]),
            count: n,
            owned: n > 0,
            tagsDir,
            nameSize: 18,
            metaSize: 14,
          });
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


async function renderResult(opts) {
  const Canvas = getCanvas();
  const { render } = require('./render/result');
  return render({ Canvas, ...opts });
}

module.exports = { render, renderResult };
