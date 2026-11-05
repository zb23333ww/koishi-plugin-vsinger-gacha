'use strict';
/**
 * 核心数据层：卡池、抽卡、积分、持久化
 * 与 SnowLuma 版的逻辑一致（官方概率 + 400/40 保底 + 同档未拥有优先 + 普卡 15% 镭射）
 */
const fs = require('node:fs');
const path = require('node:path');

const TIER_BIG = '大隐藏';
const TIER_SMALL = '小隐藏';
const TIER_RARE = '稀有';
const TIER_NORMAL = '普通';

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

/** 官方档位映射：40 大隐藏 / 30 小隐藏 / 20 稀有 / 10 普通 */
function tierName(v) {
  const sc = Number(v && v.card_scarcity != null ? v.card_scarcity : 10);
  if (sc === 40) return TIER_BIG;
  if (sc === 30) return TIER_SMALL;
  if (sc === 20) return TIER_RARE;
  return TIER_NORMAL;
}

const TIER_COLOR = {
  [TIER_BIG]: [255, 96, 120],
  [TIER_SMALL]: [255, 176, 80],
  [TIER_RARE]: [150, 190, 255],
  [TIER_NORMAL]: [190, 196, 210],
};

class Store {
  /**
   * @param {string} dir 数据目录（建议 <baseDir>/data/vsinger-gacha）
   */
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.gachaFile = path.join(dir, 'gacha.json');
    this.pointsFile = path.join(dir, 'points.json');
    this.cacheG = null;
    this.cacheP = null;
  }

  gacha() {
    if (!this.cacheG) {
      const raw = loadJson(this.gachaFile, null);
      this.cacheG = raw && raw.users ? raw : { users: {} };
    }
    return this.cacheG;
  }

  saveGacha() {
    saveJson(this.gachaFile, this.gacha());
  }

  points() {
    if (!this.cacheP) {
      const raw = loadJson(this.pointsFile, null);
      this.cacheP = raw && raw.users ? raw : { users: {}, work: {}, eat: {}, moyu: {}, bonus: {} };
    }
    return this.cacheP;
  }

  savePoints() {
    saveJson(this.pointsFile, this.points());
  }

  /** 用户记录（卡） */
  user(uid) {
    const g = this.gacha();
    g.users[uid] = g.users[uid] || { owned: {}, pool: null, pity: {}, laser: {} };
    const u = g.users[uid];
    u.owned = u.owned || {};
    u.pity = u.pity || {};
    u.laser = u.laser || {};
    return u;
  }

  /** 用户记录（积分） */
  pu(uid) {
    const d = this.points();
    d.users[uid] = d.users[uid] || { last: null, days: 0, points: 0, total: 0 };
    return d.users[uid];
  }

  addOwned(uid, hash, n = 1) {
    const u = this.user(uid);
    u.owned[hash] = (u.owned[hash] || 0) + n;
    this.saveGacha();
    return u.owned[hash];
  }

  removeOwned(uid, hash, n = 1) {
    const u = this.user(uid);
    u.owned[hash] = Math.max(0, (u.owned[hash] || 0) - n);
    this.saveGacha();
    return u.owned[hash];
  }

  markLaser(uid, hash) {
    const u = this.user(uid);
    u.laser[hash] = 1;
    this.saveGacha();
  }

  /** 群/频道级选池（同一会话共用） */
  poolOf(sessionKey) {
    const g = this.gacha();
    g.pools = g.pools || {};
    return g.pools[sessionKey] || null;
  }

  setPool(sessionKey, pool) {
    const g = this.gacha();
    g.pools = g.pools || {};
    g.pools[sessionKey] = pool;
    this.saveGacha();
  }
}

const ACT_NAME = {
  171: '天依游学记系列',
  282: 'Vsinger集',
  102550: '洛天依·收藏集',
  106977: '乐正绫单人集',
  108477: '洛天依·珍藏集',
  112860: 'vsinger',
  113552: '洛天依·新像集',
  113562: '言和·珍藏集',
};
const EXCLUDE_POOLS = new Set(['洛天依福利卡池', '全部奖池']);

