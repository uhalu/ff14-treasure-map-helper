import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extract, hammingDistance } from "../src/matcher/featureExtractor";
import { Matcher } from "../src/matcher/matcher";
import { parseMapDatabase, type RawMapDatabase } from "../src/matcher/mapDatabase";
import { loadGrayImage } from "./pngHelper";

interface GoldenFeature {
  file: string;
  pHash: string;
  dHash: string;
  vec16: string; // base64
  vecBp: string; // base64
}

interface GoldenJson {
  features: GoldenFeature[];
  match: {
    queryFile: string;
    expectedTop1: string;
    ncc: number;
    confidence: number;
  };
  miniDb: RawMapDatabase;
}

const fixturesDir = path.resolve(__dirname, "fixtures");
const golden: GoldenJson = JSON.parse(fs.readFileSync(path.join(fixturesDir, "golden.json"), "utf8"));

function maxAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > max) max = d;
  }
  return max;
}

describe("DB 生成側実装との整合（ゴールデンデータ）", () => {
  for (const feature of golden.features) {
    it(`${feature.file}: pHash/dHash/vec16/vecBp が DB 生成側と一致（誤差許容内）`, () => {
      const gray = loadGrayImage(feature.file);
      const extracted = extract(gray);

      const expectedPHash = BigInt(`0x${feature.pHash}`);
      const expectedDHash = BigInt(`0x${feature.dHash}`);
      const pHashDist = hammingDistance(extracted.pHash, expectedPHash);
      const dHashDist = hammingDistance(extracted.dHash, expectedDHash);
      expect(pHashDist, `pHash Hamming距離 (${feature.file})`).toBeLessThanOrEqual(2);
      expect(dHashDist, `dHash Hamming距離 (${feature.file})`).toBeLessThanOrEqual(2);

      const expectedVec16 = Buffer.from(feature.vec16, "base64");
      const expectedVecBp = Buffer.from(feature.vecBp, "base64");
      const vec16Diff = maxAbsDiff(extracted.vec16, expectedVec16);
      const vecBpDiff = maxAbsDiff(extracted.vecBp, expectedVecBp);
      expect(vec16Diff, `vec16 最大絶対差 (${feature.file})`).toBeLessThanOrEqual(2);
      expect(vecBpDiff, `vecBp 最大絶対差 (${feature.file})`).toBeLessThanOrEqual(2);
    });
  }

  it("miniDb を用いた照合が golden の期待値と一致する", () => {
    const db = parseMapDatabase(golden.miniDb);
    const matcher = new Matcher(db);
    const queryGray = loadGrayImage(golden.match.queryFile);

    const outcome = matcher.match(queryGray);
    const best = outcome.best;
    expect(best, "照合結果が空ではないこと").toBeDefined();
    expect(best!.entry.id).toBe(golden.match.expectedTop1);
    expect(best!.ncc).toBeGreaterThanOrEqual(golden.match.ncc - 0.02);
    expect(best!.ncc).toBeLessThanOrEqual(golden.match.ncc + 0.02);
    expect(outcome.isConfident).toBe(true);
  });
});
