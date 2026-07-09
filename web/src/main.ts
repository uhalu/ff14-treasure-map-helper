import "./style.css";
import { computeCoverSourceRect, computeGuideRect, type Rect } from "./camera/objectFitCover";
import { ScanSession } from "./camera/scanSession";
import { Viewfinder } from "./camera/viewfinder";
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
import { matchSmart } from "./matchStrategy";
import { detectWidgetQuad, rectifyQuad } from "./camera/rectify";
import { ZoneOcr } from "./ocr/zoneOcr";

/** ライブ照合の間隔 (ms)。前回の照合完了後にこの時間を空けて次をスケジュールする（約5fps）。 */
const SCAN_INTERVAL_MS = 200;

/** 表示言語。UI文言・地名表示・OCR照合リストがすべて連動する（変更はリロードで反映）。 */
const lang = detectLang();

/** 現在の表示言語の文言を返す。 */
function msg(key: MsgKey, params?: Record<string, string | number>): string {
  return t(lang, key, params);
}

// --- DOM 参照 --------------------------------------------------------

const videoEl = document.querySelector<HTMLVideoElement>("#video")!;
const captureCanvasEl = document.querySelector<HTMLCanvasElement>("#capture-canvas")!;
const viewfinderEl = document.querySelector<HTMLDivElement>("#viewfinder")!;
const guideFrameEl = document.querySelector<HTMLDivElement>("#guide-frame")!;
const guideHintEl = document.querySelector<HTMLParagraphElement>("#guide-hint")!;

const loadingOverlayEl = document.querySelector<HTMLDivElement>("#loading-overlay")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const retryButtonEl = document.querySelector<HTMLButtonElement>("#retry-button")!;

const cameraFallbackEl = document.querySelector<HTMLDivElement>("#camera-fallback")!;
const cameraFallbackReasonEl = document.querySelector<HTMLParagraphElement>("#camera-fallback-reason")!;

const resultPanelEl = document.querySelector<HTMLDivElement>("#result-panel")!;
const resultZoneEl = document.querySelector<HTMLDivElement>("#result-zone")!;
const resultGradeEl = document.querySelector<HTMLDivElement>("#result-grade")!;
const resultConfidenceEl = document.querySelector<HTMLDivElement>("#result-confidence")!;
const rescanButtonEl = document.querySelector<HTMLButtonElement>("#rescan-button")!;

const candidatesPanelEl = document.querySelector<HTMLDivElement>("#candidates-panel")!;
const candidatesListEl = document.querySelector<HTMLUListElement>("#candidates-list")!;

const captureReviewEl = document.querySelector<HTMLDivElement>("#capture-review")!;
const captureThumbEl = document.querySelector<HTMLImageElement>("#capture-thumb")!;
const ocrStatusEl = document.querySelector<HTMLSpanElement>("#ocr-status")!;
const requireOcrEl = document.querySelector<HTMLInputElement>("#require-ocr")!;
const langSelectEl = document.querySelector<HTMLSelectElement>("#lang-select")!;

// --- アプリ状態 --------------------------------------------------------

let db: MapDatabase | null = null;
let matcher: Matcher | null = null;
let viewfinder: Viewfinder | null = null;
let cameraActive = false;
/** true の間、条件が揃えばライブスキャンを回す（確定表示中やファイル照合結果表示中は false）。 */
let wantScanning = false;
let scanTimer: number | null = null;

const session = new ScanSession();

// --- ゾーン名 OCR ゲート -------------------------------------------------
/** OCR ゲートの有効化フラグ。 */
const OCR_ENABLED = true;
const zoneOcr = new ZoneOcr(TESS_LANG[lang], scriptOf(lang));
/** 選択言語での OCR 照合用ゾーン名一覧。 */
let ocrZoneNames: string[] = [];
/** OCR が返した地名 → 言語非依存の zoneKey。 */
let zoneKeyByName = new Map<string, string>();
/** zoneKey → 選択言語での表示地名。 */
let zoneNameByKey = new Map<string, string>();
let ocrBusy = false;
let lastOcrAttemptMs = 0;
let lastOcrZone: { key: string; atMs: number } | null = null;
/** OCR 結果をフィルタとして使う有効期限 (ms)。構図が変わったら古い結果を使わない。 */
const OCR_ZONE_TTL_MS = 8000;
/** OCR の実行間隔 (ms)。照合ループとは別に低頻度で回す。 */
const OCR_INTERVAL_MS = 2000;

