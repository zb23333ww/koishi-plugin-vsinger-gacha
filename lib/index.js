'use strict';
/**
 * koishi-plugin-vsinger-gacha
 *
 * VSinger 收藏集抽卡（六位角色 / 423 张官方卡 / 43 个奖池）
 *  - 抽卡：官方概率 + 400/40 保底 + 同档未拥有优先 + 普卡 15% 镭射
 *  - 积分：签到 / 打工 / 蹭饭 / 摸鱼 / 每日红包（内置，不依赖其它插件）
 *  - 图鉴：@napi-rs/canvas 渲染长图（分张 + 像素上限，防 OOM）
 *  - 管理：给卡（管理员可凭空发；普通用户需自有转赠）/ 设积分 / 加积分 / 查积分
 *
 * 约定：用户标识统一用 `${platform}:${userId}`（Koishi 原生 user 参数类型也是这个格式），
 *      不依赖任何平台的 openid 映射。
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Schema, h } = require('koishi');
const { Store, Gacha, tierName } = require('./core');

const name = 'vsinger-gacha';
const inject = [];

const Config = Schema.intersect([
  Schema.object({
    cardsDir: Schema.string()
      .default('data/vsinger-gacha/cards')
      .description('卡图目录（用 `npm run fetch-assets -- --dir <这个目录>` 下载 423 张卡图）'),
    laserChance: Schema.number().min(0).max(1).step(0.01).default(0.15)
      .description('普卡出镭射版的概率'),
    adminUsers: Schema.array(Schema.string()).default([])
      .description('管理员列表，写 `platform:userId` 或纯 userId；Koishi 权限 ≥4 的用户也会被视为管理员'),
  }).description('基础设置'),
  Schema.object({
    pointsPerDraw: Schema.natural().min(1).default(10).description('单抽消耗积分'),
    maxDrawOnce: Schema.natural().min(1).max(10).default(10).description('单次最多抽几张'),
    signMin: Schema.natural().default(10).description('签到最少积分'),
    signMax: Schema.natural().default(30).description('签到最多积分'),
  }).description('抽卡与签到'),
  Schema.object({
    workCap: Schema.natural().default(200).description('打工积分上限'),
    workHours: Schema.natural().default(12).description('打工攒满上限所需小时'),
    eatCdMin: Schema.natural().default(30).description('蹭饭冷却（分钟）'),
    moyuCdMin: Schema.natural().default(10).description('摸鱼冷却（分钟）'),
    bonusMin: Schema.natural().default(5).description('每日红包最少积分'),
    bonusMax: Schema.natural().default(20).description('每日红包最多积分'),
  }).description('挂机玩法'),
]);

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const randInt = (a, b) => {
  const lo = Math.ceil(Math.min(a, b));
  const hi = Math.floor(Math.max(a, b));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
};

/** 统一用户标识：platform:userId */
const uidOf = (session) => `${(session && session.platform) || 'unknown'}:${session && session.userId}`;

/** 把 user 参数（platform:id）或纯 id 统一成 uid */
const normUser = (raw, session) => {
  const s = String(raw || '').trim();
  if (!s) return uidOf(session);
  if (s.includes(':')) return s;
  return `${(session && session.platform) || 'unknown'}:${s}`;
};

const fileEl = (file, mime) => {
  try {
    return h.image(pathToFileURL(file).href);
  } catch {
    return h.image(fs.readFileSync(file), mime);
  }
};

