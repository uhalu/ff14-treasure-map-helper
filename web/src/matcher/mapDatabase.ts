/**
 * 照合DB maps.json のモデル。
 * JSON は camelCase（version/entries/id/grade/gradeName/zone/x/y/variants/pHash/dHash/vec16/vecBp）。
 */

export interface FeatureSet {
  pHash: bigint;
  dHash: bigint;
  vec16: Uint8Array;
  vecBp: Uint8Array;
}

export interface MapEntry {
  id: string;
  grade: string;
  gradeName: string;
  zone: string;
  /** ゾーンの言語非依存ID（zoneNames のキー）。多言語表を持たない旧DBには無い。 */
  zoneId?: number;
  x: number;
  y: number;
  /** FeatureExtractor.enumerateAlignmentWindows と同順の窓別特徴量。 */
  variants: FeatureSet[];
}

export interface MapDatabase {
  version: number;
  entries: MapEntry[];
  /** ゾーンID（文字列）→ 言語コード → 地名。旧DBには無い。 */
  zoneNames?: Record<string, Record<string, string>>;
  /** グレード（"G1" 等）→ 言語コード → 地図アイテム名。旧DBには無い。 */
  gradeNames?: Record<string, Record<string, string>>;
  /** 言語コード → その言語のクライアントに未実装のエントリ id 一覧。 */
  unavailable?: Record<string, string[]>;
}

/** maps.json の生 JSON 表現（1 窓ぶんの特徴量セット）。 */
interface RawFeatureSet {
  pHash: string; // 16 桁 hex
  dHash: string; // 16 桁 hex
  vec16: string; // base64 256 byte（輝度平均）
  vecBp: string; // base64 256 byte（バンドパス）
}

interface RawMapEntry {
  id: string;
  grade: string;
  gradeName: string;
  zone: string;
  zoneId?: number;
  x: number;
  y: number;
  variants: RawFeatureSet[];
}

export interface RawMapDatabase {
  version: number;
  entries: RawMapEntry[];
  zoneNames?: Record<string, Record<string, string>>;
  gradeNames?: Record<string, Record<string, string>>;
  unavailable?: Record<string, string[]>;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function hexToBigInt(hex: string): bigint {
  return BigInt(`0x${hex}`);
}

function parseFeatureSet(raw: RawFeatureSet): FeatureSet {
  return {
    pHash: hexToBigInt(raw.pHash),
    dHash: hexToBigInt(raw.dHash),
    vec16: base64ToBytes(raw.vec16),
    vecBp: base64ToBytes(raw.vecBp),
  };
}

/**
 * 生 JSON（JSON.parse 済みオブジェクト）から MapDatabase を組み立てる。
 * variants が空のエントリがあれば例外を投げる（旧形式 DB を弾く）。
 */
export function parseMapDatabase(raw: RawMapDatabase): MapDatabase {
  const entries: MapEntry[] = raw.entries.map((e) => {
    if (!e.variants || e.variants.length === 0) {
      throw new Error(
        `maps.json に特徴量のないエントリがあります（旧形式の可能性）: id=${e.id}。DB を再生成してください。`,
      );
    }
    return {
      id: e.id,
      grade: e.grade,
      gradeName: e.gradeName,
      zone: e.zone,
      ...(e.zoneId !== undefined ? { zoneId: e.zoneId } : {}),
      x: e.x,
      y: e.y,
      variants: e.variants.map(parseFeatureSet),
    };
  });
  return {
    version: raw.version,
    entries,
    ...(raw.zoneNames ? { zoneNames: raw.zoneNames } : {}),
    ...(raw.gradeNames ? { gradeNames: raw.gradeNames } : {}),
    ...(raw.unavailable ? { unavailable: raw.unavailable } : {}),
  };
}

/** ブラウザから fetch で maps.json を取得してロードする。 */
export async function fetchMapDatabase(url: string): Promise<MapDatabase> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`maps.json の取得に失敗しました: ${res.status} ${res.statusText}`);
  }
  const raw = (await res.json()) as RawMapDatabase;
  return parseMapDatabase(raw);
}
