/**
 * PC 用モードの1ショット照合パイプライン。
 * 貼り付け・ドロップされたスクリーンショット1枚を、カメラページのライブ照合と
 * 同じ前処理（地図ウィンドウの四角形検出＋射影補正、照合用の縮小）で照合する。
 * DOM に依存しないため、ページ本体（desktop.ts）とテストの両方から使う。
 */

import { detectWidgetQuad, rectifyQuad } from "./camera/rectify";
import type { GrayImage } from "./matcher/grayImage";
import type { Matcher, MatchOutcome } from "./matcher/matcher";
import { matchSmart } from "./matchStrategy";

/** 照合用に縮小する最大幅。特徴量は 32/16px まで縮めるので精度影響なし（カメラページと同値）。 */
const MATCH_MAX_WIDTH = 560;
/** この幅を超える入力では、ゾーン名 OCR に高解像度の補正画像を使う（文字の潰れ防止）。 */
const OCR_HIRES_MIN_WIDTH = 600;
/** 高解像度 OCR 用の補正サイズ（標準補正 439x380 の2倍）。 */
const OCR_HIRES_WIDTH = 878;
const OCR_HIRES_HEIGHT = 760;

export interface ScreenshotMatch {
  outcome: MatchOutcome;
  /** 地図ウィンドウを検出できた場合の射影補正済み画像（結果プレビュー用）。 */
  rectified: GrayImage | null;
  /** ゾーン名 OCR に渡す画像（高解像度補正 > 標準補正 > 入力そのまま）。 */
  ocrImage: GrayImage;
}

/**
 * スクリーンショット1枚を照合する。zoneKey を指定するとそのゾーンのエントリに絞る。
 * 地図ウィンドウより広めに切り取られた入力は四角形検出＋射影補正が実質クロップとして
 * 効き、検出に失敗しても matchSmart のクロップフォールバックが余白を吸収する。
 */
export function matchScreenshot(
  matcher: Matcher,
  grayFull: GrayImage,
  zoneKey: string | null = null,
): ScreenshotMatch {
  const gray =
    grayFull.width > MATCH_MAX_WIDTH
      ? grayFull.resizeArea(
          MATCH_MAX_WIDTH,
          Math.max(1, Math.round((grayFull.height * MATCH_MAX_WIDTH) / grayFull.width)),
        )
      : grayFull;
  const quad = detectWidgetQuad(grayFull);
  const rectified = quad ? rectifyQuad(grayFull, quad) : null;
  const ocrImage =
    quad && grayFull.width > OCR_HIRES_MIN_WIDTH
      ? rectifyQuad(grayFull, quad, OCR_HIRES_WIDTH, OCR_HIRES_HEIGHT)
      : (rectified ?? grayFull);
  const outcome = matchSmart(matcher, gray, { rectified, zoneKey });
  return { outcome, rectified, ocrImage };
}

/** 画像として扱う MIME タイプか。 */
export function isImageMime(type: string): boolean {
  return type.startsWith("image/");
}

/**
 * デコード時の縮小サイズを計算する。幅 maxWidth 以下ならそのまま、
 * 超えるならアスペクト比を保って maxWidth に収める（高さは最低1px）。
 */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

/** バイト列を16進文字列にする（貼り付け画像の重複判定キー用）。 */
export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = "";
  for (const b of view) hex += b.toString(16).padStart(2, "0");
  return hex;
}