function apply(ctx, config) {
  const logger = ctx.logger('vsinger-gacha');
  const base = ctx.baseDir || process.cwd();
  const dataDir = path.join(base, 'data', 'vsinger-gacha');
  const cardsDir = path.isAbsolute(config.cardsDir) ? config.cardsDir : path.join(base, config.cardsDir);
  const assetsDir = path.join(__dirname, '..', 'assets');
  const tagsDir = path.join(assetsDir, 'tags');
  const store = new Store(dataDir);
  const game = new Gacha({
    assetsDir,
    cardsDir,
    holoDir: path.join(cardsDir, 'holo'),
    store,
    laserChance: config.laserChance,
  });

  if (!game.cards.length) {
    logger.error('没读到 assets/catalog.json，插件无法工作');
    return;
  }

  let handbook = null;
  try {
    handbook = require('./handbook');
  } catch (e) {
    logger.warn('图鉴不可用（@napi-rs/canvas 未安装？）：%s', e.message);
  }

  const missing = game.cards.filter((c) => !fs.existsSync(game.cardFile(c))).length;
  if (missing) {
    logger.warn('卡图缺失 %d/%d 张，可执行： npm run fetch-assets -- --dir %s', missing, game.cards.length, cardsDir);
  } else {
    logger.info('卡图完整：%d 张 / %d 个奖池', game.cards.length, game.pools.size);
  }

  const isAdmin = (session) => {
    const uid = uidOf(session);
    const list = (config.adminUsers || []).map(String);
    if (list.includes(uid) || list.includes(String(session.userId))) return true;
    const authority = session && session.event && session.event.user && session.event.user.authority;
    return Number(authority) >= 4;
  };

  const sessKey = (session) => String((session && (session.guildId || session.channelId || session.userId)) || 'global');
  const cost = (n) => Math.max(1, Number(config.pointsPerDraw) || 10) * n;

  const settleWork = () => {
    const d = store.points();
    const now = Date.now();
    const cap = Number(config.workCap) || 200;
    const perMin = cap / ((Number(config.workHours) || 12) * 60);
    let changed = false;
    for (const [uid, w] of Object.entries(d.work || {})) {
      if (!w || !w.active) continue;
      const last = Number(w.lastAt || w.startAt || now);
      const minutes = Math.max(0, (now - last) / 60000);
      if (minutes <= 0) continue;
      const raw = Math.min(minutes * perMin, Math.max(0, cap - Number(w.earned || 0)));
      const carry = Number(w.carry || 0) + raw;
      const whole = Math.floor(carry);
      w.carry = carry - whole;
      if (whole > 0) {
        const u = store.pu(uid);
        u.points = Math.round(Number(u.points || 0)) + whole;
      }
      w.earned = Math.min(cap, Number(w.earned || 0) + raw);
      w.lastAt = now;
      changed = true;
      if (Number(w.earned || 0) >= cap - 0.001) w.active = false;
    }
    if (changed) store.savePoints();
  };

  ctx.setInterval(() => {
    try { settleWork(); } catch (e) { logger.warn('打工结算失败：%s', e.message); }
  }, 60 * 1000);

  ctx.command('抽卡 [n:number]', 'VSinger 收藏集抽卡').alias('gacha')
    .action(async ({ session }, n) => {
      const uid = uidOf(session);
      const times = Math.max(1, Math.min(Number(config.maxDrawOnce) || 10, Math.floor(Number(n) || 1)));
      const need = cost(times);
      const u = store.pu(uid);
      if (Number(u.points || 0) < need) {
        return `积分不够啦：抽 ${times} 张要 ${need} 分，你现在 ${Math.round(Number(u.points || 0))} 分（先 /签到 或 /打工 攒点）`;
      }
      const key = sessKey(session);
      let chosen = store.poolOf(key);
      if (chosen && !game.pools.has(chosen)) chosen = null;

      const results = [];
      for (let i = 0; i < times; i++) {
        const sel = chosen
          ? { kind: 'single', pool: chosen }
          : { kind: 'all', pools: game.poolNames() };
        const r = game.draw(sel, uid);
        if (!r) break;
        store.addOwned(uid, r.hash, 1);
        if (r.laser) store.markLaser(uid, r.hash);
        results.push(r);
      }
      if (!results.length) return '抽卡失败：奖池数据异常';
      u.points = Math.max(0, Math.round(Number(u.points || 0)) - cost(results.length));
      store.savePoints();

      const head = `${session.username || '你'} 抽了 ${results.length} 张（-${cost(results.length)} 分，剩 ${u.points}）`;
      const lines = results.map((r, i) => {
        const rate = r.card.rate_pct == null ? '' : ` ${r.card.rate_pct}%`;
        return `${i + 1}. ${r.tier}｜${r.card.card_name}${rate}${r.laser ? '｜✦镭射版' : ''}${r.card.video ? '｜动态' : ''}`;
      });
      await session.send(head + '\n' + lines.join('\n'));

      for (const r of results) {
        const c = { h: r.hash, v: r.card };
        const f = (r.laser && game.holoFile(c)) || game.cardFile(c);
        if (!fs.existsSync(f)) continue;
        try {
          await session.send(fileEl(f, /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png'));
        } catch (e) { logger.warn('发卡图失败：%s', e.message); }
      }
      return;
    });

  ctx.command('签到', '每日签到领积分').alias('打卡')
    .action(async ({ session }) => {
      const uid = uidOf(session);
      const u = store.pu(uid);
      const t = todayKey();
      if (u.last === t) return '今天已经签过啦，明天再来～';
      const gain = randInt(config.signMin, config.signMax);
      u.last = t;
      u.days = Number(u.days || 0) + 1;
      u.points = Math.round(Number(u.points || 0)) + gain;
      u.total = Math.round(Number(u.total || 0)) + gain;
      store.savePoints();
      return `✅ 签到成功！+${gain} 分（连续 ${u.days} 天，当前 ${u.points} 分）`;
    });

  ctx.command('卡池', '查看奖池与当前选择').action(async ({ session }) => {
    const names = game.poolNames();
    const cur = store.poolOf(sessKey(session));
    const lines = [`【奖池】当前：${cur || '全部奖池'}`, '00. 全部奖池'];
    names.forEach((nm, i) => {
      lines.push(`${String(i + 1).padStart(2, '0')}. ${nm}（${(game.pools.get(nm) || []).length} 张）`);
    });
    lines.push('', '用 /换池 <序号|名称> 切换');
    return lines.join('\n');
  });

  ctx.command('换池 <target:text>', '切换奖池').action(async ({ session }, target) => {
    const t = String(target || '').trim();
    if (!t) return '用法：/换池 3 或 /换池 心律共鸣（00 = 全部奖池）';
    if (['00', '0', '全部', '全部奖池'].includes(t)) {
      store.setPool(sessKey(session), null);
      return '✅ 已切换到「全部奖池」';
    }
    const names = game.poolNames();
    const idx = Number(t);
    if (Number.isInteger(idx) && idx >= 1 && idx <= names.length) {
      store.setPool(sessKey(session), names[idx - 1]);
      return `✅ 已切换到「${names[idx - 1]}」`;
    }
    const hit = names.find((x) => x === t) || names.find((x) => x.includes(t));
    if (!hit) return `没有找到奖池「${t}」，发 /卡池 看看列表`;
    store.setPool(sessKey(session), hit);
    return `✅ 已切换到「${hit}」`;
  });

  ctx.command('获取卡 <name:text>', '把已拥有的卡发出来').action(async ({ session }, nameArg) => {
    const uid = uidOf(session);
    const q = String(nameArg || '').trim();
    if (!q) return '用法：/获取卡 <卡名>';
    const hits = game.findCards(q);
    if (!hits.length) return `没有找到「${q}」这张卡`;
    const u = store.user(uid);
    const owned = hits.filter((c) => (u.owned[c.h] || 0) > 0);
    if (!owned.length) return `你还没有「${q}」，不能获取`;
    if (owned.length > 1) {
      return `匹配到多张：\n` + owned.slice(0, 10).map((c) => `· ${c.v.card_name}`).join('\n') + '\n写更完整的名字';
    }
    const c = owned[0];
    const f = game.holoFile(c) || game.cardFile(c);
    if (!fs.existsSync(f)) return `「${c.v.card_name}」的卡图还没下载，先跑 npm run fetch-assets`;
    await session.send(fileEl(f, /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png'));
    return `🎴 ${c.v.card_name}\n档位：${tierName(c.v)} ｜ 概率：${c.v.rate_pct}% ｜ 你拥有 ×${u.owned[c.h]}${c.v.video ? ' ｜ 动态卡' : ''}`;
  });

  ctx.command('图鉴', '生成收藏集长图').action(async ({ session }) => {
    if (!handbook) return '图鉴不可用：请安装 @napi-rs/canvas 后重启';
    await session.send('🎨 正在生成图鉴长图，稍等…');
    try {
      const files = await handbook.render({
        game,
        store,
        uid: uidOf(session),
        displayName: session.username || '玩家',
        outDir: path.join(dataDir, 'out'),
        tagsDir,
        thumbsDir: path.join(assetsDir, 'thumbs'),
      });
      for (const f of files) await session.send(fileEl(f, 'image/jpeg'));
    } catch (e) {
      logger.warn('图鉴失败：%s', e.stack || e.message);
      return `图鉴生成失败：${String(e.message).slice(0, 120)}`;
    }
  });

  ctx.command('打工', '挂机攒积分（再发一次结算并停止）').action(async ({ session }) => {
    const uid = uidOf(session);
    settleWork();
    const d = store.points();
    d.work = d.work || {};
    const w = d.work[uid];
    if (w && w.active) {
      w.active = false;
      store.savePoints();
      return `🛑 已停止打工：本轮共赚 ${Math.round(Number(w.earned || 0))} 分`;
    }
    d.work[uid] = { active: true, startAt: Date.now(), lastAt: Date.now(), earned: 0, carry: 0 };
    store.savePoints();
    return `💼 开始打工：${config.workHours} 小时最多 ${config.workCap} 分，再发 /打工 结算并停止`;
  });

  ctx.command('打工状态', '查看打工进度').action(async ({ session }) => {
    settleWork();
    const uid = uidOf(session);
    const w = (store.points().work || {})[uid];
    const u = store.pu(uid);
    if (!w || !w.active) return `没有在打工。当前积分 ${Math.round(Number(u.points || 0))}`;
    return `💼 打工中：已赚 ${Math.round(Number(w.earned || 0))}/${config.workCap} 分（当前 ${Math.round(Number(u.points || 0))} 分）`;
  });

  ctx.command('蹭饭', `每 ${config.eatCdMin} 分钟领一次积分`).action(async ({ session }) => {
    const uid = uidOf(session);
    const d = store.points();
    d.eat = d.eat || {};
    const now = Date.now();
    const cd = (Number(config.eatCdMin) || 30) * 60000;
    const last = Number(d.eat[uid] || 0);
    if (now - last < cd) return `还没到饭点，${Math.ceil((cd - (now - last)) / 60000)} 分钟后再来`;
    const gain = randInt(3, 8);
    const u = store.pu(uid);
    u.points = Math.round(Number(u.points || 0)) + gain;
    d.eat[uid] = now;
    store.savePoints();
    return `🍚 蹭到一顿饭：+${gain} 分（当前 ${u.points}）`;
  });

  ctx.command('摸鱼', `每 ${config.moyuCdMin} 分钟领一次积分`).action(async ({ session }) => {
    const uid = uidOf(session);
    const d = store.points();
    d.moyu = d.moyu || {};
    const now = Date.now();
    const cd = (Number(config.moyuCdMin) || 10) * 60000;
    const last = Number(d.moyu[uid] || 0);
    if (now - last < cd) return `摸鱼也要喘气的，${Math.ceil((cd - (now - last)) / 60000)} 分钟后再来`;
    const gain = randInt(1, 4);
    const u = store.pu(uid);
    u.points = Math.round(Number(u.points || 0)) + gain;
    d.moyu[uid] = now;
    store.savePoints();
    return `🐟 摸了一会鱼：+${gain} 分（当前 ${u.points}）`;
  });

  ctx.command('每日红包', '每天领一次积分').action(async ({ session }) => {
    const uid = uidOf(session);
    const d = store.points();
    d.bonus = d.bonus || {};
    const t = todayKey();
    if (d.bonus[uid] === t) return '今天的红包已经领过啦';
    const gain = randInt(config.bonusMin, config.bonusMax);
    const u = store.pu(uid);
    u.points = Math.round(Number(u.points || 0)) + gain;
    d.bonus[uid] = t;
    store.savePoints();
    return `🧧 每日红包：+${gain} 分（当前 ${u.points}）`;
  });

  // ★ 用 Koishi 原生 user 参数类型：@ 或 平台:id 都能解析，不需要 openid
  ctx.command('查积分 [target:user]', '查积分').action(async ({ session }, target) => {
    const uid = target ? normUser(target, session) : uidOf(session);
    if (uid !== uidOf(session) && !isAdmin(session)) return '只能查自己的积分';
    const u = store.pu(uid);
    return `💰 ${uid}：积分 ${Math.round(Number(u.points || 0))} ｜ 累计 ${Math.round(Number(u.total || 0))} ｜ 签到 ${u.days || 0} 天`;
  });

  ctx.command('给卡 <target:user> <name:text>', '给某人一张卡')
    .action(async ({ session }, target, nameArg) => {
      if (!target) return '用法：/给卡 @某人 <卡名>';
      const targetUid = normUser(target, session);
      const me = uidOf(session);
      const q = String(nameArg || '').trim();
      if (!q) return '还要写卡名，例如：/给卡 @小明 神明一撇';
      const admin = isAdmin(session);
      const u = store.user(me);
      const hits = game.findCards(q);
      if (!hits.length) return `没找到「${q}」这张卡`;
      const usable = admin ? hits : hits.filter((c) => (u.owned[c.h] || 0) > 0);
      if (!usable.length) return `你还没有「${q}」，不能转给别人`;
      if (usable.length > 1) {
        return `匹配到多张：\n` + usable.slice(0, 10).map((c) => `· ${c.v.card_name}`).join('\n') + '\n请写更完整的卡名';
      }
      const c = usable[0];
      if (targetUid === me) return '给自己发卡没意义哦';
      if (admin) {
        store.addOwned(targetUid, c.h, 1);
        return `🎁 已直接给 ${targetUid} 发放「${c.v.card_name}」（管理员模式，不消耗自己的卡）`;
      }
      store.removeOwned(me, c.h, 1);
      store.addOwned(targetUid, c.h, 1);
      return `🎁 已把「${c.v.card_name}」转给 ${targetUid}（你剩 ${u.owned[c.h]} 张）`;
    });

  ctx.command('设积分 <target:user> <value:number>', '设置某人积分')
    .action(async ({ session }, target, value) => {
      if (!isAdmin(session)) return '只有管理员能用';
      if (!target || !Number.isFinite(value)) return '用法：/设积分 @某人 1000';
      const uid = normUser(target, session);
      const u = store.pu(uid);
      u.points = Math.max(0, Math.round(value));
      store.savePoints();
      return `💰 ${uid} 的积分已设为 ${u.points}`;
    });

  ctx.command('加积分 <target:user> <value:number>', '增减某人积分')
    .action(async ({ session }, target, value) => {
      if (!isAdmin(session)) return '只有管理员能用';
      if (!target || !Number.isFinite(value)) return '用法：/加积分 @某人 200';
      const uid = normUser(target, session);
      const u = store.pu(uid);
      u.points = Math.max(0, Math.round(Number(u.points || 0) + value));
      store.savePoints();
      return `💰 ${uid} 积分 ${value >= 0 ? '+' : ''}${value} → 现在 ${u.points}`;
    });

  ctx.command('抽卡帮助', '查看抽卡玩法').action(async () => [
    '【VSinger 收藏集抽卡】',
    '/签到              每天领积分',
    `/抽卡 [张数]        每张 ${config.pointsPerDraw} 分，最多 ${config.maxDrawOnce} 张`,
    '/卡池 /换池 <序号|名称>',
    '/获取卡 <卡名>      把已拥有的卡发出来',
    '/图鉴              生成收藏集长图',
    '/打工 /打工状态 /蹭饭 /摸鱼 /每日红包',
    '/查积分 [@某人]',
    '管理员：/给卡 @某人 <卡名>、/设积分 @某人 N、/加积分 @某人 N',
  ].join('\n'));
}

module.exports = { name, Config, apply, inject, reusable: false };
