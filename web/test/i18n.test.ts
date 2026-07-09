import { describe, expect, it } from "vitest";
import { APP_LANGS, MESSAGES, scriptOf, t, zoneKeyOf, type MsgKey } from "../src/i18n";

const KEYS = Object.keys(MESSAGES.ja) as MsgKey[];

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("MESSAGES", () => {
  it("全言語が同じキー集合を持つ", () => {
    for (const lang of APP_LANGS) {
      expect(Object.keys(MESSAGES[lang]).sort()).toEqual([...KEYS].sort());
    }
  });

  it("空文字の文言がない", () => {
    for (const lang of APP_LANGS) {
      for (const key of KEYS) {
        expect(MESSAGES[lang][key], `${lang}.${key}`).not.toBe("");
      }
    }
  });

  it("プレースホルダ集合がキーごとに全言語で一致する", () => {
    for (const key of KEYS) {
      const expected = placeholders(MESSAGES.ja[key]);
      for (const lang of APP_LANGS) {
        expect(placeholders(MESSAGES[lang][key]), `${lang}.${key}`).toEqual(expected);
      }
    }
  });
});

describe("t", () => {
  it("プレースホルダを置換する", () => {
    expect(t("ja", "confidence", { pct: 85 })).toBe("信頼度 85%");
    expect(t("en", "ocrZone", { zone: "Central Shroud" })).toBe("Zone: Central Shroud");
  });
});

describe("scriptOf", () => {
  it("en/de/fr は latin、それ以外は言語自身", () => {
    expect(scriptOf("en")).toBe("latin");
    expect(scriptOf("de")).toBe("latin");
    expect(scriptOf("fr")).toBe("latin");
    expect(scriptOf("ja")).toBe("ja");
    expect(scriptOf("ko")).toBe("ko");
    expect(scriptOf("zh")).toBe("zh");
  });
});

describe("zoneKeyOf", () => {
  it("zoneId があれば文字列化した ID、なければ地名を返す", () => {
    expect(zoneKeyOf({ zone: "黒衣森：中央森林", zoneId: 54 })).toBe("54");
    expect(zoneKeyOf({ zone: "黒衣森：中央森林" })).toBe("黒衣森：中央森林");
  });
});
