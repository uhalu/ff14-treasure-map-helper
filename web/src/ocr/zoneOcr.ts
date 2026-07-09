import type { Script } from "../i18n";
import { GrayImage } from "../matcher/grayImage";

/**
 * ゾーン名 OCR ゲート。
 * 射影補正済み（正面向き）の地図画像の左上にあるゾーン名帯を検出・二値化し、
 * Tesseract.js（自己ホストの選択言語モデル）で読み取って DB のゾーン名とあいまい一致させる。
 * 誤読1〜2文字（例: 雲海→青海）を許容するため、バイグラム Dice 係数で最良ゾーンを選ぶ。
 * 帯検出（extractZoneBand）は白文字の輝度特性のみを使うため文字体系に依存しない。
 */

/** 二値化済みの帯画像（1=文字（黒で描画）、0=背景）。 */
export interface BandImage {
  readonly width: number;
  readonly height: number;
  /** 0(文字)/255(背景) のグレースケール。 */
  readonly data: Uint8ClampedArray;
}

/** 帯検出のパラメータ（正面向き 439x380 基準の比率）。 */
const BAND_SEARCH_TOP = 0.35; // 上部この範囲から帯を探す
const BAND_LEFT_EVAL = 0.6;   // 帯の行判定に使う左側の幅
const BAND_MIN_HEIGHT = 0.03;
const OCR_SCALE = 3;
const OCR_MARGIN = 12;

/** 縦縞モアレ（モニタのサブピクセル格子）を抑えるための水平ボックスブラー。 */
function blurHorizontal(gray: GrayImage, radius: number): GrayImage {
  const { width: w, height: h, pixels } = gray;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let d = -radius; d <= radius; d++) {
        const xx = Math.min(w - 1, Math.max(0, x + d));
        sum += pixels[y * w + xx]!;
        cnt++;
      }
      out[y * w + x] = sum / cnt;
    }
  }
  return new GrayImage(w, h, out);
}

/** 数値配列のパーセンタイル（コピーしてソート）。 */
function percentile(values: Float32Array | Float64Array, p: number): number {
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
}

/** 大津の二値化しきい値（値域 0..1、64bin）。 */
function otsuThreshold(values: number[]): number {
  const BINS = 64;
  const hist = new Float64Array(BINS);
  for (const v of values) hist[Math.min(BINS - 1, Math.max(0, Math.floor(v * BINS)))]!++;
  const total = values.length;
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
  return (bestBin + 1) / BINS;
}

/** 2次元ボックスブラー（局所平均の推定用。分離型で O(N)）。 */
function boxBlur(gray: GrayImage, radius: number): Float32Array {
  const { width: w, height: h, pixels } = gray;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += pixels[y * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / (2 * radius + 1);
      const add = Math.min(w - 1, x + radius + 1);
      const del = Math.max(0, x - radius);
      sum += pixels[y * w + add]! - pixels[y * w + del]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * radius + 1);
      const add = Math.min(h - 1, y + radius + 1);
      const del = Math.max(0, y - radius);
      sum += tmp[add * w + x]! - tmp[del * w + x]!;
    }
  }
  return out;
}

/**
 * 正面向き画像の上部からゾーン名の白文字を直接検出し、OCR 向けの二値化画像
 * （黒文字・白背景・拡大済み）を返す。見つからなければ null。
 *
 * 帯（暗い下地）の検出は露出や補正クロップ位置で壊れやすいため行わない。
 * 白文字の性質「周囲の局所平均より十分明るい ∧ 下地が羊皮紙より暗い」で
 * 文字画素を直接拾う（局所コントラスト二値化）。
 */
