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
    idMapFile: Schema.string().default('')
      .description('可选：openid ↔ QQ 映射表（如 /root/qqbot/data/id-map.json），用于统一用户标识'),
    ignoreAtOthers: Schema.boolean().default(true)
      .description('消息里 @ 的是别的机器人/别人时，本插件不响应（避免同群两个机器人重复回复）'),
    debug: Schema.boolean().default(false)
      .description('调试模式：把收到的每条消息打到日志里'),
    resultImage: Schema.union(['auto', 'always', 'off']).default('auto')
      .description('抽卡结果图：auto=不能合并转发时渲染成一张图；always=总是；off=纯文本'),
    forwardMode: Schema.union(['auto', 'off']).default('auto')
      .description('合并转发：auto=支持就转发、不支持自动退回普通消息；off=永远普通消息'),
    imageMode: Schema.union(['auto', 'buffer', 'file']).default('auto')
      .description('发图方式：auto=buffer（base64，跨容器最稳）；file=发本地路径（需适配器能读同机文件）'),
    sendVideos: Schema.boolean().default(true)
      .description('动态卡单独发送 mp4（需要本地 videos 目录有对应文件）'),
    autoDownload: Schema.boolean().default(true)
      .description('抽到/查看的卡图缺失时自动从 B 站下载（单张约 1MB）'),
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

// ★ 可选 id 映射表：把 QQ 号统一映射成 openid（和旧机器人数据对齐）
let ID_MAP = null;      // QQ → openid（来自 id-map.json）
let ID_REV = null;      // openid → QQ（反查）
function loadIdMap(file) {
  if (!file) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const users = raw.users || null;
    if (users) {
      ID_REV = {};
      for (const [qq, oid] of Object.entries(users)) ID_REV[String(oid)] = qq;
    }
    return users;
  } catch {
    return null;
  }
}
/**
 * 归一化用户 ID：
 *   ★ 官机 openid 每个机器人都不一样，不能当主键
 *   → openid 尽量反查成 QQ；QQ 原样保留
 */
function normId(id) {
  const s = String(id || '');
  if (!s) return s;
  if (/^\d{5,12}$/.test(s)) return s;              // 已经是 QQ
  if (ID_REV && ID_REV[s]) return ID_REV[s];        // openid → QQ
  return s;                                          // 查不到就保留（下次能合并）
}

/** 统一用户标识：platform:userId */
const uidOf = (session) => `${(session && session.platform) || 'unknown'}:${normId(session && session.userId)}`;

/** 把 user 参数（platform:id）或纯 id 统一成 uid */
const normUser = (raw, session) => {
  const s = String(raw || '').trim();
  if (!s) return uidOf(session);
  if (s.includes(':')) {
    const [pf, id] = s.split(':');
    return `${pf}:${normId(id)}`;
  }
  return `${(session && session.platform) || 'unknown'}:${normId(s)}`;
};

/**
 * 发本地图片
 * ★ 不用 file:// 路径：机器人框架 / OneBot 实现在容器里读不到宿主机路径
 *   → 直接用 buffer（Koishi 会编码成 data/base64，跨进程可用）
 */
/** 机器人自身 uin / 显示名（不同适配器字段不一样） */
function botUin(session) {
  return String(session.selfId || (session.bot && session.bot.selfId) || (session.bot && session.bot.config && session.bot.config.selfId) || '');
}
function botName(session) {
  return String((session.bot && (session.bot.username || session.bot.name)) || 'Bot');
}

