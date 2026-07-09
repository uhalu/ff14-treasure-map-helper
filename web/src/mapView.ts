/**
 * 照合DBの言語ビュー。
 * 選択言語で利用できないエントリを除外した DB と、ローカライズ表示・ゾーン名 OCR 照合用の
 * 対応表をまとめて提供する。カメラページと PC 用モードページで共有する。
 */

import { zoneKeyOf, type AppLang } from "./i18n";
import type { MapDatabase, MapEntry } from "./matcher/mapDatabase";

export interface LocalizedMapView {
  /** unavailable 指定・選択言語の地名なしエントリを除外済みの DB。 */
  db: MapDatabase;
  /** 選択言語での OCR 照合用ゾーン名一覧。 */
  ocrZoneNames: string[];
  /** OCR が返した地名 → 言語非依存の zoneKey。 */
  zoneKeyByName: Map<string, string>;
  /** zoneKey → 選択言語での表示地名。 */
  zoneNameByKey: Map<string, string>;
}

/** 選択言語でのゾーン表示名。多言語表を持たない旧DB（SWキャッシュ由来）では ja 地名。 */
export function zoneDisplayName(db: MapDatabase, lang: AppLang, entry: MapEntry): string {
  if (entry.zoneId !== undefined) {
    const name = db.zoneNames?.[String(entry.zoneId)]?.[lang];
    if (name) return name;
  }
  return entry.zone;
}

/** 選択言語での地図アイテム表示名。 */
export function gradeDisplayName(db: MapDatabase, lang: AppLang, entry: MapEntry): string {
  return db.gradeNames?.[entry.grade]?.[lang] ?? entry.gradeName;
}

/** 座標表記はゲーム内の <pos> 形式で全言語共通。 */
export function locationText(db: MapDatabase, lang: AppLang, entry: MapEntry): string {
  return `${zoneDisplayName(db, lang, entry)} (X:${entry.x.toFixed(1)}, Y:${entry.y.toFixed(1)})`;
}

/** NCC スコアを候補リスト向けの一致度 % に変換する。 */
export function matchDegreePct(ncc: number): number {
  return Math.round(Math.max(0, ncc) * 100);
}

/**
 * 選択言語のクライアントに存在しない地図（unavailable 指定、または選択言語の
 * 地名が無いエントリ）を照合・候補・OCRリストのすべてから除外した言語ビューを作る。
 */
export function buildLocalizedMapView(raw: MapDatabase, lang: AppLang): LocalizedMapView {
  const excluded = new Set(raw.unavailable?.[lang] ?? []);
  const entries = raw.entries.filter((e) => {
    if (excluded.has(e.id)) return false;
    if (raw.zoneNames && e.zoneId !== undefined && !raw.zoneNames[String(e.zoneId)]?.[lang]) {
      return false;
    }
    return true;
  });
  const db: MapDatabase = { ...raw, entries };
  const zoneKeyByName = new Map<string, string>();
  const zoneNameByKey = new Map<string, string>();
  for (const e of entries) {
    const key = zoneKeyOf(e);
    const name = zoneDisplayName(db, lang, e);
    zoneKeyByName.set(name, key);
    zoneNameByKey.set(key, name);
  }
  return { db, ocrZoneNames: [...zoneKeyByName.keys()], zoneKeyByName, zoneNameByKey };
}
