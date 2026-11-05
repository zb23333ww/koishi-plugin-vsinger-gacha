#!/usr/bin/env node
/**
 * 下载 VSinger 收藏集卡图（423 张）
 *
 * 用法：
 *   node scripts/fetch-assets.mjs --dir ./data/vsinger-gacha/cards
 *   node scripts/fetch-assets.mjs --dir ... --cookie "SESSDATA=..."   # 可选
 *   node scripts/fetch-assets.mjs --dir ... --videos                  # 同时下动态卡 mp4（约 1.1GB）
 *
 * 说明：图片来自 B 站「收藏集」接口 asset_bag 的 card_img（无水印版）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const dir = String(arg('dir', path.join(pkgRoot, 'data', 'cards')) || '');
const cookie = String(arg('cookie', process.env.BILI_COOKIE || '') || '');
const withVideos = Boolean(arg('videos', false));
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile';

const catalogFile = path.join(pkgRoot, 'assets', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const entries = Object.entries(catalog);
const acts = [...new Set(entries.map(([, v]) => String(v.act_id)))].filter(Boolean);
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.join(dir, 'videos'), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url, actId) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: `https://www.bilibili.com/h5/mall/digital-card/handbook?act_id=${actId}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function download(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 20000) throw new Error(`文件过小 ${buf.length}B`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf.length;
}

let okCount = 0;
let failCount = 0;
const failed = [];

for (const act of acts) {
  let bag;
  try {
    bag = await api(`https://api.bilibili.com/x/vas/dlc_act/asset_bag?act_id=${act}`, act);
  } catch (e) {
    console.warn(`[act ${act}] 拉取失败：${e.message}`);
    continue;
  }
  const items = (bag && bag.data && bag.data.item_list) || [];
  const byName = new Map();
  for (const it of items) {
    const ci = (it && it.card_item) || {};
    if (ci.card_name) byName.set(String(ci.card_name), ci);
  }

  const mine = entries.filter(([, v]) => String(v.act_id) === act);
  console.log(`[act ${act}] ${mine.length} 张卡 / 接口 ${items.length} 张`);
  for (const [hash, v] of mine) {
    const out = path.join(dir, String(v.file || `${hash}.png`));
    if (fs.existsSync(out) && fs.statSync(out).size > 20000) { okCount++; continue; }
    const ci = byName.get(String(v.card_name));
    if (!ci || !ci.card_img) { failCount++; failed.push(v.card_name); continue; }
    try {
      await download(String(ci.card_img), out);
      okCount++;
      if (withVideos && ci.video_list && ci.video_list[0] && ci.video_list[0].url) {
        const vf = path.join(dir, 'videos', `${hash}.mp4`);
        if (!fs.existsSync(vf)) {
          try { await download(ci.video_list[0].url, vf); } catch { /* 忽略视频失败 */ }
        }
      }
      if (okCount % 20 === 0) console.log(`  已下载 ${okCount}`);
    } catch (e) {
      failCount++;
      failed.push(`${v.card_name}（${e.message}）`);
    }
    await sleep(250);
  }
  await sleep(800);
}

console.log(`\n完成：成功 ${okCount} / 失败 ${failCount}`);
if (failed.length) console.log('失败清单（可重跑脚本补齐）：\n' + failed.slice(0, 40).join('\n'));
console.log(`卡图目录：${dir}`);
