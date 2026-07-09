import { describe, expect, it } from "vitest";
import {
  buildLocalizedMapView,
  gradeDisplayName,
  locationText,
  matchDegreePct,
  zoneDisplayName,
} from "../src/mapView";
import type { FeatureSet, MapDatabase, MapEntry } from "../src/matcher/mapDatabase";

const dummyFeatures: FeatureSet[] = [
  { pHash: 0n, dHash: 0n, vec16: new Uint8Array(256), vecBp: new Uint8Array(256) },
];

function entry(id: string, zoneId: number | undefined, zone: string): MapEntry {
  return {
    id,
    grade: "G1",
    gradeName: "宝の地図G1",
    zone,
    ...(zoneId !== undefined ? { zoneId } : {}),
    x: 12.34,
    y: 5.6,
    variants: dummyFeatures,
  };
}

const db: MapDatabase = {
  version: 2,
  entries: [entry("a1", 10, "ゾーンA"), entry("b1", 20, "ゾーンB"), entry("c1", 30, "ゾーンC")],
  zoneNames: {
    "10": { ja: "ゾーンA", en: "Zone A" },
    "20": { ja: "ゾーンB", en: "Zone B" },
    "30": { ja: "ゾーンC" }, // en 地名なし
  },
  gradeNames: { G1: { ja: "宝の地図G1", en: "Treasure Map G1" } },
  unavailable: { en: ["b1"] },
};

describe("buildLocalizedMapView", () => {
  it("unavailable 指定と選択言語の地名なしエントリを除外する", () => {
    const view = buildLocalizedMapView(db, "en");
    expect(view.db.entries.map((e) => e.id)).toEqual(["a1"]);
    expect(view.ocrZoneNames).toEqual(["Zone A"]);
    expect(view.zoneKeyByName.get("Zone A")).toBe("10");
    expect(view.zoneNameByKey.get("10")).toBe("Zone A");
  });

  it("除外条件のない言語では全エントリが残る", () => {
    const view = buildLocalizedMapView(db, "ja");
    expect(view.db.entries.map((e) => e.id)).toEqual(["a1", "b1", "c1"]);
    expect(view.ocrZoneNames).toEqual(["ゾーンA", "ゾーンB", "ゾーンC"]);
  });

  it("多言語表を持たない旧DBでは何も除外しない", () => {
    const legacy: MapDatabase = { version: 2, entries: db.entries };
    const view = buildLocalizedMapView(legacy, "en");
    expect(view.db.entries.length).toBe(3);
    // zoneKey は ja 地名にフォールバックする
    expect(view.zoneKeyByName.get("ゾーンA")).toBe("10");
  });
});

describe("表示名とロケーション文字列", () => {
  it("選択言語の地名・地図名を返し、無ければ ja 相当にフォールバックする", () => {
    const e = db.entries[0]!;
    expect(zoneDisplayName(db, "en", e)).toBe("Zone A");
    expect(gradeDisplayName(db, "en", e)).toBe("Treasure Map G1");
    const legacy: MapDatabase = { version: 2, entries: db.entries };
    expect(zoneDisplayName(legacy, "en", e)).toBe("ゾーンA");
    expect(gradeDisplayName(legacy, "en", e)).toBe("宝の地図G1");
  });

  it("locationText はゲーム内 <pos> 形式（小数1桁）", () => {
    expect(locationText(db, "en", db.entries[0]!)).toBe("Zone A (X:12.3, Y:5.6)");
  });
});

describe("matchDegreePct", () => {
  it("NCC を 0..100 に丸め、負値は 0 に切り上げる", () => {
    expect(matchDegreePct(0.876)).toBe(88);
    expect(matchDegreePct(-0.5)).toBe(0);
    expect(matchDegreePct(1)).toBe(100);
  });
});
