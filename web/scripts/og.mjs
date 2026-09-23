// Renders public/og.png (1200×630) from the landing page's hero, for link previews (Open Graph, X cards).
//   npm run dev &   then   node scripts/og.mjs [--page http://127.0.0.1:5173/vigil/]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../video/package.json', import.meta.url));
const { chromium } = require('playwright');
const i = process.argv.indexOf('--page');
const PAGE = i >= 0 ? process.argv[i + 1] : 'http://127.0.0.1:5173/vigil/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(PAGE, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
// wait for the live numbers; if the RPC is down the card says so, which is still an honest preview
await page.waitForFunction(() => document.querySelector('.live-pill')?.getAttribute('data-status') === 'live', null, { timeout: 30_000 }).catch(() => {});
await page.screenshot({ path: fileURLToPath(new URL('../public/og.png', import.meta.url)) });
await browser.close();
console.log('wrote public/og.png');
