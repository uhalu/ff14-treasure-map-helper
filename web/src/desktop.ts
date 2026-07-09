import "./style.css";
import { bytesToHex, fitWithin, isImageMime, matchScreenshot } from "./desktopMatch";
import { grayToCanvas } from "./grayCanvas";
import {
  applyStatic,
  detectLang,
  LANG_STORAGE_KEY,
  scriptOf,
  t,
  TESS_LANG,
  type MsgKey,
} from "./i18n";
import {
  buildLocalizedMapView,
  gradeDisplayName,
  locationText,
  matchDegreePct,
} from "./mapView";
import { GrayImage } from "./matcher/grayImage";
import type { MapDatabase, MapEntry } from "./matcher/mapDatabase";
import { fetchMapDatabase } from "./matcher/mapDatabase";
import { Matcher, type MatchResult } from "./matcher/matcher";
import { ZoneOcr } from "./ocr/zoneOcr";

/** デコード時に許容する最大幅。4K スクショはこの幅に縮小してから処理する。 */
const DECODE_MAX_WIDTH = 1200;
/** ゾーン名 OCR の待ち時間上限 (ms)。超えたら OCR なしの結果で表示する。 */
const OCR_TIMEOUT_MS = 4000;
/** コピー完了フィードバックの表示時間 (ms)。 */
const COPY_FEEDBACK_MS = 1500;
/** 自動読み取り設定の localStorage キー。 */
const AUTO_READ_STORAGE_KEY = "autoReadClipboard";

/** 表示言語。UI文言・地名表示・OCR照合リストがすべて連動する（変更はリロードで反映）。 */
const lang = detectLang();

function msg(key: MsgKey, params?: Record<string, string | number>): string {
  return t(lang, key, params);
}

// --- DOM 参照 --------------------------------------------------------

const dropZoneEl = document.querySelector<HTMLDivElement>("#drop-zone")!;
const desktopStatusEl = document.querySelector<HTMLParagraphElement>("#desktop-status")!;
const fileButtonEl = document.querySelector<HTMLButtonElement>("#file-button")!;
const fileInputEl = document.querySelector<HTMLInputElement>("#file-input")!;

const loadingOverlayEl = document.querySelector<HTMLDivElement>("#loading-overlay")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const retryButtonEl = document.querySelector<HTMLButtonElement>("#retry-button")!;

const resultPanelEl = document.querySelector<HTMLDivElement>("#result-panel")!;
const resultZoneEl = document.querySelector<HTMLDivElement>("#result-zone")!;
const resultGradeEl = document.querySelector<HTMLDivElement>("#result-grade")!;
const resultConfidenceEl = document.querySelector<HTMLDivElement>("#result-confidence")!;
const captureReviewEl = document.querySelector<HTMLDivElement>("#capture-review")!;
const captureThumbEl = document.querySelector<HTMLImageElement>("#capture-thumb")!;
const copyButtonEl = document.querySelector<HTMLButtonElement>("#copy-button")!;
const copyFeedbackEl = document.querySelector<HTMLParagraphElement>("#copy-feedback")!;

const candidatesPanelEl = document.querySelector<HTMLDivElement>("#candidates-panel")!;
const candidatesListEl = document.querySelector<HTMLUListElement>("#candidates-list")!;

const autoReadLabelEl = document.querySelector<HTMLLabelElement>("#auto-read-label")!;
const autoReadEl = document.querySelector<HTMLInputElement>("#auto-read")!;
const ocrStatusEl = document.querySelector<HTMLSpanElement>("#ocr-status")!;
const langSelectEl = document.querySelector<HTMLSelectElement>("#lang-select")!;

// --- アプリ状態 --------------------------------------------------------

let db: MapDatabase | null = null;
let matcher: Matcher | null = null;
/** OCR 照合用ゾーン名一覧と、地名 ↔ zoneKey の対応表。 */
let ocrZoneNames: string[] = [];
let zoneKeyByName = new Map<string, string>();

const zoneOcr = new ZoneOcr(TESS_LANG[lang], scriptOf(lang));

/** 照合処理の実行中フラグと、実行中に届いた最新1件の持ち越し。 */
let busy = false;
let pendingBlob: Blob | null = null;
/** 直近に照合した画像の SHA-256。フォーカス時自動読み取りの二重照合防止に使う。 */
let lastImageHash: string | null = null;
/** 現在表示中の結果文字列（コピーボタンの対象）。 */
let currentResultText: string | null = null;
let copyFeedbackTimer: number | null = null;

// --- 起動 --------------------------------------------------------------

async function loadDatabase(): Promise<void> {
  statusEl.textContent = msg("dbLoading");
  loadingOverlayEl.hidden = false;
  retryButtonEl.hidden = true;
  try {
    const raw = await fetchMapDatabase("./maps.json");
    const view = buildLocalizedMapView(raw, lang);
    db = view.db;
    matcher = new Matcher(db);
    zoneKeyByName = view.zoneKeyByName;
    ocrZoneNames = view.ocrZoneNames;
    loadingOverlayEl.hidden = true;
  } catch (err) {
    matcher = null;
    statusEl.textContent = msg("dbLoadFailed", { message: (err as Error).message });
    retryButtonEl.hidden = false;
  }
}