// --- 複数フレーム合成（モアレ・ノイズ抑制） --------------------------------
/** 補正済みフレームのリングバッファ。位相の異なるモアレを平均で打ち消す。 */
const RECTIFIED_BUFFER_MAX = 5;
const RECTIFIED_MAX_AGE_MS = 1600;
const rectifiedBuffer: Array<{ image: GrayImage; atMs: number }> = [];

function pushRectifiedFrame(image: GrayImage, atMs: number): void {
  rectifiedBuffer.push({ image, atMs });
  while (rectifiedBuffer.length > RECTIFIED_BUFFER_MAX) rectifiedBuffer.shift();
}

/** 新しい順に有効期限内のフレームを平均する。3枚未満なら null。 */
function averageRectifiedFrames(nowMs: number): GrayImage | null {
  const fresh = rectifiedBuffer.filter((f) => nowMs - f.atMs <= RECTIFIED_MAX_AGE_MS);
  if (fresh.length < 3) return null;
  const w = fresh[0]!.image.width;
  const h = fresh[0]!.image.height;
  const px = new Float32Array(w * h);
  for (const f of fresh) {
    const p = f.image.pixels;
    for (let i = 0; i < px.length; i++) px[i] += p[i]!;
  }
  for (let i = 0; i < px.length; i++) px[i] /= fresh.length;
  return new GrayImage(w, h, px);
}

// --- 認識画像の表示（補正拡大した地図画像） --------------------------------
/** 直近の照合で使った補正済み地図画像。結果パネルにはこれを表示する。 */
let lastRectifiedForDisplay: GrayImage | null = null;

/** 結果パネルに「補正拡大して認識した地図画像」を表示する。無ければ非表示のまま。 */
function showCaptureReview(): void {
  if (!lastRectifiedForDisplay) {
    captureReviewEl.hidden = true;
    return;
  }
  captureThumbEl.src = grayToCanvas(lastRectifiedForDisplay).toDataURL("image/jpeg", 0.9);
  captureReviewEl.hidden = false;
}

// --- 起動 --------------------------------------------------------------

function init(): void {
  // カメラ起動（権限ダイアログ）と DB フェッチは互いに独立なので並行に開始する。
  // ライブスキャンは matcher・camera 両方の準備が整うまで shouldScan() が false を返し続ける。
  void startCamera();
  void loadDatabase();
}

async function loadDatabase(): Promise<void> {
  showLoading(msg("dbLoading"));
  retryButtonEl.hidden = true;
  try {
    const raw = await fetchMapDatabase("./maps.json");
    const view = buildLocalizedMapView(raw, lang);
    db = view.db;
    matcher = new Matcher(db);
    zoneKeyByName = view.zoneKeyByName;
    zoneNameByKey = view.zoneNameByKey;
    ocrZoneNames = view.ocrZoneNames;
    hideLoading();
    syncLoopRunning();
  } catch (err) {
    matcher = null;
    showLoading(msg("dbLoadFailed", { message: (err as Error).message }));
    retryButtonEl.hidden = false;
  }
}

retryButtonEl.addEventListener("click", () => {
  void loadDatabase();
});

function showLoading(message: string): void {
  statusEl.textContent = message;
  loadingOverlayEl.hidden = false;
}

function hideLoading(): void {
  loadingOverlayEl.hidden = true;
}

// --- カメラ --------------------------------------------------------------

async function startCamera(): Promise<void> {
  viewfinder = new Viewfinder(videoEl);
  try {
    await viewfinder.start();
    cameraActive = true;
    cameraFallbackEl.hidden = true;
    guideFrameEl.classList.remove("hidden");
    guideHintEl.classList.remove("hidden");
    guideHintEl.textContent = msg("defaultHint");
    wantScanning = true;
    syncLoopRunning();
  } catch (err) {
    cameraActive = false;
    guideFrameEl.classList.add("hidden");
    guideHintEl.classList.add("hidden");
    cameraFallbackReasonEl.textContent = describeCameraError(err);
    cameraFallbackEl.hidden = false;
  }
}

function describeCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") {
      return msg("cameraNotAllowed");
    }
    if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
      return msg("cameraNotFound");
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return msg("cameraUnavailable", { message });
}

// --- ライブスキャンループ --------------------------------------------------

/** 現在の条件でライブスキャンを実行してよいか（DB・カメラ準備済み、確定表示中でない、画面が見えている）。 */
function shouldScan(): boolean {
  return (
    wantScanning && cameraActive && matcher !== null && document.visibilityState === "visible"
  );
}

/**
 * shouldScan() の結果に応じてタイマーと video デコードの再生/停止を同期する。呼ぶだけで冪等。
 * 確定表示中・ファイル照合結果表示中・バックグラウンド化など、スキャンを止める理由を問わず
 * ここに一本化することで、停止時は必ず video デコードも止まる（省電力）。
 */
function syncLoopRunning(): void {
  if (shouldScan()) {
    if (scanTimer === null) {
      viewfinder?.resume();
      scheduleNextTick(0);
    }
  } else {
    if (scanTimer !== null) {
      window.clearTimeout(scanTimer);
      scanTimer = null;
    }
    viewfinder?.pause();
  }
}

function scheduleNextTick(delay: number): void {
  scanTimer = window.setTimeout(() => {
    void runScanTick();
  }, delay);
}

document.addEventListener("visibilitychange", () => {
  // バックグラウンド化で撮影・照合・video デコードを止め、復帰時のみ再開する（省電力）。
  // shouldScan() が visibilityState を見ているので、syncLoopRunning() だけで両方向を処理できる。
  syncLoopRunning();
});

async function runScanTick(): Promise<void> {
  scanTimer = null;
  if (!shouldScan()) return;

  try {
    const geometry = computeGuideAndSourceRect();
    if (geometry) {
      updateGuideOverlay(geometry.guideRect);
      const imageData = viewfinder!.captureRegion(geometry.sourceRect, captureCanvasEl);
      const grayFull = GrayImage.fromImageData(imageData);
      // 照合用は 560px 幅までに抑える（特徴量は 32/16px まで縮めるので精度影響なし、
      // 高解像度キャプチャのままだと窓グリッド抽出が重い）。補正・OCR は高解像度側を使う。
      const gray =
        grayFull.width > 560
          ? grayFull.resizeArea(560, Math.max(1, Math.round((grayFull.height * 560) / grayFull.width)))
          : grayFull;
      const quad = detectWidgetQuad(grayFull);
      // 地図が枠に対して小さすぎる（横幅3割未満）ときは動的に「寄って」を案内する
      const widgetTooSmall =
        quad !== null &&
        Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y) < grayFull.width * 0.3;
      const rectified = quad ? rectifyQuad(grayFull, quad) : null;
      if (rectified) {
        pushRectifiedFrame(rectified, performance.now());
        lastRectifiedForDisplay = rectified;
      }
      if (grayFull.width >= 450) {
        // OCR には高解像度の補正画像を使う（文字が細く、439px では潰れる）
        const rectifiedForOcr =
          quad && grayFull.width > 600 ? rectifyQuad(grayFull, quad, 878, 760) : rectified;
        maybeRunZoneOcr(rectifiedForOcr ?? grayFull);
      }

      const now = performance.now();
      const ocrZoneKey =
        lastOcrZone && now - lastOcrZone.atMs < OCR_ZONE_TTL_MS ? lastOcrZone.key : null;
      let outcome = matchSmart(matcher!, gray, { rectified, zoneKey: ocrZoneKey });
      if (!outcome.isConfident) {
        // 複数フレーム合成: 補正済みフレームは同一座標系なので位置合わせなしで平均でき、
        // モアレ・センサノイズが打ち消される（フレームごとに位相が変わるため）。
        const averaged = averageRectifiedFrames(performance.now());
        if (averaged) {
          const avgOutcome = matchSmart(matcher!, averaged, {
            rectified: null,
            zoneKey: ocrZoneKey,
          });
          if (avgOutcome.confidence > outcome.confidence) outcome = avgOutcome;
        }
      }
      const update = session.observe(
        outcome,
        now,
        ocrZoneKey,
        requireOcrEl.checked && OCR_ENABLED,
      );

      if (update.confirmed) {
        showConfirmedResult(update.confirmed, outcome.confidence, update.via);
        if (update.via === "ocrStable") {
          // マージン圧縮時のOCR安定確定は、検証しやすいよう候補リストも残す
          showCandidates(outcome.candidates);
        } else {
          hideCandidates();
        }
        wantScanning = false;
        syncLoopRunning();
        return;
      }
      if (update.showCandidates) {
        // OCR必須がオフのときは、精度改善の手段としてオンにすることを案内する
        guideHintEl.textContent = requireOcrEl.checked
          ? msg("hintAdjust")
          : `${msg("hintAdjust")} ${msg("hintEnableOcr")}`;
        showCandidates(outcome.candidates);
      } else {
        hideCandidates();
        guideHintEl.textContent = ocrZoneKey
          ? msg("hintZoneLocked", { zone: zoneNameByKey.get(ocrZoneKey) ?? ocrZoneKey })
          : widgetTooSmall
            ? msg("hintTooSmall")
            : msg("defaultHint");
      }
    }
  } catch (err) {
    console.warn("ライブ照合でエラーが発生しました:", err);
  }

  if (shouldScan()) {
    scheduleNextTick(SCAN_INTERVAL_MS);
  }
}