function fileEl(file, mime, mode) {
  const mt = mime || (/\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png');
  if (mode === 'file') {
    try {
      return h.image(require('node:url').pathToFileURL(file).href);
    } catch { /* 退回 buffer */ }
  }
  return h.image(fs.readFileSync(file), mt);
}


/** 发合并转发（OneBot 私有 API）；失败返回 false */
async function sendForward(session, nodes) {
  const bot = session.bot;
  if (!bot || !bot.internal) {
    sendForward.lastError = 'adapter 不支持 internal API';
    return false;
  }
  const gid = session.guildId || session.channelId;
  if (session.isDirect || !gid) return false;
  const internal = bot.internal;
  const attempts = [
    ['send_group_forward_msg', (fn) => fn(gid, nodes)],
    ['send_group_forward_msg', (fn) => fn({ group_id: gid, messages: nodes })],
    ['sendGroupForwardMsg', (fn) => fn(gid, nodes)],
    ['send_forward_msg', (fn) => fn(gid, nodes)],
    ['send_forward_msg', (fn) => fn({ group_id: gid, messages: nodes })],
  ];
  const errors = [];
  for (const [name, call] of attempts) {
    if (typeof internal[name] !== 'function') continue;
    try {
      await call(internal[name].bind(internal));
      return true;
    } catch (e) {
      errors.push(`${name}: ${String(e && e.message || e).slice(0, 90)}`);
    }
  }
  sendForward.lastError = errors.length ? errors.join(' | ') : 'no api';
  return false;
}

/** 本地视频 → 消息元素（OneBot 要求视频单独一条消息） */
function videoEl(file) {
  const buf = fs.readFileSync(file);
  if (typeof h.video === 'function') {
    try { return h.video(buf, 'video/mp4'); } catch { /* 退回通用元素 */ }
  }
  return h('video', { src: 'data:video/mp4;base64,' + buf.toString('base64') });
}

/** 本地图片 → OneBot base64 段 */
function imgSeg(file) {
  const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png';
  return { type: 'image', data: { file: 'base64://' + fs.readFileSync(file).toString('base64') } };
}

function apply(ctx, config) {
  const logger = ctx.logger('vsinger-gacha');
  const base = ctx.baseDir || process.cwd();
  const dataDir = path.join(base, 'data', 'vsinger-gacha');
  const cardsDir = path.isAbsolute(config.cardsDir) ? config.cardsDir : path.join(base, config.cardsDir);
  const assetsDir = path.join(__dirname, '..', 'assets');
  const tagsDir = path.join(assetsDir, 'tags');
  if (config.idMapFile) ID_MAP = loadIdMap(config.idMapFile);
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
    logger.info('抽卡数据就绪：%d 张卡 / %d 个奖池（本地缺 %d 张原图，用到时会自动下载）',
      game.cards.length, game.pools.size, missing);
  } else {
    logger.info('抽卡数据就绪：%d 张卡 / %d 个奖池（卡图齐全）', game.cards.length, game.pools.size);
  }

  // ★ 同群多机器人时：消息 @ 的不是自己 → 不处理（避免重复回复）
  if (config.ignoreAtOthers !== false) {
    ctx.middleware((session, next) => {
      try {
        const els = (session.event && session.event.message && session.event.message.elements) || [];
        const ats = els.filter((e) => e && e.type === 'at').map((e) => String(e.attrs && e.attrs.id || ''));
        if (ats.length && !ats.includes('all') && !ats.includes(String(session.selfId || ''))) {
          return;                        // 拦截：这条是给别的机器人的
        }
      } catch { /* 忽略 */ }
      return next();
    }, true);
  }

  if (config.debug) {
    ctx.middleware((session, next) => {
      try {
        logger.info('[recv] %s > %s', session.userId, String(session.content || '').slice(0, 120));
      } catch { /* ignore */ }
      return next();
    }, true);
  }

  const isAdmin = (session) => {
    const uid = uidOf(session);
    const list = (config.adminUsers || []).map(String);
    const bare = list.map((x) => normId(String(x).includes(':') ? String(x).split(':').pop() : x));
    if (list.includes(uid) || list.includes(String(session.userId)) || bare.includes(normId(session.userId))) return true;
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
        const r = game.drawBy(chosen || '全部卡池', uid);
        if (!r) break;
        store.addOwned(uid, r.hash, 1);
        if (r.laser) store.markLaser(uid, r.hash);
        results.push(r);
      }
      if (!results.length) return '抽卡失败：奖池数据异常';
      u.points = Math.max(0, Math.round(Number(u.points || 0)) - cost(results.length));
      store.savePoints();

      const who = session.username || '你';
      const title = `${who} 抽了 ${results.length} 张（-${cost(results.length)} 分，剩 ${u.points}）`;

      // 先把每张卡的图片准备好
      const pics = [];
      for (const r of results) {
        const c = { h: r.hash, v: r.card };
        const local = game.cardFile(c);
        const f = (r.laser && game.holoFile(c))
          || (config.autoDownload !== false ? await game.ensureImage(c) : (fs.existsSync(local) ? local : null));
        pics.push(f);
      }

      // ★ 优先用合并转发（和旧版一致）
      const nodes = [];
      if (session.isDirect === false || session.guildId) {
        nodes.push({
          type: 'node',
          data: { name: botName(session), uin: botUin(session), content: [{ type: 'text', data: { text: title } }] },
        });
        results.forEach((r, i) => {
          const rate = r.card.rate_pct == null ? '' : ` ${r.card.rate_pct}%`;
          const desc = `${r.tier}｜${r.card.card_name}${rate}${r.laser ? '｜✦镭射版' : ''}${r.card.video ? '｜动态' : ''}`;
          const content = [{ type: 'text', data: { text: desc } }];
          if (pics[i]) content.push(imgSeg(pics[i]));
          nodes.push({ type: 'node', data: { name: botName(session), uin: botUin(session), content } });
        });
      }
      const ok = config.resultImage !== 'always' && config.forwardMode !== 'off' && nodes.length && await sendForward(session, nodes);
      if (!ok && nodes.length) logger.warn('合并转发不可用（%s），退回普通发送', sendForward.lastError || 'unknown');

      // ★ 动态卡：单独发 mp4（OneBot 要求视频独占一条消息）
      if (config.sendVideos !== false) {
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (!r.card.video) continue;
          const vf = path.join(cardsDir, 'videos', r.hash + '.mp4');
          if (!fs.existsSync(vf) || fs.statSync(vf).size > 24 * 1024 * 1024) continue;
          try {
            await session.send(videoEl(vf));
          } catch (e) { logger.warn('发动态卡失败：%s', e.message); }
        }
      }
      if (!ok) {
        // ★ 优先渲染成一张结果图（官方群机器人等不支持合并转发的平台）
        let sentImage = false;
        if (config.resultImage !== 'off' && handbook) {
          try {
            const out = await handbook.renderResult({
              results,
              title,
              outDir: path.join(dataDir, 'out'),
              tagsDir,
              wallpaperDir: config.wallpaperDir
                ? config.wallpaperDir
                : path.join(__dirname, '..', 'assets', 'wallpapers'),
              badge: String(Math.round(Number(store.pu(uid).points || 0))),
              badgeSub: '当前积分',
              thumbsDir: path.join(assetsDir, 'thumbs'),
            });
            await session.send(fileEl(out, 'image/jpeg', config.imageMode));
            sentImage = true;
          } catch (e) {
            logger.warn('结果图渲染失败：%s', e.message);
          }
        }
        if (!sentImage) {
          const lines = results.map((r, i) => {
            const rate = r.card.rate_pct == null ? '' : ` ${r.card.rate_pct}%`;
            return `${i + 1}. ${r.tier}｜${r.card.card_name}${rate}${r.laser ? '｜✦镭射版' : ''}${r.card.video ? '｜动态' : ''}`;
          });
          await session.send(title + '\n' + lines.join('\n'));
          for (const f of pics) {
            if (!f) continue;
            try { await session.send(fileEl(f, null, config.imageMode)); } catch (e) { logger.warn('发卡图失败：%s', e.message); }
          }
        }
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

  ctx.command('卡池', '全部抽取范围（合并转发）').action(async ({ session }) => {
    const table = game.table();
    const names = game.poolNames();
    const sel = store.poolOf(sessKey(session)) || '全部卡池';
    const lines = [`🎴 抽取范围（当前：${sel}）`, '', `00. 全部卡池（${game.cards.length} 张）`, ''];
    for (const row of table) {
      if (row.type === 'series') lines.push(`${String(row.idx).padStart(2, '0')}. 【系列】${row.name}（${row.total} 张）`);
      else lines.push(`   ${String(row.idx).padStart(2, '0')}. ${row.name}（${row.total} 张）`);
    }
    lines.push('', '切换：/换池 序号（00 = 全部卡池）', '说明：/抽卡帮助');

    const uin = botUin(session);
    const nodes = [];
    const chunk = 18;
    for (let k = 0; k < lines.length; k += chunk) {
      nodes.push({ type: 'node', data: { name: botName(session), uin, content: [{ type: 'text', data: { text: lines.slice(k, k + chunk).join('\n') } }] } });
    }
    if (nodes.length < 2) {
      nodes.push({ type: 'node', data: { name: botName(session), uin, content: [{ type: 'text', data: { text: '切换：/换池 序号（00 = 全部卡池）' } }] } });
    }
    const ok = config.forwardMode !== 'off' && await sendForward(session, nodes);
    if (!ok) {
      if (config.forwardMode !== 'off') logger.warn('卡池合并转发失败（%s），改发文本', sendForward.lastError);
      return lines.join('\n');
    }
    return;
  });

  ctx.command('换池 <target:text>', '切换奖池').action(async ({ session }, target) => {
    const t = String(target || '').trim();
    if (!t) return '用法：/换池 <序号|名称>（先发 /卡池 看列表）';
    if (['00', '0', '全部', '全部卡池'].includes(t)) {
      store.setPool(sessKey(session), '全部卡池');
      return '✅ 已切换到「全部卡池」';
    }
    const table = game.table();
    const idx = Number(t);
    if (Number.isInteger(idx) && idx >= 1 && idx <= table.length) {
      const row = table[idx - 1];
      store.setPool(sessKey(session), row.name);
      return row.type === 'series'
        ? `✅ 已切换到系列「${row.name}」（${row.total} 张）`
        : `✅ 已切换到「${row.name}」（${row.total} 张）`;
    }
    const hit = table.find((r) => r.name === t) || table.find((r) => r.name.includes(t));
    if (!hit) return `没有找到「${t}」，发 /卡池 看列表`;
    store.setPool(sessKey(session), hit.name);
    return `✅ 已切换到${hit.type === 'series' ? '系列' : '池'}「${hit.name}」`;
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
    const f = game.holoFile(c)
      || (config.autoDownload !== false ? await game.ensureImage(c) : (fs.existsSync(game.cardFile(c)) ? game.cardFile(c) : null));
    if (!f) return `「${c.v.card_name}」的卡图下载失败（网络问题），稍后再试`;
    await session.send(fileEl(f, /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png', config.imageMode));
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
      const nodes = [{ type: 'node', data: { name: botName(session), uin: botUin(session), content: [{ type: 'text', data: { text: `${session.username || '你'} 的收藏集图鉴（${files.length} 张）` } }] } }];
      for (const f of files) nodes.push({ type: 'node', data: { name: botName(session), uin: botUin(session), content: [imgSeg(f)] } });
      const ok = config.forwardMode !== 'off' && await sendForward(session, nodes);
      if (!ok) for (const f of files) await session.send(fileEl(f, 'image/jpeg', config.imageMode));
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

  ctx.command('抽卡帮助', '抽卡玩法说明').action(async ({ session }) => {
    const uid = uidOf(session);
    const u = store.pu(uid);
    const sel = store.poolOf(sessKey(session)) || '全部卡池';
    return [
      '🎴 收藏集抽卡 · 使用说明',
      '',
      `你现在：${Math.round(Number(u.points || 0))} 积分 ｜ 当前范围：${sel}`,
      '',
      '【赚积分】',
      `  /签到            → 每天一次，+${config.signMin}~${config.signMax}`,
      `  /打工            → 挂机攒分（上限 ${config.workCap} / ${config.workHours} 小时）`,
      '                     攒满不会自动停，再发一次才结束',
      '  /打工状态        → 看挂机进度',
      `  /蹭饭            → ${config.eatCdMin} 分钟一次，+3~8`,
      `  /摸鱼            → ${config.moyuCdMin} 分钟一次，+1~4`,
      `  /每日红包        → 每天一次，+${config.bonusMin}~${config.bonusMax}`,
      '',
      '【抽卡】',
      `  /抽卡            → 抽 1 张（${config.pointsPerDraw} 分/抽）`,
      `  /抽卡 ${config.maxDrawOnce}         → 抽 ${config.maxDrawOnce} 张`,
      '  /卡池            → 全部抽取范围（合并消息）',
      `  /换池 00         → 全部卡池（${game.cards.length} 张）`,
      '  /换池 01         → 整个系列',
      '  /换池 12         → 单个奖池',
      '  /图鉴            → 我的图鉴长图（合并消息）',
      '  /获取卡 <卡名>   → 取出你已拥有的卡',
      '',
      '【规则】',
      '  · 收集进度全局共用；卡池选择每个群独立',
      '  · 指定奖池按官方概率；全部/系列先挑池，隐藏档再压权重',
      '  · 重复抽到会累加，图鉴显示 ×N',
      '  · 动态卡会额外发 mp4',
      '',
      '【档位】★★★★★大隐藏 / ★★★★小隐藏 / ★★★稀有 / ★★普通',
    ].join('\n');
  });
}

module.exports = { name, Config, apply, inject, reusable: false };
