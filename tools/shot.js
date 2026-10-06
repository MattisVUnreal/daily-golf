// usage: node tools/shot.js from to out.png [mirror]
const { chromium } = require('playwright');
(async () => {
  const [from, to, out, mir] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1030, height: 640 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + __dirname + `/preview.html?from=${from}&to=${to}${mir ? '&mirror' : ''}`);
  await p.waitForTimeout(300);
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
})();