retryButtonEl.addEventListener("click", () => {
  void loadDatabase();
});

// --- ステータス表示 ------------------------------------------------------

function showStatus(text: string): void {
  desktopStatusEl.textContent = text;
  desktopStatusEl.hidden = false;
}

function hideStatus(): void {
  desktopStatusEl.hidden = true;
}

/** 下部バーの OCR 状態表示（読込中・使用不可のときだけ出す）。 */
function updateOcrStatus(): void {
  switch (zoneOcr.status) {
    case "loading":
      ocrStatusEl.textContent = msg("ocrLoading");
      break;
    case "failed":
      ocrStatusEl.textContent = msg("ocrDisabled");
      ocrStatusEl.title = zoneOcr.errorMessage;
      break;
    default:
      ocrStatusEl.textContent = "";
  }
}

// --- 画像入力（4経路 → handleBlob に合流） --------------------------------

document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === "file" && isImageMime(item.type)) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        void enqueueBlob(file);
        return;
      }
    }
  }
  showStatus(msg("pasteNoImage"));
});

window.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  dropZoneEl.classList.add("drag-over");
});

window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) dropZoneEl.classList.remove("drag-over");
});

window.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZoneEl.classList.remove("drag-over");
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => isImageMime(f.type));
  if (file) {
    void enqueueBlob(file);
  } else {
    showStatus(msg("pasteNoImage"));
  }
});

fileButtonEl.addEventListener("click", () => fileInputEl.click());
fileInputEl.addEventListener("change", () => {
  const file = fileInputEl.files?.[0];
  if (file && isImageMime(file.type)) void enqueueBlob(file);
  // 同じファイルを選び直しても change が発火するようにリセットする
  fileInputEl.value = "";
});

// --- フォーカス時のクリップボード自動読み取り（対応ブラウザのみ） ------------

{
  const supported = typeof navigator.clipboard?.read === "function";
  if (supported) {
    autoReadLabelEl.hidden = false;
    autoReadEl.checked = localStorage.getItem(AUTO_READ_STORAGE_KEY) === "1";
    autoReadEl.addEventListener("change", () => {
      localStorage.setItem(AUTO_READ_STORAGE_KEY, autoReadEl.checked ? "1" : "0");
    });
    window.addEventListener("focus", () => {
      if (autoReadEl.checked) void readClipboardImage();
    });
  }
}

async function readClipboardImage(): Promise<void> {
  if (busy || matcher === null) return;
  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const type = item.types.find(isImageMime);
      if (!type) continue;
      const blob = await item.getType(type);
      // 手動貼り付け済み・処理済みと同じ画像なら黙ってスキップする
      if ((await hashBlob(blob)) === lastImageHash) return;
      void enqueueBlob(blob);
      return;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      autoReadEl.checked = false;
      localStorage.setItem(AUTO_READ_STORAGE_KEY, "0");
      showStatus(msg("clipboardDenied"));
    }
    // 画像なし・フォーカス喪失などは無視して次の機会を待つ
  }
}

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return bytesToHex(digest);
}

// --- 照合パイプライン ------------------------------------------------------

/** 実行中なら最新の1件だけ持ち越す（連続貼り付け対策）。 */
async function enqueueBlob(blob: Blob): Promise<void> {
  if (busy) {
    pendingBlob = blob;
    return;
  }
  busy = true;
  try {
    let current: Blob | null = blob;
    while (current) {
      await processBlob(current);
      current = pendingBlob;
      pendingBlob = null;
    }
  } finally {
    busy = false;
  }
}

async function processBlob(blob: Blob): Promise<void> {
  if (matcher === null || db === null) return;
  hideResult();
  hideCandidates();
  showStatus(msg("matching"));
  // 鑑定演出（フラッシュ＋スキャンビーム）。付け直しでアニメーションを再始動させる
  dropZoneEl.classList.remove("matching");
  void dropZoneEl.offsetWidth;
  dropZoneEl.classList.add("matching");
  try {
    let decoded: { gray: GrayImage; canvas: HTMLCanvasElement };
    try {
      lastImageHash = await hashBlob(blob);
      decoded = await decodeBlob(blob);
    } catch {
      showStatus(msg("decodeFailed"));
      return;
    }
    try {
      const { gray: grayFull, canvas } = decoded;
      let result = matchScreenshot(matcher, grayFull);
      if (!result.outcome.isConfident) {
        // 非確定時のみゾーン名 OCR を1回だけ試し、読めたらそのゾーンに絞って照合し直す
        showStatus(msg("checkingZone"));
        updateOcrStatus();
        const zoneKey = await recognizeZoneKey(result.ocrImage);
        updateOcrStatus();
        if (zoneKey) {
          const gated = matchScreenshot(matcher, grayFull, zoneKey);
          if (gated.outcome.confidence > result.outcome.confidence) result = gated;
        }
      }
      hideStatus();
      const preview = result.rectified ? grayToCanvas(result.rectified) : canvas;
      if (result.outcome.isConfident) {
        showResult(result.outcome.best!, msg("confidence", {
          pct: Math.round(result.outcome.confidence * 100),
        }), true, preview);
        void copyResultText();
      } else {
        showCandidates(result.outcome.candidates, preview);
      }
    } catch (err) {
      console.warn("照合でエラーが発生しました:", err);
      showStatus(msg("decodeFailed"));
    }
  } finally {
    dropZoneEl.classList.remove("matching");
  }
}

