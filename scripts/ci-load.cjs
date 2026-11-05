/** CI 用：真实 Koishi + mock 适配器，确认插件能加载并注册指令 */
const { Context } = require('koishi');
const mockMod = require('@koishijs/plugin-mock');
const plugin = require('../lib/index.js');

const app = new Context({ prefix: ['/'] });
app.plugin(mockMod.default ?? mockMod);
app.plugin(plugin, { cardsDir: './data/cards' });

app.start().then(() => {
  const n = app.$commander._commandList.length;
  console.log('指令数', n);
  process.exit(n > 10 ? 0 : 1);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