/**
 * ゾーン名 OCR を低頻度・非同期で回す。結果はフィルタとして次回以降の照合に使う。
 * 初回呼び出しでワーカー（自己ホストの選択言語モデル、SW がキャッシュ）を温める。
 */
function maybeRunZoneOcr(image: GrayImage): void {
  if (!OCR_ENABLED) return;
  const now = performance.now();
  if (ocrBusy || now - lastOcrAttemptMs < OCR_INTERVAL_MS || ocrZoneNames.length === 0) return;
  ocrBusy = true;
  lastOcrAttemptMs = now;
  zoneOcr
    .recognizeZone(image, ocrZoneNames)
    .then((zone) => {
      const key = zone ? zoneKeyByName.get(zone) : undefined;
      if (key) lastOcrZone = { key, atMs: performance.now() };
    })
    .catch(() => {
      // OCR 失敗時は従来どおり絵柄のみで照合する（ゲート不発）。
    })
    .finally(() => {
      ocrBusy = false;
      updateOcrStatus();
    });
  updateOcrStatus();
}

/** 画面下部の OCR 状態表示を更新する。 */
function updateOcrStatus(): void {
  if (!OCR_ENABLED) {
    ocrStatusEl.textContent = "";
    return;
  }
  const now = performance.now();
  const zoneKey =
    lastOcrZone && now - lastOcrZone.atMs < OCR_ZONE_TTL_MS ? lastOcrZone.key : null;
  switch (zoneOcr.status) {
    case "idle":
      ocrStatusEl.textContent = "";
      break;
    case "loading":
      ocrStatusEl.textContent = msg("ocrLoading");
      break;
    case "ready":
      ocrStatusEl.textContent = zoneKey
        ? msg("ocrZone", { zone: zoneNameByKey.get(zoneKey) ?? zoneKey })
        : msg("ocrSearching");
      ocrStatusEl.classList.toggle("ocr-hit", zoneKey !== null);
      break;
    case "failed":
      ocrStatusEl.textContent = msg("ocrDisabled");
      ocrStatusEl.title = zoneOcr.errorMessage;
      break;
  }
}

/** ビューファインダのガイド枠（コンテナ座標）と、それに対応する video ソース矩形を求める。 */
function computeGuideAndSourceRect(): { guideRect: Rect; sourceRect: Rect } | null {
  const containerSize = { width: viewfinderEl.clientWidth, height: viewfinderEl.clientHeight };
  if (containerSize.width === 0 || containerSize.height === 0) return null;
  const videoSize = viewfinder!.videoSize;
  if (videoSize.width === 0 || videoSize.height === 0) return null;

  const guideRect = computeGuideRect(containerSize);
  const sourceRect = computeCoverSourceRect(videoSize, containerSize, guideRect);
  return { guideRect, sourceRect };
}