/** Blob をデコードし、幅 1200px 以内に収めた canvas とグレースケール画像を返す。 */
async function decodeBlob(blob: Blob): Promise<{ gray: GrayImage; canvas: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const size = fitWithin(bitmap.width, bitmap.height, DECODE_MAX_WIDTH);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const gray = GrayImage.fromImageData(ctx.getImageData(0, 0, size.width, size.height));
    return { gray, canvas };
  } finally {
    bitmap.close();
  }
}

/** ゾーン名 OCR を1回だけ実行し、zoneKey を返す（失敗・タイムアウトは null）。 */
async function recognizeZoneKey(image: GrayImage): Promise<string | null> {
  if (ocrZoneNames.length === 0) return null;
  const timeout = new Promise<null>((resolve) => {
    window.setTimeout(() => resolve(null), OCR_TIMEOUT_MS);
  });
  try {
    const zone = await Promise.race([zoneOcr.recognizeZone(image, ocrZoneNames), timeout]);
    return (zone && zoneKeyByName.get(zone)) || null;
  } catch {
    return null;
  }
}

// --- 結果表示とコピー -------------------------------------------------------

function showResult(
  match: MatchResult,
  confidenceText: string,
  confident: boolean,
  preview: HTMLCanvasElement,
): void {
  currentResultText = locationText(db!, lang, match.entry);
  resultZoneEl.textContent = currentResultText;
  resultGradeEl.textContent = gradeDisplayName(db!, lang, match.entry);
  resultConfidenceEl.textContent = confidenceText;
  resultPanelEl.classList.toggle("confident", confident);
  resultPanelEl.classList.toggle("unsure", !confident);
  captureThumbEl.src = preview.toDataURL("image/jpeg", 0.9);
  captureReviewEl.hidden = false;
  copyFeedbackEl.hidden = true;
  resultPanelEl.hidden = false;
}

function hideResult(): void {
  resultPanelEl.hidden = true;
  currentResultText = null;
}

/** 現在の結果文字列をクリップボードへコピーする。成功時はフィードバックを一定時間表示。 */
async function copyResultText(): Promise<void> {
  if (!currentResultText) return;
  try {
    await navigator.clipboard.writeText(currentResultText);
    copyFeedbackEl.hidden = false;
    if (copyFeedbackTimer !== null) window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = window.setTimeout(() => {
      copyFeedbackEl.hidden = true;
      copyFeedbackTimer = null;
    }, COPY_FEEDBACK_MS);
  } catch {
    // 自動コピーが許可されない環境ではコピーボタンからの操作に任せる
  }
}

copyButtonEl.addEventListener("click", () => {
  void copyResultText();
});

// --- 低信頼時の候補パネル ----------------------------------------------------

function showCandidates(candidates: readonly MatchResult[], preview: HTMLCanvasElement): void {
  if (candidates.length === 0) {
    showStatus(msg("pasteNoImage"));
    return;
  }
  candidatesListEl.innerHTML = "";
  for (const c of candidates.slice(0, 3)) {
    const li = document.createElement("li");
    li.textContent = `${locationText(db!, lang, c.entry)} ・${msg("matchDegree", { pct: matchDegreePct(c.ncc) })}`;
    li.tabIndex = 0;
    const adopt = () => {
      hideCandidates();
      showResult(c, msg("matchDegree", { pct: matchDegreePct(c.ncc) }), false, preview);
      void copyResultText();
    };
    li.addEventListener("click", adopt);
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        adopt();
      }
    });
    candidatesListEl.appendChild(li);
  }
  candidatesPanelEl.hidden = false;
}

function hideCandidates(): void {
  candidatesPanelEl.hidden = true;
}

// --- 言語・ビルドID・Service Worker ------------------------------------------

{
  const el = document.querySelector<HTMLSpanElement>("#build-id");
  if (el) el.textContent = __BUILD_ID__;
}

{
  applyStatic(lang, "desktopTitle");
  langSelectEl.value = lang;
  langSelectEl.addEventListener("change", () => {
    localStorage.setItem(LANG_STORAGE_KEY, langSelectEl.value);
    location.reload();
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service Worker の登録に失敗しました:", err);
    });
  });
}

void loadDatabase();
// OCR ワーカーは初回の非確定照合まで使わないが、先に温めておくと待ちがなくなる。
// 読込完了（または失敗）まで状態表示を追従させる
zoneOcr.warmUp();
updateOcrStatus();
const ocrStatusPoll = window.setInterval(() => {
  updateOcrStatus();
  if (zoneOcr.status === "ready" || zoneOcr.status === "failed") {
    window.clearInterval(ocrStatusPoll);
  }
}, 500);
