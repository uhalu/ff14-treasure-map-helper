import { describe, expect, it } from "vitest";

import { diceSimilarity, matchZoneName, normalizeOcrText } from "../src/ocr/zoneOcr";

describe("normalizeOcrText / diceSimilarity / matchZoneName", () => {
  it("空白・中黒・記号を除去する", () => {
    expect(normalizeOcrText("ドラ ヴァ ニア・雲海。")).toBe("ドラヴァニア雲海");
  });

  it("1文字の誤読があってもゾーンを特定できる", () => {
    const zones = ["ドラヴァニア雲海", "アバラシア雲海", "クルザス西部高地", "テンペスト"];
    expect(matchZoneName("ドラ ヴァ ニア 青海", zones)).toBe("ドラヴァニア雲海");
    expect(matchZoneName("クル ザス 西部 高地", zones)).toBe("クルザス西部高地");
  });

  it("無関係な文字列はどのゾーンにも一致しない", () => {
    const zones = ["ドラヴァニア雲海", "テンペスト"];
    expect(matchZoneName("ウタ クン 88 癌 攻守", zones)).toBeNull();
    expect(matchZoneName("", zones)).toBeNull();
  });

  it("類似ゾーン名では正しい方を選ぶ", () => {
    const zones = ["ドラヴァニア雲海", "アバラシア雲海"];
    expect(diceSimilarity("ドラヴァニア雲海", "アバラシア雲海")).toBeLessThan(1);
    expect(matchZoneName("アバラシア雲海", zones)).toBe("アバラシア雲海");
  });
});

describe("normalizeOcrText の文字体系別処理", () => {
  it("latin: 小文字化・ß→ss・ダイアクリティクス除去・英字以外の除去", () => {
    expect(normalizeOcrText("Forêt centrale!", "latin")).toBe("foretcentrale");
    expect(normalizeOcrText("Großstadt", "latin")).toBe("grossstadt");
    expect(normalizeOcrText("Östliches Thanalan 12", "latin")).toBe("ostlichesthanalan");
  });

  it("ko: ハングルのみ残す", () => {
    expect(normalizeOcrText("검은장막 숲 중부삼림 12!", "ko")).toBe("검은장막숲중부삼림");
  });

  it("zh: 漢字のみ残す", () => {
    expect(normalizeOcrText("黑衣森林 中央林区 12!", "zh")).toBe("黑衣森林中央林区");
  });
});

describe("matchZoneName の多言語一致", () => {
  it("latin: アクセント欠落・軽微な誤読があっても姉妹ゾーンを区別する", () => {
    const zones = ["Eastern Thanalan", "Western Thanalan", "Southern Thanalan"];
    expect(matchZoneName("Eastern Thanalan", zones, "latin")).toBe("Eastern Thanalan");
    expect(matchZoneName("Eastem Thanalan", zones, "latin")).toBe("Eastern Thanalan");
    const frZones = ["Forêt centrale", "Forêt de l'est", "Forêt du sud"];
    expect(matchZoneName("Foret centrale", frZones, "latin")).toBe("Forêt centrale");
  });

  it("ko: 姉妹ゾーンを区別する", () => {
    const zones = ["검은장막 숲 중부삼림", "검은장막 숲 동부삼림", "검은장막 숲 남부삼림"];
    expect(matchZoneName("검은장막 숲 중부삼림", zones, "ko")).toBe("검은장막 숲 중부삼림");
  });

  it("zh: 姉妹ゾーンを区別する", () => {
    const zones = ["黑衣森林中央林区", "黑衣森林东部林区", "黑衣森林南部林区"];
    expect(matchZoneName("黑衣森林 中央林区", zones, "zh")).toBe("黑衣森林中央林区");
  });

  it("CJK: 2文字ゾーン名を照合できる（얀샤・延夏・迷津）", () => {
    expect(matchZoneName("얀샤", ["얀샤", "홍옥해", "레이크랜드"], "ko")).toBe("얀샤");
    expect(matchZoneName("延夏", ["延夏", "红玉海", "迷津"], "zh")).toBe("延夏");
    expect(matchZoneName("迷津", ["延夏", "红玉海", "迷津"], "zh")).toBe("迷津");
  });

  it("zh: 短い地名の1文字誤読を吸収し、識別文字の誤読は曖昧として棄却する", () => {
    const zones = ["中萨纳兰", "南萨纳兰", "北萨纳兰", "西萨纳兰"];
    // 共通部分の誤読（萨→辽）: 先頭の識別文字が読めていれば特定できる
    expect(matchZoneName("中辽纳兰", zones, "zh")).toBe("中萨纳兰");
    // 識別文字の誤読: 姉妹ゾーンとの差が付かないので null（誤確定より安全側）
    expect(matchZoneName("東萨纳兰", zones, "zh")).toBeNull();
  });
});
