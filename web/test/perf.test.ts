// 実 DB での照合レイテンシ計測。ライブ照合（目標 ~5fps = 200ms/フレーム予算）の
// 回帰検知用。環境差があるため上限は緩め（2s）に取り、実測値はログで確認する。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseMapDatabase } from "../src/matcher/mapDatabase";
import { Matcher } from "../src/matcher/matcher";
import { loadGrayImage } from "./pngHelper";

const mapsJsonPath = fileURLToPath(new URL("../../data/maps.json", import.meta.url));

describe("照合レイテンシ", () => {
  it("実DB(806件)での1照合がライブ照合に耐える速度で完了する", () => {
    const db = parseMapDatabase(JSON.parse(readFileSync(mapsJsonPath, "utf8")));
    const matcher = new Matcher(db);
    const query = loadGrayImage("query.png");

    matcher.match(query); // ウォームアップ(JIT)

    const runs = 5;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) matcher.match(query);
    const perMatch = (performance.now() - t0) / runs;

    console.log(`照合時間: ${perMatch.toFixed(1)} ms/回 (${runs}回平均)`);
    expect(perMatch).toBeLessThan(2000);
  });
});
