import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage();
await p.route('http://localhost:8090/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.KT_PEER_OPTS={host:'127.0.0.1',port:9000,path:'/',secure:false};" }));
await p.goto('http://localhost:8090/?t=q');
console.log(await p.evaluate(() => { try { const q = qrcode(0, 'M'); q.addData('https://example.netlify.app/?t=main&k=abcdefghij&m=hand'); q.make(); const s = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }); return typeof qrcode + ' ' + s.slice(0, 80); } catch (e) { return 'ERR ' + e.message; } }));
await b.close();
