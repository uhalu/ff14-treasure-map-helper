import { GrayImage } from "../matcher/grayImage";

/**
 * 地図ウィンドウ（明るい羊皮紙＋発光縁）をフレーム内から検出し、射影補正して
 * 正面向きの画像に直すモジュール。カメラの角度による透視歪みを照合前に取り除く。
 *
 * 手順:
 *  1. 縮小画像で輝度しきい値の明領域マスクを作り、最大連結成分を取る
 *  2. 成分の四隅（x+y / x-y の極値）から四角形を推定し、妥当性を検査
 *  3. 4点対応のホモグラフィで 439x380 の正面画像に逆写像（bilinear）
 * 検出に失敗したら null を返し、呼び出し側は補正なしの照合にフォールバックする。
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Quad {
  readonly tl: Point;
  readonly tr: Point;
  readonly br: Point;
  readonly bl: Point;
}

/** 検出用の縮小幅（速度優先。四隅は原寸に拡大して使う）。 */
const DETECT_WIDTH = 160;

/** 出力サイズ（DB 参照画像と同じアスペクト）。 */
export const RECTIFIED_WIDTH = 439;
export const RECTIFIED_HEIGHT = 380;

/** 最大明領域がフレームに占める面積比の許容範囲。外れたら検出失敗扱い。 */
const MIN_AREA_FRACTION = 0.05;
const MAX_AREA_FRACTION = 0.97;

/** 推定四角形の辺長がフレーム寸法に占める最小比率。 */
const MIN_SIDE_FRACTION = 0.22;

/** 明領域マスクのしきい値（大津の二値化。結果は [0.3, 0.8] にクランプ）。 */
function brightThreshold(pixels: Float32Array): number {
  const BINS = 64;
  const hist = new Float64Array(BINS);
  for (let i = 0; i < pixels.length; i++) {
    const b = Math.min(BINS - 1, Math.max(0, Math.floor(pixels[i]! * BINS)));
    hist[b]!++;
  }
  const total = pixels.length;
  let sumAll = 0;
  for (let b = 0; b < BINS; b++) sumAll += b * hist[b]!;

  let sumBg = 0;
  let weightBg = 0;
  let bestVar = -1;
  let bestBin = BINS / 2;
  for (let b = 0; b < BINS; b++) {
    weightBg += hist[b]!;
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;
    sumBg += b * hist[b]!;
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const between = weightBg * weightFg * (meanBg - meanFg) ** 2;
    if (between > bestVar) {
      bestVar = between;
      bestBin = b;
    }
  }
  return Math.min(0.8, Math.max(0.3, (bestBin + 1) / BINS));
}

/** 明連結成分（4近傍）を面積の大きい順に最大 maxCount 件返す。 */
function brightComponents(mask: Uint8Array, w: number, h: number, maxCount = 3): Int32Array[] {
  const labels = new Int32Array(w * h).fill(-1);
  const all: Int32Array[] = [];
  const stack = new Int32Array(w * h);

  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = start;
    const collected: number[] = [];
    while (top > 0) {
      const p = stack[--top]!;
      collected.push(p);
      const px = p % w;
      if (px > 0 && mask[p - 1] && labels[p - 1] === -1) { labels[p - 1] = start; stack[top++] = p - 1; }
      if (px < w - 1 && mask[p + 1] && labels[p + 1] === -1) { labels[p + 1] = start; stack[top++] = p + 1; }
      if (p >= w && mask[p - w] && labels[p - w] === -1) { labels[p - w] = start; stack[top++] = p - w; }
      if (p < w * (h - 1) && mask[p + w] && labels[p + w] === -1) { labels[p + w] = start; stack[top++] = p + w; }
    }
    all.push(Int32Array.from(collected));
  }
  all.sort((a, b) => b.length - a.length);
  return all.slice(0, maxCount);
}

/**
 * 明領域から地図ウィンドウの四角形を推定する。座標は入力画像スケール。
 * 検出できない・妥当でない場合は null。
 */
