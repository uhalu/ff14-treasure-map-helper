import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Matcher } from "../src/matcher/matcher";
import { parseMapDatabase, type RawMapDatabase } from "../src/matcher/mapDatabase";
import { loadGrayImage } from "./pngHelper";

// リポジトリ本体の照合DB（data/maps.json, 806件, コミット対象）を使った
// エンドツーエンドのスモークテスト。web/public/maps.json（ビルド時コピー生成物）は使わない。
const mapsJsonPath = path.resolve(__dirname, "../../data/maps.json");

describe("実DB (data/maps.json) を用いたスモークテスト", () => {
  it("806件のDBを例外なくロードし、Matcher構築とクエリ照合が完走する", () => {
    const raw: RawMapDatabase = JSON.parse(fs.readFileSync(mapsJsonPath, "utf8"));
    expect(raw.entries.length).toBe(806);

    const db = parseMapDatabase(raw);
    expect(db.entries.length).toBe(806);

    const matcher = new Matcher(db);
    const queryGray = loadGrayImage("query.png");

    const outcome = matcher.match(queryGray);
    expect(outcome.candidates.length).toBeGreaterThan(0);
    expect(outcome.best).toBeDefined();
    expect(Number.isFinite(outcome.confidence)).toBe(true);
  });
});
