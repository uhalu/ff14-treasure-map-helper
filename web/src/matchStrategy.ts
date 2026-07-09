import { tryRectifyWidget } from "./camera/rectify";
import { zoneKeyOf } from "./i18n";
import type { GrayImage } from "./matcher/grayImage";
import type { MapEntry } from "./matcher/mapDatabase";
import type { Matcher, MatchOutcome } from "./matcher/matcher";

/**
 * 追加で試す中央クロップの inset。実機検証（スマホでモニタを撮影）で、ガイド枠と
 * 地図ウィンドウの間の余白＋発光ハローが照合エンジンの窓グリッド吸収範囲（±12%）を
 * 食い潰し、余白なし時 conf 0.97 → 枠ごと時 0.22 まで劣化する事例を確認したため、
 * アプリ層でクロップを数段試して最良の信頼度を採る。inset 4〜8% で確定に戻る実測。
 */
const FALLBACK_INSETS = [0.04, 0.08, 0.12] as const;

type EntryFilter = ((entry: MapEntry) => boolean) | undefined;

/**
 * 入力をそのまま照合し、確定に届かなければ中央クロップのバリアントでも照合して
 * 最も信頼度の高い結果を返す。確定が出た時点で打ち切る（ライブ照合の電池・CPU配慮）。
 */
export function matchWithCropFallback(
  matcher: Matcher,
  gray: GrayImage,
  filter?: EntryFilter,
): MatchOutcome {
  let best = matcher.match(gray, filter);
  if (best.isConfident) return best;

  for (const inset of FALLBACK_INSETS) {
    const outcome = matcher.match(gray.cropCenter(inset), filter);
    if (outcome.confidence > best.confidence) {
      best = outcome;
    }
    if (best.isConfident) break;
  }
  return best;
}

export interface SmartMatchOptions {
  /**
   * 事前に計算済みの射影補正画像。undefined なら内部で検出を試み、null なら補正なしで照合する
   * （呼び出し側が OCR 等のために検出結果を再利用するとき、二重計算を避けるために渡す）。
   */
  rectified?: GrayImage | null;
  /** ゾーン名 OCR ゲートの結果（zoneKeyOf のキー）。指定するとそのゾーンのエントリに絞って照合する。 */
  zoneKey?: string | null;
}

/**
 * 照合の総合戦略: まずそのまま（＋クロップフォールバック）、確定しなければ
 * 地図ウィンドウの四角形検出＋射影補正をかけてもう一度照合し、良い方を返す。
 * カメラの角度による透視歪みは補正側が吸収する。検出失敗時は素通し結果のみ。
 * zoneKey が指定された場合はハードフィルタとして扱い、候補をそのゾーン内に絞る。
 */
export function matchSmart(
  matcher: Matcher,
  gray: GrayImage,
  options: SmartMatchOptions = {},
): MatchOutcome {
  const filter: EntryFilter = options.zoneKey
    ? (e) => zoneKeyOf(e) === options.zoneKey
    : undefined;

  const plain = matchWithCropFallback(matcher, gray, filter);
  if (plain.isConfident) return plain;

  const rectified =
    options.rectified !== undefined ? options.rectified : tryRectifyWidget(gray);
  if (!rectified) return plain;

  const corrected = matchWithCropFallback(matcher, rectified, filter);
  return corrected.confidence > plain.confidence ? corrected : plain;
}
