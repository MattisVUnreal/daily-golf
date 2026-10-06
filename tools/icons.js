// Renders icon.svg to icon-192.png / icon-512.png. usage: node tools/icons.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'icon.svg'), 'utf8');
  const b = await chromium.launch();
  for (const size of [192, 512]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<style>body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
    await p.screenshot({ path: path.join(__dirname, '..', `icon-${size}.png`), omitBackground: true });
  }
  await b.close();
})();
