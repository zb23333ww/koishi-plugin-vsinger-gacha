/** 离线自测：不依赖适配器，直接调用 instruction action */
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('./lib/index.js');

function makeCtx(baseDir) {
  const cmds = new Map();
  const ctx = {
    baseDir,
    logger: () => ({ info: (...a) => console.log('  [log]', ...a), warn: (...a) => console.log('  [warn]', ...a), error: (...a) => console.log('  [err]', ...a) }),
    setInterval: () => {},
    on: () => {},
    command: (decl) => {
      const main = String(decl).split(/[\s[]/)[0];
      const obj = {
        _main: main, _aliases: [],
        alias(...a) { obj._aliases.push(...a); return obj; },
        description() { return obj; }, usage() { return obj; }, example() { return obj; },
        action(fn) { cmds.set(main, fn); for (const al of obj._aliases) cmds.set(al, fn); return obj; },
      };
      return obj;
    },
    $commander: null, root: { config: {} },
  };
  return { ctx, cmds };
}

function session(userId, opts = {}) {
  const sent = [];
  return {
    platform: opts.platform || 'onebot',
    userId, username: opts.username || '测试', guildId: opts.guildId || 'g1',
    event: { message: {}, user: { id: userId, authority: opts.authority || 1 } },
    sent,
    async send(content) { sent.push(content); return []; },
  };
}

(async () => {
  const base = '/root/koi-test';
  const { ctx, cmds } = makeCtx(base);
  plugin.apply(ctx, {
    cardsDir: '/root/qqbot/data/cards2',
    adminUsers: ['onebot:admin1'],
    pointsPerDraw: 10, maxDrawOnce: 10,
    signMin: 10, signMax: 30,
    workCap: 200, workHours: 12, eatCdMin: 30, moyuCdMin: 10, bonusMin: 5, bonusMax: 20,
    laserChance: 0.15,
  });
  console.log(' 注册指令:', [...cmds.keys()].join(' '));

  const call = async (name, s, ...args) => {
    const fn = cmds.get(name);
    if (!fn) throw new Error('没有指令 ' + name);
    const r = await fn({ session: s }, ...args);
    console.log(`\n▶ /${name} ${args.join(' ')}`);
    for (const m of s.sent) console.log('  ←', typeof m === 'string' ? m.slice(0, 160) : `[${m.type}]`);
    if (r) console.log('  ⇢', typeof r === 'string' ? r.slice(0, 200) : `[${r.type || 'el'}]`);
  };

  await call('签到', session('u1', { username: '小白' }));
  await call('签到', session('u1'));
  await call('抽卡', session('u1'), 3);
  await call('抽卡', session('u1'), 5);
  await call('卡池', session('u1'));
  await call('换池', session('u1'), '心律共鸣');
  await call('抽卡', session('u1'), 2);
  await call('查积分', session('u1'));

  await call('给卡', session('admin1', { authority: 5 }), 'onebot:u1', '神明一撇');
  await call('设积分', session('admin1', { authority: 5 }), 'onebot:u1', 500);
  await call('加积分', session('admin1', { authority: 5 }), 'onebot:u1', 50);
  await call('给卡', session('u1'), 'onebot:u9', '心跳闯关');
  await call('获取卡', session('u1'), '神明一撇');

  if (process.argv.includes('--nohb')) { console.log('\n  （跳过图鉴）'); return; }
  const t0 = Date.now();
  await call('图鉴', session('u1'));
  console.log('  图鉴耗时', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const outDir = path.join(base, 'data', 'vsinger-gacha', 'out');
  if (fs.existsSync(outDir)) {
    for (const f of fs.readdirSync(outDir)) {
      console.log('  输出', f, (fs.statSync(path.join(outDir, f)).size / 1024 / 1024).toFixed(1), 'MB');
    }
  }
  console.log('\n  完成');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
