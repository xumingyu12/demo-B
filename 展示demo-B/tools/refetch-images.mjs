// 重新抓取更高分辨率的 2D 结构图（PubChem 上限 500x500），供页面放大显示。
// 用法：node tools/refetch-images.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(await fs.readFile(path.join(ROOT, 'data.json'), 'utf8'));
const UA = { 'User-Agent': 'qihuang-zhipu-demo/0.1 (academic prototype)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const c of data.compounds) {
  if (!c.ok) continue;
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${c.cid}/PNG?record_type=2d&image_size=500x500`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) { console.log(`FAIL ${c.id} ${r.status}`); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(path.join(ROOT, c.png2d), buf);
  console.log(`OK ${c.id} ${c.cn} ${Math.round(buf.length / 1024)}KB`);
  await sleep(220);
}
