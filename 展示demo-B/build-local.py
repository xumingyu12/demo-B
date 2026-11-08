"""岐黄智谱 · 路线 B：本地 RDKit 分子结构管线

输入：data.json 里的 SMILES（来自 PubChem，也可换成 TCMSP / HERB 的 SMILES）
输出：assets_local/*.svg（本地绘制）、local.json（含 3D SDF 与描述符）

与路线 A 的区别：
  A 是「拿别人的图和构象」；B 是「自己解析、标准化、画、生成构象」，可批量、可离线、可改样式。

用法：
  .venv\\Scripts\\python.exe build-local.py
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, Descriptors, Lipinski, rdMolDescriptors
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Chem.MolStandardize import rdMolStandardize

RDLogger.DisableLog("rdApp.*")

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets_local"
ASSETS.mkdir(exist_ok=True)

data = json.loads((ROOT / "data.json").read_text(encoding="utf-8"))
out: list[dict] = []
stats = {"n": 0, "parse_ok": 0, "embed_ok": 0, "total_ms": 0}

uncharger = rdMolStandardize.Uncharger()
lfc = rdMolStandardize.LargestFragmentChooser()


def standardize(mol: Chem.Mol) -> tuple[Chem.Mol, list[str]]:
    """去盐、取最大片段、中和电荷，并记录每一步改动了什么。"""
    notes: list[str] = []
    parent = lfc.choose(mol)
    if parent.GetNumAtoms() != mol.GetNumAtoms():
        notes.append(f"去盐/取最大片段（{mol.GetNumAtoms()} → {parent.GetNumAtoms()} 原子）")

    neutral = uncharger.uncharge(parent)
    if Chem.GetFormalCharge(parent) != 0 and Chem.GetFormalCharge(neutral) == 0:
        notes.append(f"电荷中和（{Chem.GetFormalCharge(parent):+d} → 0）")

    if not notes:
        notes.append("无需标准化")
    return neutral, notes


def draw_svg(mol: Chem.Mol, path: Path) -> None:
    """本地 2D 描绘：透明背景 + 加粗键线 + 立体标注，风格由我们控制。"""
    m = Chem.Mol(mol)
    AllChem.Compute2DCoords(m)
    d = rdMolDraw2D.MolDraw2DSVG(520, 400)
    o = d.drawOptions()
    o.bondLineWidth = 2.6
    o.padding = 0.07
    o.clearBackground = False          # 透明底，和页面背景融合
    o.addStereoAnnotation = True       # 手性中心标 R/S
    o.annotationFontScale = 0.8
    o.minFontSize = 14
    d.DrawMolecule(m)
    d.FinishDrawing()
    path.write_text(d.GetDrawingText(), encoding="utf-8")


def embed_3d(mol: Chem.Mol) -> tuple[str | None, float | None]:
    """ETKDGv3 生成构象 + MMFF94 优化；失败则退回随机坐标再试一次。"""
    mh = Chem.AddHs(mol)
    for attempt, use_random in enumerate((False, True)):
        params = AllChem.ETKDGv3()
        params.randomSeed = 42
        params.timeout = 25
        params.useRandomCoords = use_random
        if AllChem.EmbedMolecule(mh, params) == 0:
            try:
                AllChem.MMFFOptimizeMolecule(mh, maxIters=800)
                props = AllChem.MMFFGetMoleculeProperties(mh)
                energy = AllChem.MMFFGetMoleculeForceField(mh, props).CalcEnergy() if props else None
            except Exception:
                energy = None
            mh.SetProp("_Name", "local-conformer")
            return Chem.MolToMolBlock(mh), energy
    return None, None


for item in data.get("compounds", []):
    if not item.get("ok") or not item.get("smiles"):
        continue
    t0 = time.perf_counter()
    rec = {
        "id": item["id"], "cn": item["cn"], "en": item["en"], "herb": item["herb"],
        "cid": item.get("cid"), "smilesIn": item["smiles"],
        "aHas3d": item.get("sdfType") == "3d",
        "ok": False, "embed3d": False, "notes": [], "ms": 0,
    }
    stats["n"] += 1

    mol = Chem.MolFromSmiles(item["smiles"])
    t_parse = time.perf_counter()
    if mol is None:
        rec["error"] = "SMILES 解析失败"
        out.append(rec)
        continue
    stats["parse_ok"] += 1
    rec["msParse"] = int((t_parse - t0) * 1000)

    mol, notes = standardize(mol)
    t_std = time.perf_counter()
    rec["msStd"] = int((t_std - t_parse) * 1000)
    rec["notes"] = notes
    rec["smilesCanonical"] = Chem.MolToSmiles(mol, isomericSmiles=True)
    rec["formula"] = rdMolDescriptors.CalcMolFormula(mol)
    rec["inchiKey"] = Chem.MolToInchiKey(mol)

    # 描述符（路线 A 只有一部分，这里是自己算的）
    rec.update({
        "mw": round(Descriptors.MolWt(mol), 2),
        "logp": round(Descriptors.MolLogP(mol), 2),
        "hbd": Lipinski.NumHDonors(mol),
        "hba": Lipinski.NumHAcceptors(mol),
        "tpsa": round(Descriptors.TPSA(mol), 2),
        "rotb": Lipinski.NumRotatableBonds(mol),
        "rings": rdMolDescriptors.CalcNumRings(mol),
        "aromaticRings": rdMolDescriptors.CalcNumAromaticRings(mol),
        "heavy": mol.GetNumHeavyAtoms(),
        "fsp3": round(rdMolDescriptors.CalcFractionCSP3(mol), 3),
        "stereo": len(Chem.FindMolChiralCenters(mol, includeUnassigned=True, useLegacyImplementation=False)),
        "hbaLipinski": Lipinski.NumHAcceptors(mol),
    })
    # Lipinski 五规则违规项
    rec["violations"] = sum([
        rec["mw"] > 500, rec["logp"] > 5, rec["hbd"] > 5, rec["hba"] > 10,
    ])

    svg_path = ASSETS / f"{rec['id']}_2d.svg"
    draw_svg(mol, svg_path)
    t_draw = time.perf_counter()
    rec["msDraw"] = int((t_draw - t_std) * 1000)
    rec["svg"] = f"assets_local/{svg_path.name}"
    rec["svgKB"] = round(svg_path.stat().st_size / 1024, 1)

    sdf, energy = embed_3d(mol)
    rec["msEmbed"] = int((time.perf_counter() - t_draw) * 1000)
    if sdf:
        rec["sdf"] = sdf
        rec["embed3d"] = True
        rec["energy"] = round(energy, 2) if energy is not None else None
        stats["embed_ok"] += 1
        (ASSETS / f"{rec['id']}_3d.sdf").write_text(sdf, encoding="utf-8")

    rec["ok"] = True
    rec["ms"] = int((time.perf_counter() - t0) * 1000)
    stats["total_ms"] += rec["ms"]
    out.append(rec)
    print(f"{rec['id']} {rec['cn']:<8} 2D={rec['svgKB']}KB 3D={'Y' if rec['embed3d'] else 'N'} "
          f"{rec['ms']}ms  {rec['formula']}  MV={rec['violations']}")

payload = {
    "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    "engine": "RDKit " + Chem.rdBase.rdkitVersion,
    "stats": stats,
    "compounds": out,
}
(ROOT / "local.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
(ROOT / "local.js").write_text("window.QH_LOCAL = " + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")
print(f"\nRDKit {Chem.rdBase.rdkitVersion} | 解析 {stats['parse_ok']}/{stats['n']} | "
      f"3D {stats['embed_ok']}/{stats['n']} | 总耗时 {stats['total_ms']}ms")
