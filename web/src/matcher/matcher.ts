import { extractWindows } from "./featureExtractor";
import type { GrayImage } from "./grayImage";
import type { MapDatabase, MapEntry } from "./mapDatabase";

const VEC_LENGTH = 16 * 16;

/** 照合結果 1 件。ncc が主スコア（1 に近いほど良い）。 */
export interface MatchResult {
  entry: MapEntry;
  ncc: number;
  hamming: number;
}

/** 照合結果全体。confidence は 0..1（しきい値は isConfident で判定）。 */
export class MatchOutcome {
  /** トップ 1 を確定表示してよいか判定するしきい値。摂動テストで較正した値。 */
  static readonly CONFIDENT_THRESHOLD = 0.6;

  constructor(
    readonly candidates: readonly MatchResult[],
    readonly confidence: number,
  ) {}

  get best(): MatchResult | undefined {
    return this.candidates[0];
  }

  get isConfident(): boolean {
    return this.confidence >= MatchOutcome.CONFIDENT_THRESHOLD;
  }
}

/** Hamming 粗選別から NCC 精査に回す窓数（クエリ窓 1 つあたり）。 */
const COARSE_TOP_K = 48;

/** フィルタで除外された flat 窓の Hamming 距離に使う番兵値。 */
const EXCLUDED = Number.MAX_SAFE_INTEGER;

/**
 * DB とクエリの両側で同一のアライメント窓グリッド（FeatureExtractor.enumerateAlignmentWindows）
 * を使い、pHash+dHash の Hamming 距離で粗選別 → 16x16 輝度ベクトルの NCC で精査 →
 * エントリごとに全窓ペアの最大 NCC を採用 → トップ1 の NCC とトップ2 とのマージンで信頼度を出す。
 */
export class Matcher {
  private readonly entries: MapEntry[];
  private readonly flatEntryIndex: number[];
  // 64bit ハッシュは 32bit×2 に分解して保持する（BigInt の逐次 popcount は
  // 1 照合あたり数百 ms かかり、ライブ照合に間に合わないため）。
  private readonly flatPHashHi: Uint32Array;
  private readonly flatPHashLo: Uint32Array;
  private readonly flatDHashHi: Uint32Array;
  private readonly flatDHashLo: Uint32Array;
  private readonly flatVecCentered: Float64Array[];
  private readonly flatVecBpCentered: Float64Array[];

  /**
   * DB 全窓の平均ベクトル（輝度平均系・バンドパス系それぞれ）。参照画像には全スポット共通の
   * 様式成分が含まれるため、無関係なエントリ同士でも NCC が底上げされてマージンが圧縮される。
   * この共通成分（≒平均ベクトル）を DB・クエリ両方から差し引いてから相関を取ることで、
   * 地図の内容そのものの類似だけを比較する。
   */
  private readonly meanVec: Float64Array;
  private readonly meanVecBp: Float64Array;

  constructor(db: MapDatabase) {
    if (db.entries.length === 0) {
      throw new Error("照合DBが空です。");
    }

    this.entries = db.entries.slice();
    const idx: number[] = [];
    const ph: bigint[] = [];
    const dh: bigint[] = [];
    const vec: Uint8Array[] = [];
    const vecBp: Uint8Array[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      for (const f of this.entries[i]!.variants) {
        idx.push(i);
        ph.push(f.pHash);
        dh.push(f.dHash);
        vec.push(f.vec16);
        vecBp.push(f.vecBp);
      }
    }
    this.flatEntryIndex = idx;
    this.flatPHashHi = new Uint32Array(ph.map((v) => Number(v >> 32n)));
    this.flatPHashLo = new Uint32Array(ph.map((v) => Number(v & 0xffffffffn)));
    this.flatDHashHi = new Uint32Array(dh.map((v) => Number(v >> 32n)));
    this.flatDHashLo = new Uint32Array(dh.map((v) => Number(v & 0xffffffffn)));

    this.meanVec = meanOf(vec);
    this.meanVecBp = meanOf(vecBp);
    this.flatVecCentered = vec.map((v) => centerVec(v, this.meanVec));
    this.flatVecBpCentered = vecBp.map((v) => centerVec(v, this.meanVecBp));
  }

