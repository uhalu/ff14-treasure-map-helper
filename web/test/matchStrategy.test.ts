// 実機検証で見つかった「ガイド枠と地図の間の余白＋発光ハローで信頼度が崩れる」ケースの回帰テスト。
// ゴールデンのミニDBを使い、パターン画像を暗い背景＋明るい縁取りの中に約80%サイズで埋めた
// 「緩い構図」の入力でも、クロップフォールバックで確定できることを検証する。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { GrayImage } from "../src/matcher/grayImage";
import { parseMapDatabase } from "../src/matcher/mapDatabase";
import { Matcher } from "../src/matcher/matcher";
import { matchWithCropFallback } from "../src/matchStrategy";
import { loadGrayImage } from "./pngHelper";

const goldenPath = fileURLToPath(new URL("./fixtures/golden.json", import.meta.url));

function embedLoose(inner: GrayImage, scale: number): GrayImage {
  // 暗背景キャンバス中央に inner を scale 倍で配置し、周囲に明るいハロー(1px相当の帯)を付ける
  const w = Math.round(inner.width / scale);
  const h = Math.round(inner.height / scale);
  const px = new Float32Array(w * h).fill(0.12); // 暗い背景
  const ox = Math.floor((w - inner.width) / 2);
  const oy = Math.floor((h - inner.height) / 2);
  // ハロー（配置領域の外周を明るく）
  const halo = 6;
  for (let y = oy - halo; y < oy + inner.height + halo; y++) {
    for (let x = ox - halo; x < ox + inner.width + halo; x++) {
      if (y < 0 || x < 0 || y >= h || x >= w) continue;
      const insideMap =
        y >= oy && y < oy + inner.height && x >= ox && x < ox + inner.width;
      if (!insideMap) px[y * w + x] = 0.9;
    }
  }
  for (let y = 0; y < inner.height; y++) {
    for (let x = 0; x < inner.width; x++) {
      px[(y + oy) * w + (x + ox)] = inner.pixels[y * inner.width + x]!;
    }
  }
  return new GrayImage(w, h, px);
}

describe("matchWithCropFallback", () => {
  const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  const db = parseMapDatabase(golden.miniDb);
  const matcher = new Matcher(db);

  it("余白+ハロー付きの緩い構図でもクロップフォールバックで確定できる", () => {
    const query = loadGrayImage("query.png"); // 正解: golden.match.expectedTop1
    const loose = embedLoose(query, 0.8);

    const outcome = matchWithCropFallback(matcher, loose);

    expect(outcome.best?.entry.id).toBe(golden.match.expectedTop1);
    expect(outcome.isConfident).toBe(true);
  });

  it("元々きれいな入力では1回目で確定しフォールバック不要", () => {
    const query = loadGrayImage("query.png");
    const outcome = matchWithCropFallback(matcher, query);
    expect(outcome.best?.entry.id).toBe(golden.match.expectedTop1);
    expect(outcome.isConfident).toBe(true);
  });
});
