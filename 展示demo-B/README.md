# 岐黄智谱 · 分子结构层原型（路线 A / 路线 B）

「药 → 成分 → 分子结构」这一层的最小可演示版本。两条路线做同一件事，但数据来源和可控性完全不同：

| | 路线 A（`index.html`） | 路线 B（`route-b.html`） |
|---|---|---|
| 结构来源 | PubChem 公开接口 | 本地 RDKit 计算 |
| 2D 图 | PubChem 返回的 PNG | 本地绘制 SVG（透明底、可控样式） |
| 3D 构象 | PubChem 已有才给 | 本地 ETKDG + MMFF94 生成 |
| 3D 覆盖 | **13/16** | **16/16** |
| 网络 | 抓取时需要 | 全程不需要 |
| 批量 | 受接口速率限制 | 300 个约 1 分钟 |

**结论**：路线 A 适合两天内做出可视化；路线 B 才是能写进「技术路线」的主体，因为它把 PubChem 缺的那 3 个大分子补上了。

## 怎么打开

双击 `index.html` 或 `route-b.html` 即可，**断网也能用**。

- 左侧点选成分，`↑` `↓` 键切换；顶部按药味筛选、按名称/分子式/CID 搜索
- 中间 2D 结构，右侧 3D 可拖拽旋转（球棍/线框、自旋、重置）
- 路线 B 会显示五步管线：解析 → 标准化 → 2D 描绘 → 3D 嵌入 → 描述符，以及每步耗时
- 链接带 `#C006` 锚点，可直接分享到某个成分

## 目录

```
index.html        路线 A 页面（PubChem 数据）
route-b.html      路线 B 页面（本地 RDKit 生成）
styles.css        共用样式
route-b.css       路线 B 专属组件
app.js            路线 A 交互逻辑
route-b.js        路线 B 交互逻辑
data.js/data.json 路线 A 抓取结果（含 3D SDF，离线可用）
local.js/local.json 路线 B 生成结果（含 SVG 路径、3D SDF、描述符）
build-data.mjs    路线 A 抓取脚本
build-local.py    路线 B 本地管线（RDKit）
assets/           16 个成分的 2D 结构图（PubChem，已裁边去底）
assets_local/     16 个成分的 2D SVG + 3D SDF（本地生成）
vendor/           3Dmol-min.js（本地，断网可用）
tools/            重抓高清图、图片去底脚本
.venv/            本地 Python 环境（138MB，可删，重建见下）
shot.png          路线 A：黄芪甲苷（PubChem 无 3D 的缺口）
shot3d.png        路线 A：小檗碱 3D
shot-b.png        路线 B：黄芪甲苷（本地补齐 3D）
```

## 路线 A：PubChem 抓取

```bash
node build-data.mjs
```

改 `build-data.mjs` 里的 `SEED` 数组即可扩容——脚本自动解析 CID、下载 2D/3D、生成 `data.js`。

接口：

| 用途 | 接口 |
|---|---|
| 名称找 CID | `/rest/pug/compound/name/{name}/cids/JSON` |
| 属性 | `/rest/pug/compound/cid/{cid}/property/.../JSON` |
| 2D 图 | `/rest/pug/compound/cid/{cid}/PNG?record_type=2d` |
| 3D 构象 | `/rest/pug/compound/cid/{cid}/SDF?record_type=3d` |

## 路线 B：本地 RDKit 管线

环境重建（本机已建好，删了 `.venv` 才需要）：

```bash
python -m venv .venv
.venv\Scripts\pip install rdkit
```

生成：

```bash
.venv\Scripts\python.exe build-local.py
```

管线五步：

1. **解析 SMILES** — `Chem.MolFromSmiles`
2. **标准化** — 去盐/取最大片段、电荷中和（`rdMolStandardize`）
3. **2D 描绘** — `MolDraw2DSVG`，透明底、加粗键线、标注手性
4. **3D 嵌入** — `ETKDGv3` 生成构象 + `MMFF94` 优化，失败退回随机坐标
5. **描述符** — 分子量、LogP、TPSA、HBD/HBA、可旋转键、环数、Fsp3、立体中心、Lipinski 违规

16 个分子全流程约 **3.5 秒**，其中 3 个大分子（黄芪甲苷 843ms、人参皂苷 Rg1 1501ms）占了大部分时间。

## 四个可以写进申报书的点

1. **可回溯**：路线 A 每个分子都记录 `CID + 抓取日期 + 接口`；路线 B 记录 `输入 SMILES → 标准化 SMILES → 参数（种子 42、ETKDGv3、MMFF94）`，同一条 SMILES 能复现同一张图。
2. **数据缺口是真实的**：16 个成分里 3 个大分子 PubChem 没有 3D。这可以直接写成「数据质量评估」和「为什么需要本地管线」。
3. **本地管线补齐了缺口**：13/16 → 16/16，这是路线 B 最硬的一条证据。
4. **零伦理风险**：整条链路只碰公开数据与公开结构，不碰病历、不碰被试。

## 已知边界（别在答辩时被问倒）

- 这是**结构表征**，不是分子建模/靶点预测，更不是疗效证据；
- 3D 是**计算构象**，不是实验测定结构；大柔性分子（如黄芪甲苷）的构象看起来会比较卷曲，这是正常的采样结果；
- 16 个成分只是样本，不能代表任何方剂的完整成分谱；
- 成分名到 CID 的映射用的是英文名精确查，正式版要处理同义词、盐、立体化学、互变异构；
- Lipinski 规则只是类药性初筛，不是成药性结论。

## 30 秒演示脚本

> 打开 `route-b.html` → 点「黄芪甲苷」→ 指左侧对比卡「A 13/16，B 16/16」→ 拖动 3D 分子 → 看下方五步管线的耗时 → 点「川芎嗪」展示小分子的干净构象 → 切「仅 2D」看矢量结构图。