function updateGuideOverlay(guideRect: Rect): void {
  guideFrameEl.style.left = `${guideRect.x}px`;
  guideFrameEl.style.top = `${guideRect.y}px`;
  guideFrameEl.style.width = `${guideRect.width}px`;
  guideFrameEl.style.height = `${guideRect.height}px`;
  // ヒント文言はガイド枠の横幅で折り返し、常に枠上端のすぐ上に置く
  // （画面下部は候補パネル・結果パネルと重なるため）。枠上の余白が足りない
  // 画面では画面上端で止める
  guideHintEl.style.maxWidth = `${guideRect.width}px`;
  const containerH = viewfinderEl.clientHeight;
  const bottom = Math.min(
    containerH - guideRect.y + 8,
    containerH - guideHintEl.offsetHeight - 4,
  );
  guideHintEl.style.bottom = `${bottom}px`;
}

// --- 結果表示 --------------------------------------------------------------

function renderResultPanel(entry: MapEntry, confidencePct: number, confident: boolean): void {
  resultZoneEl.textContent = locationText(db!, lang, entry);
  resultGradeEl.textContent = gradeDisplayName(db!, lang, entry);
  resultConfidenceEl.textContent = msg("confidence", { pct: confidencePct });
  resultPanelEl.classList.toggle("confident", confident);
  resultPanelEl.classList.toggle("unsure", !confident);
  resultPanelEl.hidden = false;
  showCaptureReview();
}

function showConfirmedResult(
  match: MatchResult,
  confidence: number,
  via: "score" | "ocrStable" | null,
): void {
  renderResultPanel(match.entry, Math.round(confidence * 100), true);
  if (via === "ocrStable") {
    resultConfidenceEl.textContent = msg("confidenceOcrStable", {
      pct: Math.round(confidence * 100),
    });
  }
  navigator.vibrate?.(100);
}

function hideResultPanel(): void {
  resultPanelEl.hidden = true;
  captureReviewEl.hidden = true;
}

rescanButtonEl.addEventListener("click", () => {
  hideResultPanel();
  hideCandidates();
  session.reset();
  rectifiedBuffer.length = 0;
  wantScanning = true;
  syncLoopRunning();
});

// --- 低信頼時の候補パネル ----------------------------------------------------

function showCandidates(candidates: readonly MatchResult[]): void {
  if (candidates.length === 0) {
    hideCandidates();
    return;
  }
  candidatesListEl.innerHTML = "";
  for (const c of candidates.slice(0, 3)) {
    const li = document.createElement("li");
    li.textContent = `${locationText(db!, lang, c.entry)} ・${msg("matchDegree", { pct: matchDegreePct(c.ncc) })}`;
    li.tabIndex = 0;
    li.addEventListener("click", () => adoptCandidate(c));
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        adoptCandidate(c);
      }
    });
    candidatesListEl.appendChild(li);
  }
  candidatesPanelEl.hidden = false;
}

function hideCandidates(): void {
  candidatesPanelEl.hidden = true;
}

function adoptCandidate(candidate: MatchResult): void {
  hideCandidates();
  renderResultPanel(candidate.entry, matchDegreePct(candidate.ncc), false);
  session.reset();
  wantScanning = false;
  syncLoopRunning();
}

// --- Service Worker ----------------------------------------------------------

{
  const el = document.querySelector<HTMLSpanElement>("#build-id");
  if (el) el.textContent = __BUILD_ID__;
}

// 「OCR認識を必須にする」の永続化（既定 OFF。誤認識が続くときにユーザーがオンにする）
{
  const saved = localStorage.getItem("requireOcr");
  requireOcrEl.checked = saved === "1";
  requireOcrEl.addEventListener("change", () => {
    localStorage.setItem("requireOcr", requireOcrEl.checked ? "1" : "0");
  });
}

// 言語設定: 静的文言を差し替え、変更時はリロードで OCR・照合母集団ごと再初期化する
{
  applyStatic(lang);
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

init();