export function extractZoneBand(rawGray: GrayImage): BandImage | null {
  const gray = blurHorizontal(rawGray, 2); // 縦縞モアレの抑制
  const { width: w, pixels } = gray;

  // 探索ストリップ: 上部 0〜20%、左 0〜70%（ゾーン名帯は常にこの範囲に載る）
  const sh = Math.max(8, Math.floor(gray.height * 0.2));
  const sw = Math.max(8, Math.floor(w * 0.7));
  const strip = new Float32Array(sh * sw);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) strip[y * sw + x] = pixels[y * w + x]!;
  const stripImg = new GrayImage(sw, sh, strip);

  const localMean = boxBlur(stripImg, Math.max(4, Math.floor(sh / 3)));
  const parchment = percentile(strip, 0.8);

  // 文字画素: 局所平均より十分明るく、かつ下地（局所平均）が羊皮紙より暗い
  const ink = new Uint8Array(sw * sh);
  let inkCount = 0;
  for (let i = 0; i < strip.length; i++) {
    if (strip[i]! - localMean[i]! > 0.08 && localMean[i]! < parchment - 0.06) {
      ink[i] = 1;
      inkCount++;
    }
  }
  const inkFrac = inkCount / strip.length;
  if (inkFrac < 0.005 || inkFrac > 0.35) return null; // 文字らしき成分が無い/多すぎる

  // 連結成分に分け、文字サイズの成分だけを残す（発光縁・羊皮紙ハイライトの塊を除去）
  interface Comp { x0: number; x1: number; y0: number; y1: number; area: number; pts: number[] }
  const labels = new Int32Array(sw * sh).fill(-1);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let start = 0; start < sw * sh; start++) {
    if (!ink[start] || labels[start] !== -1) continue;
    const id = comps.length;
    labels[start] = id;
    stack.length = 0;
    stack.push(start);
    const comp: Comp = { x0: sw, x1: 0, y0: sh, y1: 0, area: 0, pts: [] };
    while (stack.length > 0) {
      const p = stack.pop()!;
      comp.pts.push(p);
      comp.area++;
      const px = p % sw;
      const py = (p - px) / sw;
      if (px < comp.x0) comp.x0 = px;
      if (px > comp.x1) comp.x1 = px;
      if (py < comp.y0) comp.y0 = py;
      if (py > comp.y1) comp.y1 = py;
      if (px > 0 && ink[p - 1] && labels[p - 1] === -1) { labels[p - 1] = id; stack.push(p - 1); }
      if (px < sw - 1 && ink[p + 1] && labels[p + 1] === -1) { labels[p + 1] = id; stack.push(p + 1); }
      if (p >= sw && ink[p - sw] && labels[p - sw] === -1) { labels[p - sw] = id; stack.push(p - sw); }
      if (p < sw * (sh - 1) && ink[p + sw] && labels[p + sw] === -1) { labels[p + sw] = id; stack.push(p + sw); }
    }
    comps.push(comp);
  }
  const glyphs = comps.filter((c) => {
    const cw = c.x1 - c.x0 + 1;
    const ch = c.y1 - c.y0 + 1;
    if (c.area < 12) return false;                 // ゴマ粒ノイズ
    if (ch < sh * 0.08 || ch > sh * 0.6) return false; // 低すぎ/高すぎ
    if (cw > ch * 3 || cw > sw * 0.2) return false;    // 横長の帯状ノイズ
    return true;
  });
  if (glyphs.length < 3) return null;

  // 支配的な行を選ぶ: 中心 y の中央値近傍の成分のみ採用
  const centers = glyphs.map((c) => (c.y0 + c.y1) / 2).sort((a, b) => a - b);
  const medianY = centers[Math.floor(centers.length / 2)]!;
  const heights = glyphs.map((c) => c.y1 - c.y0 + 1).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)]!;
  const line = glyphs.filter((c) => Math.abs((c.y0 + c.y1) / 2 - medianY) < medianH);
  if (line.length < 3) return null;

  let bx0 = sw, bx1 = 0, by0 = sh, by1 = 0;
  for (const c of line) {
    if (c.x0 < bx0) bx0 = c.x0;
    if (c.x1 > bx1) bx1 = c.x1;
    if (c.y0 < by0) by0 = c.y0;
    if (c.y1 > by1) by1 = c.y1;
  }
  const pad = 4;
  bx0 = Math.max(0, bx0 - pad);
  by0 = Math.max(0, by0 - pad);
  bx1 = Math.min(sw - 1, bx1 + pad);
  by1 = Math.min(sh - 1, by1 + pad);
  const bw = bx1 - bx0 + 1;
  const bh = by1 - by0 + 1;
  if (bh < 10 || bw < sw * 0.1) return null;

  // 行に採用した成分の画素だけを描画（拡大＋余白付き・黒文字/白背景）
  const keep = new Uint8Array(sw * sh);
  for (const c of line) for (const p of c.pts) keep[p] = 1;
  const scale = OCR_SCALE;
  const ow = bw * scale + OCR_MARGIN * 2;
  const oh = bh * scale + OCR_MARGIN * 2;
  const data = new Uint8ClampedArray(ow * oh).fill(255);
  for (let y = 0; y < bh * scale; y++) {
    const sy = by0 + Math.floor(y / scale);
    for (let x = 0; x < bw * scale; x++) {
      const sx = bx0 + Math.floor(x / scale);
      if (keep[sy * sw + sx]) {
        data[(y + OCR_MARGIN) * ow + (x + OCR_MARGIN)] = 0;
      }
    }
  }
  return { width: ow, height: oh, data };
}

