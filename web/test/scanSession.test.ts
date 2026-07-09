import { describe, expect, it } from "vitest";
import {
  CONFIRM_HITS,
  LOW_CONFIDENCE_TIMEOUT_MS,
  OBSERVATION_WINDOW,
  OCR_STABLE_TICKS,
  ScanSession,
} from "../src/camera/scanSession";
import { MatchOutcome, type MatchResult } from "../src/matcher/matcher";
import type { MapEntry } from "../src/matcher/mapDatabase";

function fakeEntry(id: string): MapEntry {
  return { id, grade: "G1", gradeName: "隠された貴重品", zone: `ゾーン-${id}`, x: 10, y: 20, variants: [] };
}

function confidentOutcome(id: string, ncc = 0.8): MatchOutcome {
  const candidates: MatchResult[] = [
    { entry: fakeEntry(id), ncc, hamming: 0 },
    { entry: fakeEntry("other"), ncc: ncc - 0.3, hamming: 10 },
  ];
  // MatchOutcome.isConfident は confidence >= 0.6 で判定されるため、閾値を超える値を渡す。
  return new MatchOutcome(candidates, 0.9);
}

function unsureOutcome(id = "unsure-top"): MatchOutcome {
  const candidates: MatchResult[] = [
    { entry: fakeEntry(id), ncc: 0.5, hamming: 5 },
    { entry: fakeEntry("cand2"), ncc: 0.48, hamming: 6 },
    { entry: fakeEntry("cand3"), ncc: 0.47, hamming: 7 },
  ];
  return new MatchOutcome(candidates, 0.3);
}

