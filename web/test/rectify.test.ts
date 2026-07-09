import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { GrayImage } from "../src/matcher/grayImage";
import { parseMapDatabase } from "../src/matcher/mapDatabase";
import { Matcher } from "../src/matcher/matcher";
import { detectWidgetQuad, rectifyQuad, solveHomography, type Quad } from "../src/camera/rectify";
import { matchSmart } from "../src/matchStrategy";
import { loadGrayImage } from "./pngHelper";

const goldenPath = fileURLToPath(new URL("./fixtures/golden.json", import.meta.url));

/** inner を暗背景キャンバスの quad 位置に透視変形して埋め込む（逆写像で密に描画）。 */
function embedPerspective(inner: GrayImage, quad: Quad, w: number, h: number): GrayImage {
  // solveHomography は inner矩形(x,y) → キャンバス(u,v) の係数を返すので、3x3 行列として逆行列を取り
  // キャンバス画素ごとに inner 座標を引く（範囲外は背景のまま）。
  const c = solveHomography(quad, inner.width, inner.height);
  const H = [
    [c[0]!, c[1]!, c[2]!],
    [c[3]!, c[4]!, c[5]!],
    [c[6]!, c[7]!, 1],
  ];
  const det =
    H[0]![0]! * (H[1]![1]! * H[2]![2]! - H[1]![2]! * H[2]![1]!) -
    H[0]![1]! * (H[1]![0]! * H[2]![2]! - H[1]![2]! * H[2]![0]!) +
    H[0]![2]! * (H[1]![0]! * H[2]![1]! - H[1]![1]! * H[2]![0]!);
  const inv = [
    [
      (H[1]![1]! * H[2]![2]! - H[1]![2]! * H[2]![1]!) / det,
      (H[0]![2]! * H[2]![1]! - H[0]![1]! * H[2]![2]!) / det,
      (H[0]![1]! * H[1]![2]! - H[0]![2]! * H[1]![1]!) / det,
    ],
    [
      (H[1]![2]! * H[2]![0]! - H[1]![0]! * H[2]![2]!) / det,
      (H[0]![0]! * H[2]![2]! - H[0]![2]! * H[2]![0]!) / det,
      (H[0]![2]! * H[1]![0]! - H[0]![0]! * H[1]![2]!) / det,
    ],
    [
      (H[1]![0]! * H[2]![1]! - H[1]![1]! * H[2]![0]!) / det,
      (H[0]![1]! * H[2]![0]! - H[0]![0]! * H[2]![1]!) / det,
      (H[0]![0]! * H[1]![1]! - H[0]![1]! * H[1]![0]!) / det,
    ],
  ];

  const px = new Float32Array(w * h).fill(0.1);
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const denom = inv[2]![0]! * u + inv[2]![1]! * v + inv[2]![2]!;
      const x = (inv[0]![0]! * u + inv[0]![1]! * v + inv[0]![2]!) / denom;
      const y = (inv[1]![0]! * u + inv[1]![1]! * v + inv[1]![2]!) / denom;
      if (x >= 0 && y >= 0 && x < inner.width - 1 && y < inner.height - 1) {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const iw = inner.width;
        px[v * w + u] =
          inner.pixels[y0 * iw + x0]! * (1 - fx) * (1 - fy) +
          inner.pixels[y0 * iw + x0 + 1]! * fx * (1 - fy) +
          inner.pixels[(y0 + 1) * iw + x0]! * (1 - fx) * fy +
          inner.pixels[(y0 + 1) * iw + x0 + 1]! * fx * fy;
      }
    }
  }
  return new GrayImage(w, h, px);
}

describe("solveHomography / rectifyQuad", () => {
  it("恒等に近い四角形では元画像がほぼそのまま得られる", () => {
    const src = loadGrayImage("pattern1.png");
    const quad: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: src.width, y: 0 },
      br: { x: src.width, y: src.height },
      bl: { x: 0, y: src.height },
    };
    const out = rectifyQuad(src, quad, src.width, src.height);
    let maxDiff = 0;
    for (let i = 0; i < out.pixels.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(out.pixels[i]! - src.pixels[i]!));
    }
    expect(maxDiff).toBeLessThan(0.02);
  });
});

describe("検出+補正+照合 (matchSmart)", () => {
  const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  const db = parseMapDatabase(golden.miniDb);
  const matcher = new Matcher(db);

  it("透視変形した明領域を検出し、補正して確定できる", () => {
    const query = loadGrayImage("query.png"); // 明るいパターン(平均~0.4)を持ち上げて「明るいウィジェット」を模す
    const bright = new GrayImage(
      query.width,
      query.height,
      Float32Array.from(query.pixels, (v) => 0.55 + v * 0.45),
    );
    const W = 480;
    const H = 420;
    // 右側が奥に倒れた台形（角度あり構図の模擬）
    const quad: Quad = {
      tl: { x: 40, y: 30 },
      tr: { x: 430, y: 70 },
      br: { x: 420, y: 350 },
      bl: { x: 30, y: 390 },
    };
    const scene = embedPerspective(bright, quad, W, H);

    const detected = detectWidgetQuad(scene);
    expect(detected).not.toBeNull();
    // 検出四隅が真の四隅から大きく外れないこと（縮小検出のため許容 6%）
    const tol = Math.max(W, H) * 0.06;
    expect(Math.hypot(detected!.tl.x - quad.tl.x, detected!.tl.y - quad.tl.y)).toBeLessThan(tol);
    expect(Math.hypot(detected!.br.x - quad.br.x, detected!.br.y - quad.br.y)).toBeLessThan(tol);

    const outcome = matchSmart(matcher, scene);
    expect(outcome.best?.entry.id).toBe(golden.match.expectedTop1);
    expect(outcome.isConfident).toBe(true);
  });

  it("明領域が見つからないフレームでは素通し結果を返す（例外を出さない）", () => {
    const dark = new GrayImage(160, 140, new Float32Array(160 * 140).fill(0.05));
    const outcome = matchSmart(matcher, dark);
    expect(outcome.isConfident).toBe(false);
  });
});