class Gacha {
  /**
   * @param {object} opts
   * @param {string} opts.assetsDir  assets 目录（catalog.json / pool_rules.json）
   * @param {string} opts.cardsDir   卡图目录（catalog 里的 file 相对此目录）
   * @param {string} opts.holoDir    镭射版目录
   * @param {Store}  opts.store
   * @param {number} opts.laserChance
   */
  constructor(opts) {
    this.cardsDir = opts.cardsDir;
    this.holoDir = opts.holoDir || path.join(opts.cardsDir, 'holo');
    this.store = opts.store;
    this.laserChance = Number.isFinite(opts.laserChance) ? opts.laserChance : 0.15;
    this.catalog = loadJson(path.join(opts.assetsDir, 'catalog.json'), {}) || {};
    this.rules = loadJson(path.join(opts.assetsDir, 'pool_rules.json'), {}) || {};
    this.cards = Object.entries(this.catalog).map(([hash, v]) => ({ h: hash, v }));
    this.pools = this.buildPools();
    this.byName = new Map();
    for (const c of this.cards) {
      const name = String(c.v.card_name || '');
      if (!this.byName.has(name)) this.byName.set(name, []);
      this.byName.get(name).push(c);
    }
  }

  buildPools() {
    const map = new Map();
    for (const c of this.cards) {
      const list = Array.isArray(c.v.pool_list) ? c.v.pool_list : [];
      for (const p of list) {
        const name = String(p);
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(c);
      }
    }
    return map;
  }

  poolNames() {
    return [...this.pools.keys()].filter((n) => !EXCLUDE_POOLS.has(n));
  }

  /** 奖池 → 系列名 */
  seriesOf(pool) {
    const list = this.pools.get(pool) || [];
    const act = list.length ? String(list[0].v.act_id) : '';
    return ACT_NAME[act] || (act ? `act ${act}` : '其他');
  }

  /** 系列 → 池列表（保持稳定顺序） */
  seriesMap() {
    const map = new Map();
    for (const p of this.poolNames()) {
      const k = this.seriesOf(p);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    return map;
  }

  /** /卡池 与 /换池 共用的编号表 */
  table() {
    const out = [];
    let n = 0;
    for (const [act, ps] of this.seriesMap()) {
      n += 1;
      const total = ps.reduce((a, p) => a + (this.pools.get(p) || []).length, 0);
      out.push({ idx: n, type: 'series', name: act, total });
      for (const p of ps) {
        n += 1;
        out.push({ idx: n, type: 'pool', name: p, total: (this.pools.get(p) || []).length });
      }
    }
    return out;
  }

  /** 选择解析：'全部卡池' / 系列名 / 池名 → { mode, pools, label } */
  resolve(sel) {
    const s = String(sel || '').trim();
    if (!s || s === '全部卡池' || s === '全部' || s === '00') {
      return { mode: 'all', label: '全部卡池', pools: this.poolNames() };
    }
    const series = this.seriesMap();
    if (series.has(s)) return { mode: 'series', label: s, pools: series.get(s) };
    if (this.pools.has(s) && !EXCLUDE_POOLS.has(s)) return { mode: 'pool', label: s, pools: [s] };
    return { mode: 'all', label: '全部卡池', pools: this.poolNames() };
  }

  /** 从选中的池里抽：随机池 → 池内按官方规则 */
  drawBy(sel, uid) {
    const r = this.resolve(sel);
    if (!r.pools.length) return null;
    const pool = r.pools[Math.floor(Math.random() * r.pools.length)];
    return this.drawFromPool(pool, uid);
  }

  cardFile(c) {
    return path.join(this.cardsDir, String(c.v.file || ''));
  }

  /**
   * 按需下载单张卡图（catalog 里带 img 直链，约 1MB/张）
   * 只在真正要发图时调用，不需要提前下 800MB
   * @returns {Promise<string|null>} 本地文件路径
   */
  async ensureImage(c) {
    const file = this.cardFile(c);
    if (fs.existsSync(file) && fs.statSync(file).size > 20000) return file;
    const url = c.v && c.v.img;
    if (!url) return fs.existsSync(file) ? file : null;
    this._dl = this._dl || new Map();
    if (this._dl.has(c.h)) return this._dl.get(c.h);
    const task = (async () => {
      try {
        fs.mkdirSync(this.cardsDir, { recursive: true });
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' },
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 20000) return null;
        fs.writeFileSync(file, buf);
        return file;
      } catch {
        return null;
      }
    })();
    this._dl.set(c.h, task);
    const out = await task;
    this._dl.delete(c.h);
    return out;
  }