describe("ScanSession", () => {
  it(`同一エントリの確信が${CONFIRM_HITS}回あれば confirmed を返す`, () => {
    const session = new ScanSession();
    const first = session.observe(confidentOutcome("spot-a"), 0);
    expect(first.confirmed).toBeNull();

    const second = session.observe(confidentOutcome("spot-a"), 200);
    expect(second.confirmed).not.toBeNull();
    expect(second.confirmed!.entry.id).toBe("spot-a");
  });

  it("別エントリ(別ゾーン)へ切り替わった直後は保留し、旧ゾーンが直近3観測から抜けたら確定する", () => {
    const session = new ScanSession();
    session.observe(confidentOutcome("spot-a"), 0);
    const switched = session.observe(confidentOutcome("spot-b"), 200);
    expect(switched.confirmed).toBeNull();
    // spot-a の確信がまだ直近3観測内 → 保留
    const stillBlocked = session.observe(confidentOutcome("spot-b"), 400);
    expect(stillBlocked.confirmed).toBeNull();
    // spot-a が直近3観測から抜けた → 確定
    const confirmed = session.observe(confidentOutcome("spot-b"), 600);
    expect(confirmed.confirmed!.entry.id).toBe("spot-b");
    expect(confirmed.via).toBe("score");
  });

  it("非確定フレームを挟んでも窓内に2ヒットあれば確定する（モアレ明滅対策）", () => {
    const session = new ScanSession();
    session.observe(confidentOutcome("spot-a"), 0);
    session.observe(unsureOutcome(), 200);
    const result = session.observe(confidentOutcome("spot-a"), 400);
    expect(result.confirmed).not.toBeNull();
    expect(result.confirmed!.entry.id).toBe("spot-a");
  });

  it(`窓(${OBSERVATION_WINDOW}観測)から溢れた古いヒットは確定に数えない`, () => {
    const session = new ScanSession();
    session.observe(confidentOutcome("spot-a"), 0);
    for (let i = 1; i <= OBSERVATION_WINDOW; i++) {
      session.observe(unsureOutcome(), i * 200);
    }
    const result = session.observe(confidentOutcome("spot-a"), 2000);
    expect(result.confirmed).toBeNull(); // 最初のヒットは窓外
  });

  it(`非確定が${LOW_CONFIDENCE_TIMEOUT_MS}ms未満はshowCandidatesがfalse`, () => {
    const session = new ScanSession();
    const t0 = session.observe(unsureOutcome(), 0);
    expect(t0.showCandidates).toBe(false);
    const before = session.observe(unsureOutcome(), LOW_CONFIDENCE_TIMEOUT_MS - 1);
    expect(before.showCandidates).toBe(false);
  });

  it(`非確定が${LOW_CONFIDENCE_TIMEOUT_MS}ms以上続くとshowCandidatesがtrueになる`, () => {
    const session = new ScanSession();
    session.observe(unsureOutcome(), 0);
    const after = session.observe(unsureOutcome(), LOW_CONFIDENCE_TIMEOUT_MS);
    expect(after.showCandidates).toBe(true);
    expect(after.confirmed).toBeNull();
  });

  it("低信頼の途中で確定候補が現れるとタイマーがリセットされる", () => {
    const session = new ScanSession();
    session.observe(unsureOutcome(), 0);
    session.observe(confidentOutcome("spot-a"), 3000); // ヒット1、タイマーリセット
    const stillLow = session.observe(unsureOutcome(), 3000 + LOW_CONFIDENCE_TIMEOUT_MS - 1);
    expect(stillLow.showCandidates).toBe(false);
  });

  it("reset() でストリークとタイマーが初期化される", () => {
    const session = new ScanSession();
    session.observe(confidentOutcome("spot-a"), 0);
    session.reset();
    const result = session.observe(confidentOutcome("spot-a"), 100);
    expect(result.confirmed).toBeNull(); // リセット後は1回目扱いなので未確定
  });

  it("OCRゾーン一致中はトップ1が連続すれば低信頼でも確定する(ocrStable)", () => {
    const session = new ScanSession();
    const zone = "ゾーン-spot-a";
    let update = session.observe(unsureOutcome("spot-a"), 0, zone);
    for (let i = 1; i < OCR_STABLE_TICKS; i++) {
      update = session.observe(unsureOutcome("spot-a"), i * 200, zone);
    }
    expect(update.confirmed?.entry.id).toBe("spot-a");
    expect(update.via).toBe("ocrStable");
  });

  it("OCRゾーンとトップ1のゾーンが違う場合はocrStable確定しない", () => {
    const session = new ScanSession();
    let update = session.observe(unsureOutcome("spot-a"), 0, "別のゾーン");
    for (let i = 1; i <= OCR_STABLE_TICKS + 1; i++) {
      update = session.observe(unsureOutcome("spot-a"), i * 200, "別のゾーン");
    }
    expect(update.confirmed).toBeNull();
  });

  it("トップ1が揺れている間はocrStable確定しない", () => {
    const session = new ScanSession();
    const zone = "ゾーン-spot-a";
    session.observe(unsureOutcome("spot-a"), 0, zone);
    session.observe(unsureOutcome("spot-b"), 200, zone);
    session.observe(unsureOutcome("spot-a"), 400, zone);
    const update = session.observe(unsureOutcome("spot-a"), 600, zone);
    expect(update.confirmed).toBeNull(); // 連続4に満たない
  });

  it("別ゾーンの確信ヒットが3観測より前なら確定をブロックしない", () => {
    const session = new ScanSession();
    session.observe(confidentOutcome("spot-b"), 0);   // 別ゾーンの確信(古い)
    session.observe(confidentOutcome("spot-a"), 200);
    session.observe(unsureOutcome(), 400);
    session.observe(unsureOutcome(), 600);
    const update = session.observe(confidentOutcome("spot-a"), 800);
    expect(update.confirmed?.entry.id).toBe("spot-a");
    expect(update.via).toBe("score");
  });

  it("requireOcr=trueではOCRゾーン無しの高スコアでも確定しない", () => {
    const session = new ScanSession();
    session.observe(confidentOutcome("spot-a"), 0, null, true);
    const update = session.observe(confidentOutcome("spot-a"), 200, null, true);
    expect(update.confirmed).toBeNull();
  });

  it("requireOcr=trueでもOCRゾーン一致なら確定する", () => {
    const session = new ScanSession();
    const zone = "ゾーン-spot-a";
    session.observe(confidentOutcome("spot-a"), 0, zone, true);
    const update = session.observe(confidentOutcome("spot-a"), 200, zone, true);
    expect(update.confirmed?.entry.id).toBe("spot-a");
  });

  it("best が存在しない出力では確定にならず低信頼扱いになる", () => {
    const session = new ScanSession();
    const empty = new MatchOutcome([], 0);
    const result = session.observe(empty, 0);
    expect(result.confirmed).toBeNull();
    const after = session.observe(empty, LOW_CONFIDENCE_TIMEOUT_MS);
    expect(after.showCandidates).toBe(true);
  });
});
