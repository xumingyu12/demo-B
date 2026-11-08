// 岐黄智谱 · 分子结构 demo —— 数据抓取脚本（路线 A）
// 用途：从 PubChem 公开接口批量抓取「药味 → 成分 → 分子结构」数据，
//      生成本地可离线打开的 data.js / 2D 图 / 3D 缩略图。
// 运行：node build-data.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.cwd();
const ASSETS = path.join(OUT, 'assets');
await fs.mkdir(ASSETS, { recursive: true });

const UA = { 'User-Agent': 'qihuang-zhipu-demo/0.1 (academic prototype)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}
async function getBuf(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// 药味 → 成分（示例样本，正式版应扩展到 300+）
const SEED = [
  { cn: '黄芪甲苷', en: 'Astragaloside IV', herb: '黄芪' },
  { cn: '毛蕊异黄酮', en: 'Calycosin', herb: '黄芪' },
  { cn: '丹酚酸B', en: 'Salvianolic acid B', herb: '丹参' },
  { cn: '丹参酮IIA', en: 'Tanshinone IIA', herb: '丹参' },
  { cn: '葛根素', en: 'Puerarin', herb: '葛根' },
  { cn: '小檗碱', en: 'Berberine', herb: '黄连' },
  { cn: '大黄素', en: 'Emodin', herb: '大黄' },
  { cn: '大黄酸', en: 'Rhein', herb: '大黄' },
  { cn: '阿魏酸', en: 'Ferulic acid', herb: '当归' },
  { cn: '川芎嗪', en: 'Tetramethylpyrazine', herb: '川芎' },
  { cn: '芍药苷', en: 'Paeoniflorin', herb: '白芍' },
  { cn: '马钱苷', en: 'Loganin', herb: '山茱萸' },
  { cn: '薯蓣皂苷元', en: 'Diosgenin', herb: '山药' },
  { cn: '柠檬酸', en: 'Citric acid', herb: '乌梅' },
  { cn: '人参皂苷Rg1', en: 'Ginsenoside Rg1', herb: '人参' },
  { cn: '梓醇', en: 'Catalpol', herb: '地黄' },
];

const PROPS = [
  'Title', 'IsomericSMILES', 'InChIKey', 'MolecularFormula', 'MolecularWeight',
  'ExactMass', 'XLogP', 'HBondDonorCount', 'HBondAcceptorCount', 'TPSA',
  'RotatableBondCount', 'HeavyAtomCount', 'Complexity', 'IUPACName',
].join(',');

const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';
const retrievedAt = new Date().toISOString().slice(0, 10);
const compounds = [];

for (let i = 0; i < SEED.length; i++) {
  const s = SEED[i];
  const id = 'C' + String(i + 1).padStart(3, '0');
  const rec = { id, cn: s.cn, en: s.en, herb: s.herb, cid: null, ok: false };
  try {
    const cidJson = await getJSON(`${BASE}/name/${encodeURIComponent(s.en)}/cids/JSON`);
    const cid = cidJson.IdentifierList?.CID?.[0];
    if (!cid) throw new Error('no CID');
    rec.cid = cid;
    await sleep(220);

    const pj = await getJSON(`${BASE}/cid/${cid}/property/${PROPS}/JSON`);
    const p = pj.PropertyTable?.Properties?.[0] || {};
    Object.assign(rec, {
      title: p.Title ?? null,
      smiles: p.IsomericSMILES ?? p.SMILES ?? null,
      inchiKey: p.InChIKey ?? null,
      formula: p.MolecularFormula ?? null,
      mw: p.MolecularWeight ?? null,
      exactMass: p.ExactMass ?? null,
      xlogp: p.XLogP ?? null,
      hbd: p.HBondDonorCount ?? null,
      hba: p.HBondAcceptorCount ?? null,
      tpsa: p.TPSA ?? null,
      rotb: p.RotatableBondCount ?? null,
      heavy: p.HeavyAtomCount ?? null,
      complexity: p.Complexity ?? null,
      iupac: p.IUPACName ?? null,
    });
    await sleep(220);

    // 2D / 3D 结构图
    rec.png2d = `assets/${id}_2d.png`;
    rec.png3d = `assets/${id}_3d.png`;
    await fs.writeFile(path.join(OUT, rec.png2d),
      await getBuf(`${BASE}/cid/${cid}/PNG?record_type=2d&image_size=320x320`));
    await sleep(220);
    try {
      await fs.writeFile(path.join(OUT, rec.png3d),
        await getBuf(`${BASE}/cid/${cid}/PNG?record_type=3d&image_size=320x320`));
    } catch { rec.png3d = null; }
    await sleep(220);

    // 3D 构象 SDF（没有 3D 记录就退回 2D）
    try {
      rec.sdf = await getText(`${BASE}/cid/${cid}/SDF?record_type=3d`);
      rec.sdfType = '3d';
    } catch {
      rec.sdf = await getText(`${BASE}/cid/${cid}/SDF?record_type=2d`);
      rec.sdfType = '2d';
    }
    rec.source = 'PubChem';
    rec.retrievedAt = retrievedAt;
    rec.ok = true;
  } catch (e) {
    rec.error = e.message;
  }
  compounds.push(rec);
  console.log(
    `${rec.ok ? 'OK ' : 'FAIL'} ${id} ${s.cn.padEnd(8, '　')} ${String(rec.cid ?? '-').padStart(8)} ` +
    `${rec.formula ?? ''} ${rec.error ?? ''}`
  );
  await sleep(220);
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'PubChem PUG REST',
  note: '结构由 PubChem 公开数据提供；3D 为计算构象，非实验测定结构。',
  compounds,
};
await fs.writeFile(path.join(OUT, 'data.json'), JSON.stringify(payload, null, 2), 'utf8');
await fs.writeFile(path.join(OUT, 'data.js'), 'window.QH_DATA = ' + JSON.stringify(payload) + ';\n', 'utf8');
console.log(`\nDONE ${compounds.filter((c) => c.ok).length}/${compounds.length} → data.js`);
