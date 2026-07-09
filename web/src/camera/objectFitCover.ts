/**
 * ビューファインダのガイド枠ジオメトリと、`object-fit: cover` で描画された
 * `<video>` 上のガイド枠に対応するソース映像座標を求める純粋関数群。
 * DOM に依存しないため単体テストで座標変換を直接検証できる。
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** ガイド枠のアスペクト比（DB 参照画像の 439:380 に合わせる）。 */
export const GUIDE_ASPECT = 439 / 380;

/** ガイド枠の幅（コンテナ幅に対する比率）。 */
export const GUIDE_WIDTH_RATIO = 0.85;

/** ガイド枠の高さがコンテナ高さに対して超えてよい上限比率（横長画面での破綻防止）。 */
export const GUIDE_MAX_HEIGHT_RATIO = 0.85;

/**
 * ビューファインダのコンテナサイズから、中央揃えのガイド枠（コンテナ座標系, px）を求める。
 * 幅はコンテナ幅の GUIDE_WIDTH_RATIO を基準にするが、コンテナ高さに対して
 * GUIDE_MAX_HEIGHT_RATIO を超える場合は高さ基準に縮小する（横長画面対策）。
 */
export function computeGuideRect(container: Size): Rect {
  requirePositiveSize(container, "container");

  let width = container.width * GUIDE_WIDTH_RATIO;
  let height = width / GUIDE_ASPECT;

  const maxHeight = container.height * GUIDE_MAX_HEIGHT_RATIO;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * GUIDE_ASPECT;
  }

  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  };
}

/**
 * `object-fit: cover` で container 内に描画された video 映像において、
 * container 座標系のガイド枠に対応する video ソース座標（px, 整数）を返す。
 *
 * cover は video のアスペクト比を保ったまま container を覆う最小倍率で拡大し、
 * はみ出た分を中央基準で左右（または上下）にクロップする。したがって
 * scale = max(containerW/videoW, containerH/videoH) で描画され、
 * container 座標 cx は video 座標 (cx - offsetX) / scale に対応する。
 */
export function computeCoverSourceRect(video: Size, container: Size, guide: Rect): Rect {
  requirePositiveSize(video, "video");
  requirePositiveSize(container, "container");

  const scale = Math.max(container.width / video.width, container.height / video.height);
  const renderedWidth = video.width * scale;
  const renderedHeight = video.height * scale;
  const offsetX = (container.width - renderedWidth) / 2;
  const offsetY = (container.height - renderedHeight) / 2;

  const sxRaw = (guide.x - offsetX) / scale;
  const syRaw = (guide.y - offsetY) / scale;
  const swRaw = guide.width / scale;
  const shRaw = guide.height / scale;

  const sx = clamp(Math.round(sxRaw), 0, video.width - 1);
  const sy = clamp(Math.round(syRaw), 0, video.height - 1);
  const sw = clamp(Math.round(swRaw), 1, video.width - sx);
  const sh = clamp(Math.round(shRaw), 1, video.height - sy);

  return { x: sx, y: sy, width: sw, height: sh };
}

function requirePositiveSize(size: Size, label: string): void {
  if (size.width <= 0 || size.height <= 0) {
    throw new RangeError(`${label} のサイズは正の値が必要です: ${size.width}x${size.height}`);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
