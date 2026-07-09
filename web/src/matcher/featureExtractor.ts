import { GrayImage } from "./grayImage";
import { roundHalfEven } from "./mathUtil";

/** 16x16 ベクトル特徴量の一辺と要素数（輝度平均 / バンドパスの両方で共通）。 */
export const VEC_SIDE = 16;
export const VEC_LENGTH = VEC_SIDE * VEC_SIDE;

/**
 * 1 枚の画像から抽出した特徴量。DB にはこれらだけを保存する（生画像は保持しない）。
 */
export interface ImageFeatures {
  /** DCT ベースの perceptual hash（64bit、符号なし）。 */
  pHash: bigint;
  /** 差分ハッシュ（9x8 → 64bit、符号なし）。 */
  dHash: bigint;
  /** 16x16 の輝度平均（0..255）。 */
  vec16: Uint8Array;
  /** 16x16 輝度平均から 3x3 局所平均を引いたバンドパス値（128 中心）。 */
  vecBp: Uint8Array;
}

const DCT_SIZE = 32;
const COS_TABLE = buildCosTable();

function buildCosTable(): Float64Array {
  // CosTable[x * 8 + u] = cos((2x+1) * u * π / (2 * 32))
  const t = new Float64Array(DCT_SIZE * 8);
  for (let x = 0; x < DCT_SIZE; x++) {
    for (let u = 0; u < 8; u++) {
      t[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / (2.0 * DCT_SIZE));
    }
  }
  return t;
}

/**
 * 照合用アライメント窓グリッド。DB 構築側とクエリ側の両方がこの同一グリッドを使うことで、
 * ユーザー切り取りの四辺独立ブレを吸収して照合できる。
 * 内容: 全体フレーム 1 窓 + 原点 (0/6/12%)² × サイズ 88% の 9 窓。
 * 順序（外側ループ l、内側ループ t）は DB 生成側と一致させる。
 */
export function enumerateAlignmentWindows(image: GrayImage): GrayImage[] {
  const windows: GrayImage[] = [image];
  const origins = [0.0, 0.06, 0.12];
  const size = 0.88;
  for (const l of origins) {
    for (const t of origins) {
      windows.push(image.cropRelative(l, t, size, size));
    }
  }
  return windows;
}

/** 全アライメント窓の特徴量を抽出する（DB 構築とクエリで共通）。 */
export function extractWindows(image: GrayImage): ImageFeatures[] {
  return enumerateAlignmentWindows(image).map(extract);
}

export function extract(image: GrayImage): ImageFeatures {
  const pHash = computePHash(image.resizeArea(DCT_SIZE, DCT_SIZE));
  const dHash = computeDHash(image.resizeArea(9, 8));
  const g16 = image.resizeArea(VEC_SIDE, VEC_SIDE);
  return {
    pHash,
    dHash,
    vec16: computeVec16(g16),
    vecBp: computeVecBp(g16),
  };
}

/**
 * 32x32 の 2 次元 DCT-II を取り、低周波 8x8 のうち DC を除く 63 係数の中央値を
 * しきい値として 64bit を立てる（DC のビットは常に 0）。
 */
function computePHash(g32: GrayImage): bigint {
  const dct = computeDctLowFreq(g32.pixels);

  const sorted = Array.from(dct.subarray(1, 64));
  sorted.sort((a, b) => a - b);
  const median = (sorted[30]! + sorted[31]!) / 2;

  let hash = 0n;
  for (let i = 1; i < 64; i++) {
    if (dct[i]! > median) {
      hash |= 1n << BigInt(i);
    }
  }
  return hash;
}

/** 32x32 入力の DCT-II 低周波 8x8 成分を返す（行→列の分離計算）。 */
function computeDctLowFreq(px: Float32Array): Float64Array {
  // 行方向: 各行 y について u=0..7 の 1 次元 DCT
  const rows = new Float64Array(DCT_SIZE * 8);
  for (let y = 0; y < DCT_SIZE; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < DCT_SIZE; x++) {
        sum += px[y * DCT_SIZE + x]! * COS_TABLE[x * 8 + u]!;
      }
      rows[y * 8 + u] = sum;
    }
  }
  // 列方向: v=0..7
  const out64 = new Float64Array(64);
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < DCT_SIZE; y++) {
        sum += rows[y * 8 + u]! * COS_TABLE[y * 8 + v]!;
      }
      out64[v * 8 + u] = sum;
    }
  }
  return out64;
}

/** 9x8 に縮小し、水平方向の隣接輝度差の符号で 64bit を立てる。 */
function computeDHash(g98: GrayImage): bigint {
  let hash = 0n;
  let bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++, bit++) {
      if (g98.pixels[y * 9 + x]! < g98.pixels[y * 9 + x + 1]!) {
        hash |= 1n << BigInt(bit);
      }
    }
  }
  return hash;
}

function computeVec16(g16: GrayImage): Uint8Array {
  const v = new Uint8Array(VEC_LENGTH);
  for (let i = 0; i < v.length; i++) {
    v[i] = clampByte(roundHalfEven(g16.pixels[i]! * 255));
  }
  return v;
}

/**
 * 16x16 ブロック平均から 3x3 局所平均（端はクランプ）を引いたバンドパス値を量子化する。
 * 照明の傾斜・ビネットのような低周波成分を除去する。
 * 量子化: byte = clamp(round(v * 400) + 128)。v の実測レンジは概ね ±0.3。
 */
function computeVecBp(g16: GrayImage): Uint8Array {
  const n = VEC_SIDE;
  const v = new Uint8Array(VEC_LENGTH);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = clamp(y + dy, 0, n - 1);
        for (let dx = -1; dx <= 1; dx++) {
          sum += g16.pixels[yy * n + clamp(x + dx, 0, n - 1)]!;
          count++;
        }
      }
      const bandpass = g16.pixels[y * n + x]! - sum / count;
      v[y * n + x] = clampByte(roundHalfEven(bandpass * 400) + 128);
    }
  }
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampByte(v: number): number {
  return clamp(v, 0, 255);
}

/** 正規化相互相関 (NCC)。明るさ・コントラストの線形変化に不変。-1..1 を返す。 */
export function ncc(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error("ベクトル長が一致しません。");
  }
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
  if (varA <= 1e-9 || varB <= 1e-9) return 0; // 平坦画像は照合不能扱い
  return cov / Math.sqrt(varA * varB);
}

/** 64bit（BigInt, 符号なし）の popcount による Hamming 距離。 */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
