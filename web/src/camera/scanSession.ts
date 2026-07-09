import { zoneKeyOf } from "../i18n";
import type { MatchOutcome, MatchResult } from "../matcher/matcher";

/** スコア確定に必要な「同一エントリの確信ヒット」数。 */
export const CONFIRM_HITS = 2;

/** ヒットを数える直近観測数の窓。モアレ等で確信フレームが明滅しても当たりを拾えるようにする。 */
export const OBSERVATION_WINDOW = 5;

/** 別ゾーンの確信ヒットが確定をブロックする対象範囲（直近観測数）。 */
export const ZONE_CONFLICT_WINDOW = 3;

/** OCR安定確定に必要な「トップ1が同一」連続観測数。 */
export const OCR_STABLE_TICKS = 4;

/** OCR安定確定の信頼度下限（マージン圧縮時でもこの程度は要求する）。 */
export const OCR_STABLE_MIN_CONFIDENCE = 0.25;

/** 低信頼が続いたとき、下部に上位候補とヒントを出し始めるまでの経過時間 (ms)。 */
export const LOW_CONFIDENCE_TIMEOUT_MS = 5000;

/** 確定の根拠。ocrStable はゾーンOCR一致＋トップ1安定による確定（候補も併せて見せる）。 */
export type ConfirmVia = "score" | "ocrStable";

/** 1 回の照合観測に対するライブスキャンの判定結果。 */
export interface ScanUpdate {
  readonly confirmed: MatchResult | null;
  readonly via: ConfirmVia | null;
  /** 低信頼が LOW_CONFIDENCE_TIMEOUT_MS 以上続いている場合 true。 */
  readonly showCandidates: boolean;
}

interface Observation {
  readonly topId: string | null;
  readonly confidentId: string | null;
  readonly confidentZoneKey: string | null;
}

/**
 * ライブ照合ループの状態機械。確定は2経路:
 * 1. スコア確定: isConfident なエントリが直近 5 観測中に同一 id で 2 回。ただし直近 3 観測に
 *    別ゾーンの確信ヒットがあるあいだは保留（角度移動中の一瞬の誤確定を防ぐ）。
 * 2. OCR安定確定: ゾーンOCRが一致している状態でトップ1が 4 観測連続で同一なら、
 *    マージン由来の信頼度がしきい値未満でも確定する（カメラ劣化でマージンが圧縮されても、
 *    ゾーンが固定できていればトップ1の安定が十分な証拠になる。DB のゾーン内分離は良好という
 *    実測に基づく）。
 * DOM や時刻取得に依存しない（nowMs を呼び出し側から渡す）ため単体テスト可能。
 */
export class ScanSession {
  private recent: Observation[] = [];
  private lowConfidenceSinceMs: number | null = null;

  observe(
    outcome: MatchOutcome,
    nowMs: number,
    ocrZoneKey: string | null = null,
    requireOcr = false,
  ): ScanUpdate {
    const best = outcome.best ?? null;
    const obs: Observation = {
      topId: best?.entry.id ?? null,
      confidentId: outcome.isConfident && best ? best.entry.id : null,
      confidentZoneKey: outcome.isConfident && best ? zoneKeyOf(best.entry) : null,
    };
    this.recent.push(obs);
    if (this.recent.length > OBSERVATION_WINDOW) this.recent.shift();

    // 経路2: OCR安定確定
    if (
      ocrZoneKey !== null &&
      best !== null &&
      zoneKeyOf(best.entry) === ocrZoneKey &&
      outcome.confidence >= OCR_STABLE_MIN_CONFIDENCE &&
      this.recent.length >= OCR_STABLE_TICKS
    ) {
      const lastN = this.recent.slice(-OCR_STABLE_TICKS);
      if (lastN.every((o) => o.topId === best.entry.id)) {
        this.lowConfidenceSinceMs = null;
        return { confirmed: best, via: "ocrStable", showCandidates: false };
      }
    }

    // 経路1: スコア確定
    if (obs.confidentId !== null && best !== null) {
      this.lowConfidenceSinceMs = null;
      // OCR必須モード: ゾーンOCRが一致していない間はスコアがどれだけ高くても確定しない
      // （地図以外にカメラを向けたときの誤確定を防ぐ。ユーザー設定・既定ON）
      if (requireOcr && (ocrZoneKey === null || zoneKeyOf(best.entry) !== ocrZoneKey)) {
        return { confirmed: null, via: null, showCandidates: false };
      }
      const hits = this.recent.filter((o) => o.confidentId === obs.confidentId).length;
      const recentConflict = this.recent
        .slice(-ZONE_CONFLICT_WINDOW)
        .some((o) => o.confidentZoneKey !== null && o.confidentZoneKey !== obs.confidentZoneKey);
      if (hits >= CONFIRM_HITS && !recentConflict) {
        return { confirmed: best, via: "score", showCandidates: false };
      }
      return { confirmed: null, via: null, showCandidates: false };
    }

    if (this.lowConfidenceSinceMs === null) {
      this.lowConfidenceSinceMs = nowMs;
    }
    const elapsed = nowMs - this.lowConfidenceSinceMs;
    return { confirmed: null, via: null, showCandidates: elapsed >= LOW_CONFIDENCE_TIMEOUT_MS };
  }

  /** 再スキャン時に呼び、観測履歴と低信頼タイマーを初期状態へ戻す。 */
  reset(): void {
    this.recent = [];
    this.lowConfidenceSinceMs = null;
  }
}
