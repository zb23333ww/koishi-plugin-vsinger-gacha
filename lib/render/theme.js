'use strict';
/** 设计令牌：浅色玻璃拟态（仿星轨手账） */
// ★ 字体族映射（打包在 assets/fonts/ 里）
const FAMILY = {
  current: 'VSingerSans',
  wenkai: 'VSingerWenKai',
  yozai: 'VSingerYozai',
  smiley: 'VSingerSmiley',
  chill: 'VSingerChill',
};
const FONT_FILES = {
  wenkai: 'wenkai.ttf',
  yozai: 'yozai.ttf',
  smiley: 'smiley.ttf',
  chill: 'chill.otf',
};
const FONT = process.env.VSG_FONT || 'VSingerYozai, VSingerSans, sans-serif';
const TITLE_FONT = process.env.VSG_TITLE_FONT || 'VSingerWenKai, VSingerSans, sans-serif';

const COLOR = {
  // 浅色系
  paper: '#ffffff',
  text: '#1f2a3a',
  textSub: '#5d6b80',
  textDim: '#8b98ab',
  accent: '#4a90d9',
  accentSoft: 'rgba(74,144,217,0.12)',
  panel: 'rgba(255,255,255,0.82)',
  panelBorder: 'rgba(120,160,210,0.28)',
  cardBg: '#f2f5fa',
  cardBorder: 'rgba(120,150,190,0.25)',
  shadow: 'rgba(60,90,130,0.18)',
  // 深色兜底（保留给旧主题）
  bg0: '#0d1524', bg1: '#16263f', bg2: '#111c33', glow: 'rgba(120,180,255,0.28)',
};

const TIER = {
  40: { name: '大隐藏', color: '#e0607a', tag: 'tag_40.webp' },
  30: { name: '小隐藏', color: '#e09a3c', tag: 'tag_30.webp' },
  20: { name: '稀有', color: '#4a90d9', tag: null },
  10: { name: '普通', color: '#8b98ab', tag: null },
};

const RADIUS = { sm: 10, md: 14, lg: 20, xl: 28 };
const SPACE = { xs: 8, sm: 12, md: 16, lg: 24, xl: 32 };
const FONT_SIZE = { h1: 30, h2: 24, h3: 18, body: 16, meta: 14, tiny: 12 };
const CARD = { w: 170, h: 243, label: 58, gap: 16 };

function tierOf(card) {
  const sc = Number((card && card.card_scarcity) || 10);
  return sc === 40 ? 40 : sc === 30 ? 30 : sc === 20 ? 20 : 10;
}

module.exports = { FONT, TITLE_FONT, FAMILY, FONT_FILES, COLOR, TIER, RADIUS, SPACE, FONT_SIZE, CARD, tierOf };

/** 运行时切换字体（配置项 titleFont / bodyFont 调用） */
function setFonts({ title, body } = {}) {
  const t = FAMILY[title] || FAMILY.wenkai;
  const b = FAMILY[body] || FAMILY.yozai;
  module.exports.TITLE_FONT = `${t}, VSingerSans, sans-serif`;
  module.exports.FONT = `${b}, VSingerSans, sans-serif`;
}
module.exports.setFonts = setFonts;