export function detectWidgetQuad(gray: GrayImage): Quad | null {
  const dw = DETECT_WIDTH;
  const dh = Math.max(16, Math.round((gray.height * dw) / gray.width));
  const small = gray.resizeArea(dw, dh);

  const th = brightThreshold(small.pixels);
  const mask = new Uint8Array(dw * dh);
  for (let i = 0; i < mask.length; i++) mask[i] = small.pixels[i]! > th ? 1 : 0;

  // 面積上位の明成分から「地図ウィンドウらしい四角形」を選ぶ。
  // 最大成分固定だと、ゲーム内の大きなマップウィンドウや照明に吸われる（実機で確認）。
  for (const comp of brightComponents(mask, dw, dh)) {
    const areaFraction = comp.length / (dw * dh);
    if (areaFraction < MIN_AREA_FRACTION || areaFraction > MAX_AREA_FRACTION) continue;

    // 四隅推定: x+y / x-y の極値
    let tl = 0, br = 0, tr = 0, bl = 0;
    let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
    for (const p of comp) {
      const x = p % dw;
      const y = (p - x) / dw;
      const s = x + y;
      const d = x - y;
      if (s < minSum) { minSum = s; tl = p; }
      if (s > maxSum) { maxSum = s; br = p; }
      if (d > maxDiff) { maxDiff = d; tr = p; }
      if (d < minDiff) { minDiff = d; bl = p; }
    }
    const toPoint = (p: number): Point => ({ x: p % dw, y: Math.floor(p / dw) });
    const q = { tl: toPoint(tl), tr: toPoint(tr), br: toPoint(br), bl: toPoint(bl) };

    // 妥当性1: 上下の辺・左右の辺がフレームに対して十分な長さを持つこと
    const width1 = Math.hypot(q.tr.x - q.tl.x, q.tr.y - q.tl.y);
    const width2 = Math.hypot(q.br.x - q.bl.x, q.br.y - q.bl.y);
    const height1 = Math.hypot(q.bl.x - q.tl.x, q.bl.y - q.tl.y);
    const height2 = Math.hypot(q.br.x - q.tr.x, q.br.y - q.tr.y);
    if (Math.min(width1, width2) < dw * MIN_SIDE_FRACTION) continue;
    if (Math.min(height1, height2) < dh * MIN_SIDE_FRACTION) continue;

    // 妥当性2: 地図ウィンドウの形状（横長 1.0〜1.6、四角形への充填率 0.6 以上）
    const avgW = (width1 + width2) / 2;
    const avgH = (height1 + height2) / 2;
    const aspect = avgW / avgH;
    if (aspect < 0.85 || aspect > 1.7) continue;
    const quadArea = avgW * avgH;
    if (comp.length / quadArea < 0.6) continue;

    // 原寸スケールへ（縮小ブロックの中心相当に +0.5）
    const sx = gray.width / dw;
    const sy = gray.height / dh;
    const scale = (pt: Point): Point => ({ x: (pt.x + 0.5) * sx, y: (pt.y + 0.5) * sy });
    return { tl: scale(q.tl), tr: scale(q.tr), br: scale(q.br), bl: scale(q.bl) };
  }
  return null;
}

/**
 * 出力矩形 (0,0)-(w,h) → 入力四角形への射影係数を求める（8元連立を解く）。
 * src_x = (a*x + b*y + c) / (g*x + h*y + 1) の a..h を返す。
 */
export function solveHomography(quad: Quad, w: number, h: number): Float64Array {
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const src = [quad.tl, quad.tr, quad.br, quad.bl];

  // A * coeffs = b（8x8 のガウス消去）
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i]!;
    const { x: u, y: v } = src[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) {
      if (Math.abs(A[r]![col]!) > Math.abs(A[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(A[pivot]![col]!) < 1e-9) throw new Error("退化した四角形です。");
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r]![col]! / A[col]![col]!;
      for (let c = col; c < 8; c++) A[r]![c]! -= f * A[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const coeffs = new Float64Array(8);
  for (let i = 0; i < 8; i++) coeffs[i] = b[i]! / A[i]![i]!;
  return coeffs;
}

/** 四角形領域を射影補正して正面向きの GrayImage を返す（bilinear、範囲外は端をクランプ）。 */
export function rectifyQuad(
  gray: GrayImage,
  quad: Quad,
  outWidth = RECTIFIED_WIDTH,
  outHeight = RECTIFIED_HEIGHT,
): GrayImage {
  const c = solveHomography(quad, outWidth, outHeight);
  const out = new Float32Array(outWidth * outHeight);
  const { width: w, height: h, pixels } = gray;

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const denom = c[6]! * x + c[7]! * y + 1;
      let sxF = (c[0]! * x + c[1]! * y + c[2]!) / denom;
      let syF = (c[3]! * x + c[4]! * y + c[5]!) / denom;
      sxF = Math.min(w - 1.001, Math.max(0, sxF));
      syF = Math.min(h - 1.001, Math.max(0, syF));
      const x0 = Math.floor(sxF);
      const y0 = Math.floor(syF);
      const fx = sxF - x0;
      const fy = syF - y0;
      const p00 = pixels[y0 * w + x0]!;
      const p10 = pixels[y0 * w + x0 + 1]!;
      const p01 = pixels[(y0 + 1) * w + x0]!;
      const p11 = pixels[(y0 + 1) * w + x0 + 1]!;
      out[y * outWidth + x] =
        p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
    }
  }
  return new GrayImage(outWidth, outHeight, out);
}

/** 検出＋補正を一括で行う。検出できなければ null。 */
export function tryRectifyWidget(gray: GrayImage): GrayImage | null {
  const quad = detectWidgetQuad(gray);
  if (!quad) return null;
  try {
    return rectifyQuad(gray, quad);
  } catch {
    return null;
  }
}