  holoFile(c) {
    const f = path.join(this.holoDir, c.h + '.jpg');
    return fs.existsSync(f) ? f : null;
  }

  /** 单池抽卡：官方概率 + 保底 + 同档未拥有优先 */
  drawFromPool(pool, uid) {
    const list = this.pools.get(pool);
    if (!list || !list.length) return null;
    const u = this.store.user(uid);

    const ruleEntry = Object.entries(this.rules).find(([, r]) => r && r.name === pool);
    const pid = ruleEntry ? ruleEntry[0] : pool;
    const rule = ruleEntry ? ruleEntry[1] : null;
    const pt = u.pity[pid] || (u.pity[pid] = { big: 0, hid: 0 });
    const pityBig = (rule && rule.pity && rule.pity['大隐藏']) || 400;
    const pityHid = (rule && rule.pity && rule.pity['隐藏']) || 40;

    const byTier = { [TIER_BIG]: [], [TIER_SMALL]: [], [TIER_RARE]: [], [TIER_NORMAL]: [] };
    for (const c of list) {
      const t = tierName(c.v);
      if (byTier[t]) byTier[t].push(c);
    }
    const mass = {};
    for (const [t, arr] of Object.entries(byTier)) {
      mass[t] = arr.reduce((a, c) => a + Math.max(0.01, Number(c.v.rate_pct) || 0.01), 0);
    }

    // ① 选档
    let tierPick = null;
    if (byTier[TIER_BIG].length && pt.big >= pityBig - 1) tierPick = TIER_BIG;
    else if (pt.hid >= pityHid - 1) {
      const tiers = [TIER_BIG, TIER_SMALL].filter((t) => byTier[t].length);
      if (tiers.length === 1) tierPick = tiers[0];
      else if (tiers.length > 1) {
        const tot = mass[TIER_BIG] + mass[TIER_SMALL];
        tierPick = Math.random() * tot < mass[TIER_BIG] ? TIER_BIG : TIER_SMALL;
      }
    }
    if (!tierPick) {
      const tiers = Object.keys(byTier).filter((t) => byTier[t].length);
      const tot = tiers.reduce((a, t) => a + mass[t], 0) || 1;
      let r = Math.random() * tot;
      for (const t of tiers) {
        r -= mass[t];
        if (r <= 0) { tierPick = t; break; }
      }
      tierPick = tierPick || tiers[tiers.length - 1];
    }

    // ② 档内未拥有优先
    const group = byTier[tierPick] || list;
    const unowned = group.filter((c) => !((u.owned[c.h] || 0) > 0));
    const pickFrom = unowned.length ? unowned : group;
    const weights = pickFrom.map((c) => Math.max(0.01, Number(c.v.rate_pct) || 0.01));
    const total = weights.reduce((a, b) => a + b, 0);
    let r2 = Math.random() * total;
    let pick = pickFrom[pickFrom.length - 1];
    for (let i = 0; i < pickFrom.length; i++) {
      r2 -= weights[i];
      if (r2 <= 0) { pick = pickFrom[i]; break; }
    }

    // ③ 保底计数
    const t = tierName(pick.v);
    if (t === TIER_BIG) { pt.big = 0; pt.hid = 0; }
    else if (t === TIER_SMALL) { pt.hid = 0; pt.big += 1; }
    else { pt.big += 1; pt.hid += 1; }

    const laser = t === TIER_NORMAL && Math.random() < this.laserChance;
    return { hash: pick.h, card: pick.v, tier: t, laser };
  }

  /** 按选择抽：single / series / all */
  draw(selection, uid) {
    if (!selection) return null;
    if (selection.kind === 'single') return this.drawFromPool(selection.pool, uid);
    const pool = selection.pools[Math.floor(Math.random() * selection.pools.length)];
    return this.drawFromPool(pool, uid);
  }

  /** 卡名匹配（精确优先） */
  findCards(name) {
    const n = String(name || '').trim();
    if (!n) return [];
    const exact = this.byName.get(n) || [];
    if (exact.length) return exact;
    const out = [];
    for (const c of this.cards) {
      if (String(c.v.card_name || '').includes(n)) out.push(c);
    }
    return out;
  }
}

module.exports = { Store, Gacha, tierName, TIER_COLOR, TIER_BIG, TIER_SMALL, TIER_RARE, TIER_NORMAL, loadJson, saveJson };
