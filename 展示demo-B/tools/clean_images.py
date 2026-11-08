"""裁掉 PubChem 结构图的灰底并转透明，让结构式在页面里更饱满。
用法：python tools/clean_images.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ASSETS = Path(__file__).resolve().parent.parent / "assets"
PAD = 10
NEAR_WHITE = 240


def clean(path: Path) -> tuple[int, int, int, int]:
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    rgb = arr[:, :, :3]

    # 非背景像素的包围盒
    mask = ~np.all(rgb >= NEAR_WHITE, axis=2)
    if not mask.any():
        return im.size[0], im.size[1], 0, 0
    ys, xs = np.where(mask)
    x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + PAD, im.size[0] - 1)
    y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + PAD, im.size[1] - 1)

    arr = arr[y0:y1 + 1, x0:x1 + 1].copy()
    rgb = arr[:, :, :3]

    # 近白背景 -> 全透明（保留抗锯齿边缘）
    transparent = np.all(rgb >= NEAR_WHITE, axis=2)
    arr[:, :, 3] = np.where(transparent, 0, 255)

    out = Image.fromarray(arr, "RGBA")
    out.save(path, optimize=True)
    return out.size[0], out.size[1], x1 - x0 + 1, y1 - y0 + 1


if __name__ == "__main__":
    files = sorted(ASSETS.glob("*_2d.png"))
    for f in files:
        w, h, ow, oh = clean(f)
        print(f"{f.name}: {ow}x{oh} -> {w}x{h}")
    print(f"done {len(files)} files")