  match(input: GrayImage, entryFilter?: (entry: MapEntry) => boolean, topN = 3): MatchOutcome {
    let allowed: boolean[] | null = null;
    if (entryFilter) {
      allowed = new Array(this.entries.length);
      let any = false;
      for (let i = 0; i < this.entries.length; i++) {
        allowed[i] = entryFilter(this.entries[i]!);
        any ||= allowed[i]!;
      }
      if (!any) {
        throw new Error("フィルタに一致するエントリがありません。");
      }
    }

    const flatCount = this.flatEntryIndex.length;
    const bestNcc = new Array<number>(this.entries.length).fill(Number.NEGATIVE_INFINITY);
    const bestHd = new Array<number>(this.entries.length).fill(Number.POSITIVE_INFINITY);

    const hd = new Array<number>(flatCount);
    let order = new Array<number>(flatCount);
    for (let j = 0; j < flatCount; j++) order[j] = j;

    for (const qf of extractWindows(input)) {
      const qVec = centerVec(qf.vec16, this.meanVec);
      const qVecBp = centerVec(qf.vecBp, this.meanVecBp);
      const qpHi = Number(qf.pHash >> 32n) >>> 0;
      const qpLo = Number(qf.pHash & 0xffffffffn) >>> 0;
      const qdHi = Number(qf.dHash >> 32n) >>> 0;
      const qdLo = Number(qf.dHash & 0xffffffffn) >>> 0;

      for (let j = 0; j < flatCount; j++) {
        // フィルタ対象外は粗選別の時点で除外する（上位 K 枠を占有させない）
        const entryIdx = this.flatEntryIndex[j]!;
        hd[j] =
          allowed !== null && !allowed[entryIdx]
            ? EXCLUDED
            : popcount32(qpHi ^ this.flatPHashHi[j]!) +
              popcount32(qpLo ^ this.flatPHashLo[j]!) +
              popcount32(qdHi ^ this.flatDHashHi[j]!) +
              popcount32(qdLo ^ this.flatDHashLo[j]!);
      }
      order = order.slice().sort((a, b) => hd[a]! - hd[b]!);

      // 粗選別: Hamming 距離上位 CoarseTopK 窓のみ NCC 精査
      const k = Math.min(COARSE_TOP_K, flatCount);
      for (let r = 0; r < k; r++) {
        const j = order[r]!;
        if (hd[j] === EXCLUDED) break; // フィルタ対象外がここに来たら以降も全て対象外
        const entry = this.flatEntryIndex[j]!;
        // 二本立てスコア融合: 輝度平均系（シワ付き実スクショに強い）と
        // バンドパス系（照明ムラに強い）の NCC の平均を採る。
        const nccValue =
          0.5 *
          (centeredNcc(qVec, this.flatVecCentered[j]!) + centeredNcc(qVecBp, this.flatVecBpCentered[j]!));
        if (nccValue > bestNcc[entry]! || (nccValue === bestNcc[entry] && hd[j]! < bestHd[entry]!)) {
          bestNcc[entry] = nccValue;
          bestHd[entry] = hd[j]!;
        }
      }
    }

    const ranked: MatchResult[] = Array.from({ length: this.entries.length }, (_, i) => i)
      .filter((i) => Number.isFinite(bestNcc[i]))
      .sort((a, b) => {
        const d = bestNcc[b]! - bestNcc[a]!;
        if (d !== 0) return d;
        return bestHd[a]! - bestHd[b]!;
      })
      .slice(0, topN)
      .map((i) => ({ entry: this.entries[i]!, ncc: bestNcc[i]!, hamming: bestHd[i]! }));

    return new MatchOutcome(ranked, computeConfidence(ranked));
  }
}

function meanOf(vectors: Uint8Array[]): Float64Array {
  const mean = new Float64Array(VEC_LENGTH);
  for (const v of vectors) {
    for (let k = 0; k < VEC_LENGTH; k++) {
      mean[k]! += v[k]!;
    }
  }
  for (let k = 0; k < VEC_LENGTH; k++) {
    mean[k]! /= vectors.length;
  }
  return mean;
}

function centerVec(v: Uint8Array, mean: Float64Array): Float64Array {
  const c = new Float64Array(v.length);
  for (let k = 0; k < v.length; k++) {
    c[k] = v[k]! - mean[k]!;
  }
  return c;
}

/** 共通成分除去済みベクトル同士の正規化相関。 */
function centeredNcc(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i]!;
    meanB += b[i]!;
  }
  meanA /= n;
  meanB /= n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA <= 1e-9 || varB <= 1e-9) return 0;
  return cov / Math.sqrt(varA * varB);
}

/** 32bit 整数の popcount（ビット並列。SWAR アルゴリズム）。 */
function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}

/**
 * トップ 1 の融合 NCC の高さと、トップ 2 との差（マージン）から信頼度を合成する（幾何平均）。
 * 較正データ（実スクショ4種・疑似カメラ100・PCスクショ摂動120の実測）:
 *   正解トップ1: ncc 0.53〜0.90 / マージン 0.03〜0.20
 *   誤答トップ1: ncc 最大 0.69 だがマージンは常に ≤0.03
 * スコアの絶対値では正誤を分離できないため、マージンを主判別軸にする。
 */
function computeConfidence(ranked: readonly MatchResult[]): number {
  if (ranked.length === 0) return 0;
  const top1 = ranked[0]!.ncc;
  const margin = ranked.length > 1 ? top1 - ranked[1]!.ncc : 1.0;
  const scoreTerm = clamp01((top1 - 0.45) / 0.15); // ncc 0.45→0, 0.60→1
  const marginTerm = clamp01((margin - 0.02) / 0.04); // 差 0.02→0, 0.06→1
  return Math.sqrt(scoreTerm * marginTerm);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
