import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bytesToHex, fitWithin, isImageMime, matchScreenshot } from "../src/desktopMatch";
import { Matcher } from "../src/matcher/matcher";
import { parseMapDatabase, type RawMapDatabase } from "../src/matcher/mapDatabase";
import { loadGrayImage } from "./pngHelper";

const fixturesDir = path.resolve(__dirname, "fixtures");
const golden = JSON.parse(fs.readFileSync(path.join(fixturesDir, "golden.json"), "utf8")) as {
  match: { queryFile: string; expectedTop1: string };
  miniDb: RawMapDatabase;
};

describe("matchScreenshot", () => {
  it("フィクスチャのクエリ画像が期待エントリに確定する", () => {
    const matcher = new Matcher(parseMapDatabase(golden.miniDb));
    const gray = loadGrayImage(golden.match.queryFile);
    const { outcome, ocrImage } = matchScreenshot(matcher, gray);
    expect(outcome.best?.entry.id).toBe(golden.match.expectedTop1);
    expect(outcome.isConfident).toBe(true);
    // OCR 用画像は常に非 null（検出失敗時は入力がそのまま返る）
    expect(ocrImage.width).toBeGreaterThan(0);
  });

  it("zoneKey フィルタで母集団を絞れる（存在しないゾーンは明確なエラー）", () => {
    const matcher = new Matcher(parseMapDatabase(golden.miniDb));
    const gray = loadGrayImage(golden.match.queryFile);
    expect(() => matchScreenshot(matcher, gray, "no-such-zone")).toThrowError(
      /フィルタに一致するエントリ/,
    );
  });
});

describe("isImageMime", () => {
  it("image/* のみ真", () => {
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("image/jpeg")).toBe(true);
    expect(isImageMime("text/plain")).toBe(false);
    expect(isImageMime("text/html")).toBe(false);
  });
});

describe("fitWithin", () => {
  it("maxWidth 以下ならそのまま", () => {
    expect(fitWithin(800, 600, 1200)).toEqual({ width: 800, height: 600 });
  });
  it("超過時はアスペクト比を保って縮小する", () => {
    expect(fitWithin(2400, 1200, 1200)).toEqual({ width: 1200, height: 600 });
    expect(fitWithin(3840, 2160, 1200)).toEqual({ width: 1200, height: 675 });
  });
  it("高さは最低1px", () => {
    expect(fitWithin(10000, 1, 1200).height).toBe(1);
  });
});

describe("bytesToHex", () => {
  it("バイト列を16進表現にする", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 255, 16]))).toBe("0001ff10");
    expect(bytesToHex(new Uint8Array([]).buffer)).toBe("");
  });
});