/**
 * OCR テキストの正規化。文字体系ごとの許可リスト方式
 * （OCR は先頭や途中に記号・数字のゴミを混ぜるため、除去リスト方式にしない）。
 * ラテン文字は小文字化・ß→ss・ダイアクリティクス除去まで行い、OCR がアクセントを
 * 落としても（Forêt→Foret）ゾーン名側と同じ表現に揃うようにする。
 */
export function normalizeOcrText(text: string, script: Script = "ja"): string {
  switch (script) {
    case "ja":
      return (text.match(/[ぁ-んァ-ヶー一-龯]/gu) ?? []).join("");
    case "ko":
      return (text.match(/[가-힣]/gu) ?? []).join("");
    case "zh":
      return (text.match(/[一-鿿]/gu) ?? []).join("");
    case "latin":
      return text
        .toLowerCase()
        .replace(/ß/g, "ss")
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .replace(/[^a-z]/g, "");
  }
}

function gramCounts(s: string, n: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + n <= s.length; i++) {
    const g = s.slice(i, i + n);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function diceWithN(a: string, b: string, n: number): number {
  const ga = gramCounts(a, n);
  const gb = gramCounts(b, n);
  let overlap = 0, ca = 0, cb = 0;
  for (const v of ga.values()) ca += v;
  for (const v of gb.values()) cb += v;
  if (ca === 0 || cb === 0) return 0;
  for (const [g, v] of ga) overlap += Math.min(v, gb.get(g) ?? 0);
  return (2 * overlap) / (ca + cb);
}

/** バイグラム Dice 係数（0..1）。どちらかが 2 文字未満なら 1 グラムで比較。 */
export function diceSimilarity(a: string, b: string): number {
  return diceWithN(a, b, a.length >= 2 && b.length >= 2 ? 2 : 1);
}

/**
 * OCR 結果とゾーン名一覧のあいまい一致。
 * 実機の OCR は 2〜4 文字誤読する（例:「ギラ バー ア 湖 写」）ため、しきい値は低め(0.35)にし、
 * 代わりに 2 位のゾーンとのスコア差(0.08)で曖昧なケースを弾く。
 */
export function matchZoneName(
  ocrText: string,
  zones: readonly string[],
  script: Script = "ja",
  minSimilarity = 0.4,
  minGap = 0.06,
): string | null {
  // しきい値は日本語の実機実測で決めた値。
  const t = normalizeOcrText(ocrText, script);
  const isCjk = script !== "latin";
  // CJK には正当な2文字ゾーン名がある（얀샤・延夏・迷津）。ラテンは3文字未満をノイズ扱い
  if (t.length < (isCjk ? 2 : 3)) return null;
  let best: string | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const zone of zones) {
    const z = normalizeOcrText(zone, script);
    // 帯にはゾーン名だけが載る想定だが、誤読でゴミが付くことがあるため
    // 「ゾーン名長に切った先頭部分」との類似も見る
    let dice = Math.max(diceSimilarity(t, z), diceSimilarity(t.slice(0, z.length), z));
    // CJK の短い地名（例: 中萨纳兰 4文字）は1文字の誤読でバイグラムが激減するため、
    // 字単位（1グラム）の類似も 0.9 掛けで併用する。姉妹ゾーンの識別は従来どおり
    // 先頭一致ボーナスと2位とのスコア差で担保される
    if (isCjk) {
      dice = Math.max(
        dice,
        0.9 * diceWithN(t, z, 1),
        0.9 * diceWithN(t.slice(0, z.length), z, 1),
      );
    }
    // 先頭一致ボーナス: OCR テキストはゾーン名の先頭から読まれる性質を使い、
    // 接頭辞・接尾辞を共有する姉妹ゾーン（高地/低地ドラヴァニア等）を区別する
    let prefix = 0;
    while (prefix < Math.min(t.length, z.length) && t[prefix] === z[prefix]) prefix++;
    const score = dice + 0.25 * (prefix / z.length);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = zone;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  if (bestScore < minSimilarity || bestScore - secondScore < minGap) return null;
  return best;
}

/** Tesseract.js ワーカーの遅延初期化と帯 OCR（ブラウザ用）。 */
export type ZoneOcrStatus = "idle" | "loading" | "ready" | "failed";

export class ZoneOcr {
  private workerPromise: Promise<import("tesseract.js").Worker> | null = null;
  private failed = false;
  private lastError = "";
  private _status: ZoneOcrStatus = "idle";

  /**
   * @param tessLang tesseract の言語データ名（public/ocr/lang/<名前>.traineddata.gz）
   * @param script ゾーン名照合に使う文字体系
   */
  constructor(
    private readonly tessLang: string = "jpn",
    private readonly script: Script = "ja",
  ) {}

  /** バックグラウンドで初期化を開始する（多重呼び出しは無害）。 */
  warmUp(): void {
    void this.getWorker();
  }

  get isFailed(): boolean {
    return this.failed;
  }

  /** UI 表示用の状態。failed のときは errorMessage に理由が入る。 */
  get status(): ZoneOcrStatus {
    return this._status;
  }

  get errorMessage(): string {
    return this.lastError;
  }

  private getWorker(): Promise<import("tesseract.js").Worker> {
    if (!this.workerPromise) {
      this._status = "loading";
      this.workerPromise = (async () => {
        const { createWorker, PSM } = await import("tesseract.js");
        const worker = await createWorker(this.tessLang, 1, {
          workerPath: new URL("./ocr/worker.min.js", document.baseURI).href,
          corePath: new URL("./ocr/", document.baseURI).href,
          langPath: new URL("./ocr/lang", document.baseURI).href,
          gzip: true,
        });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        this._status = "ready";
        return worker;
      })();
      this.workerPromise.catch((err) => {
        this.failed = true;
        this._status = "failed";
        this.lastError = err instanceof Error ? err.message : String(err);
        this.workerPromise = null;
      });
    }
    return this.workerPromise;
  }

  /**
   * 正面向き画像からゾーンを読み取る。帯が無い・読めない・未初期化失敗時は null。
   */
  async recognizeZone(rectified: GrayImage, zones: readonly string[]): Promise<string | null> {
    const band = extractZoneBand(rectified);
    if (!band) return null;

    const canvas = document.createElement("canvas");
    canvas.width = band.width;
    canvas.height = band.height;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(band.width, band.height);
    for (let i = 0; i < band.data.length; i++) {
      const v = band.data[i]!;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    try {
      const worker = await this.getWorker();
      const { data } = await worker.recognize(canvas);
      return matchZoneName(data.text, zones, this.script);
    } catch (err) {
      this.failed = true;
      this._status = "failed";
      this.lastError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }
}
