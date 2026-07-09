import { describe, expect, it } from "vitest";
import {
  computeCoverSourceRect,
  computeGuideRect,
  GUIDE_ASPECT,
} from "../src/camera/objectFitCover";

describe("computeGuideRect", () => {
  it("縦長コンテナでは幅の85%を基準に中央配置する", () => {
    const rect = computeGuideRect({ width: 400, height: 800 });
    expect(rect.width).toBeCloseTo(400 * 0.85, 6);
    expect(rect.height).toBeCloseTo(rect.width / GUIDE_ASPECT, 6);
    expect(rect.x).toBeCloseTo((400 - rect.width) / 2, 6);
    expect(rect.y).toBeCloseTo((800 - rect.height) / 2, 6);
  });

  it("横長（低い）コンテナでは高さ基準に縮小し、はみ出さない", () => {
    const container = { width: 800, height: 300 };
    const rect = computeGuideRect(container);
    expect(rect.height).toBeLessThanOrEqual(container.height * 0.85 + 1e-9);
    expect(rect.width).toBeCloseTo(rect.height * GUIDE_ASPECT, 6);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(container.width + 1e-9);
    expect(rect.y + rect.height).toBeLessThanOrEqual(container.height + 1e-9);
  });

  it("非正のサイズは拒否する", () => {
    expect(() => computeGuideRect({ width: 0, height: 100 })).toThrow();
    expect(() => computeGuideRect({ width: 100, height: -1 })).toThrow();
  });
});

describe("computeCoverSourceRect", () => {
  it("video とコンテナが同じアスペクト比なら全面ガイド枠がそのまま比例縮小される", () => {
    const video = { width: 1000, height: 1000 };
    const container = { width: 500, height: 500 };
    const guide = { x: 50, y: 50, width: 400, height: 400 };
    const source = computeCoverSourceRect(video, container, guide);
    // scale = 500/1000 = 0.5 なので video 座標は container 座標の 2 倍
    expect(source.x).toBe(100);
    expect(source.y).toBe(100);
    expect(source.width).toBe(800);
    expect(source.height).toBe(800);
  });

  it("横長 video を縦長コンテナに cover 表示する場合、左右がクロップされた分を補正する", () => {
    // video 1920x1080 (16:9) を container 375x667 (縦長) に cover 表示すると、
    // scale = max(375/1920, 667/1080) = max(0.1953, 0.6176) = 0.6176 (高さ基準)
    // renderedWidth = 1920*0.6176 ≈ 1185.8 → container 幅 375 を大きくはみ出し、左右がクロップされる。
    const video = { width: 1920, height: 1080 };
    const container = { width: 375, height: 667 };
    const guide = computeGuideRect(container);
    const source = computeCoverSourceRect(video, container, guide);

    // ソース矩形は video の範囲内に収まっていること
    expect(source.x).toBeGreaterThanOrEqual(0);
    expect(source.y).toBeGreaterThanOrEqual(0);
    expect(source.x + source.width).toBeLessThanOrEqual(video.width);
    expect(source.y + source.height).toBeLessThanOrEqual(video.height);

    // ガイド枠がコンテナ中央にあるので、ソース矩形も video 中央付近にあるはず
    const centerX = source.x + source.width / 2;
    const centerY = source.y + source.height / 2;
    expect(Math.abs(centerX - video.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(centerY - video.height / 2)).toBeLessThanOrEqual(1);

    // アスペクト比がおおよそ保たれている（整数丸めのため誤差を許容）
    expect(source.width / source.height).toBeCloseTo(guide.width / guide.height, 1);
  });

  it("非正のサイズは拒否する", () => {
    const guide = { x: 0, y: 0, width: 10, height: 10 };
    expect(() => computeCoverSourceRect({ width: 0, height: 10 }, { width: 10, height: 10 }, guide)).toThrow();
    expect(() => computeCoverSourceRect({ width: 10, height: 10 }, { width: 0, height: 10 }, guide)).toThrow();
  });
});
