import { describe, expect, it } from "vitest";
import { GrayImage } from "../src/matcher/grayImage";
import { roundHalfEven } from "../src/matcher/mathUtil";

describe("GrayImage.resizeArea（面積平均ボックスフィルタ）の決定的性質", () => {
  it("2x2 -> 1x1 は 4 画素の単純平均になる", () => {
    const img = new GrayImage(2, 2, new Float32Array([0.0, 0.2, 0.4, 1.0]));
    const resized = img.resizeArea(1, 1);
    expect(resized.width).toBe(1);
    expect(resized.height).toBe(1);
    // Float32Array 経由のため、期待値の比較は float32 精度（1e-6 程度）に合わせる
    expect(resized.pixels[0]).toBeCloseTo((0.0 + 0.2 + 0.4 + 1.0) / 4, 6);
  });

  it("4x4 -> 2x2 は各 2x2 ブロックの平均になる", () => {
    // 行優先: 各行 [0,1,2,3] [4,5,6,7] [8,9,10,11] [12,13,14,15]
    const px = new Float32Array(16);
    for (let i = 0; i < 16; i++) px[i] = i;
    const img = new GrayImage(4, 4, px);
    const resized = img.resizeArea(2, 2);
    // 左上ブロック: 0,1,4,5 の平均 = 2.5
    expect(resized.pixels[0]).toBeCloseTo(2.5, 10);
    // 右上ブロック: 2,3,6,7 の平均 = 4.5
    expect(resized.pixels[1]).toBeCloseTo(4.5, 10);
    // 左下ブロック: 8,9,12,13 の平均 = 10.5
    expect(resized.pixels[2]).toBeCloseTo(10.5, 10);
    // 右下ブロック: 10,11,14,15 の平均 = 12.5
    expect(resized.pixels[3]).toBeCloseTo(12.5, 10);
  });

  it("非整数比の縮小でも DB 生成側の整数除算境界と一致する（幅5→3）", () => {
    // 窓境界: x0 = tx*5/3 (整数除算), x1 = max(x0+1, (tx+1)*5/3)
    // tx=0: x0=0, x1=max(1, 5/3=1)=1 -> [0,1)
    // tx=1: x0=5/3=1, x1=max(2, 10/3=3)=3 -> [1,3)
    // tx=2: x0=10/3=3, x1=max(4, 15/3=5)=5 -> [3,5)
    const px = new Float32Array([1, 2, 3, 4, 5]);
    const img = new GrayImage(5, 1, px);
    const resized = img.resizeArea(3, 1);
    expect(resized.pixels[0]).toBeCloseTo(1, 10); // [0,1) -> 1
    expect(resized.pixels[1]).toBeCloseTo((2 + 3) / 2, 10); // [1,3) -> (2+3)/2
    expect(resized.pixels[2]).toBeCloseTo((4 + 5) / 2, 10); // [3,5) -> (4+5)/2
  });
});

describe("roundHalfEven（銀行丸め）", () => {
  it("ちょうど .5 は偶数側に丸める", () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(-0.5)).toBe(0);
    expect(roundHalfEven(-1.5)).toBe(-2);
  });

  it("それ以外は通常の四捨五入と同じ", () => {
    expect(roundHalfEven(1.2)).toBe(1);
    expect(roundHalfEven(1.8)).toBe(2);
    expect(roundHalfEven(-1.2)).toBe(-1);
    expect(roundHalfEven(-1.8)).toBe(-2);
  });
});

describe("GrayImage.cropRelative / cropCenter", () => {
  it("cropCenter(0) は自身を返す", () => {
    const img = new GrayImage(4, 4, new Float32Array(16).fill(0.5));
    expect(img.cropCenter(0)).toBe(img);
  });

  it("cropRelative は指定範囲を正しく切り出す", () => {
    const px = new Float32Array(16);
    for (let i = 0; i < 16; i++) px[i] = i;
    const img = new GrayImage(4, 4, px);
    const cropped = img.cropRelative(0.5, 0.5, 0.5, 0.5);
    expect(cropped.width).toBe(2);
    expect(cropped.height).toBe(2);
    expect(Array.from(cropped.pixels)).toEqual([10, 11, 14, 15]);
  });

  it("画像外への切り出しは例外を投げる", () => {
    const img = new GrayImage(4, 4, new Float32Array(16).fill(0));
    expect(() => img.cropRelative(0.9, 0, 0.5, 0.5)).toThrow();
  });
});
