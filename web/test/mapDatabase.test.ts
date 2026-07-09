import { describe, expect, it } from "vitest";
import { parseMapDatabase, type RawMapDatabase } from "../src/matcher/mapDatabase";

const RAW_FEATURE = {
  pHash: "00000000000000ff",
  dHash: "ff00000000000000",
  vec16: btoa(String.fromCharCode(...new Uint8Array(256))),
  vecBp: btoa(String.fromCharCode(...new Uint8Array(256))),
};

function rawEntry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    grade: "G1",
    gradeName: "古ぼけた地図G1",
    zone: "黒衣森：中央森林",
    x: 28.8,
    y: 22.7,
    variants: [RAW_FEATURE],
    ...extra,
  };
}

describe("parseMapDatabase の多言語フィールド", () => {
  it("多言語表を持たない旧形式をそのまま読める", () => {
    const raw = { version: 2, entries: [rawEntry("g1-00")] } as RawMapDatabase;
    const db = parseMapDatabase(raw);
    expect(db.entries[0]!.zoneId).toBeUndefined();
    expect(db.zoneNames).toBeUndefined();
    expect(db.gradeNames).toBeUndefined();
    expect(db.unavailable).toBeUndefined();
  });

  it("zoneId・zoneNames・gradeNames・unavailable を透過する", () => {
    const raw = {
      version: 2,
      entries: [rawEntry("g1-00", { zoneId: 54 })],
      zoneNames: { "54": { ja: "黒衣森：中央森林", en: "Central Shroud" } },
      gradeNames: { G1: { ja: "古ぼけた地図G1", en: "Timeworn Leather Map" } },
      unavailable: { zh: ["g1-00"] },
    } as RawMapDatabase;
    const db = parseMapDatabase(raw);
    expect(db.entries[0]!.zoneId).toBe(54);
    expect(db.zoneNames?.["54"]?.en).toBe("Central Shroud");
    expect(db.gradeNames?.G1?.en).toBe("Timeworn Leather Map");
    expect(db.unavailable?.zh).toEqual(["g1-00"]);
  });
});
