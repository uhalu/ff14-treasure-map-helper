/**
 * UI 文言と言語設定の中枢。
 * - 対応言語は FF14 クライアントの提供言語（日英独仏韓・簡体字中国語）
 * - UI 表示言語・地名表示・OCR モデルは単一の言語設定に連動する
 * - 地名/地図名はゲームデータ由来（maps.json の zoneNames/gradeNames）で、ここには持たない
 */

import type { MapEntry } from "./matcher/mapDatabase";

export const APP_LANGS = ["ja", "en", "de", "fr", "ko", "zh"] as const;
export type AppLang = (typeof APP_LANGS)[number];

/** 言語設定の localStorage キー。 */
export const LANG_STORAGE_KEY = "lang";

/** OCR（tesseract）の言語データ名。public/ocr/lang/<名前>.traineddata.gz に対応する。 */
export const TESS_LANG: Record<AppLang, string> = {
  ja: "jpn",
  en: "eng",
  de: "deu",
  fr: "fra",
  ko: "kor",
  zh: "chi_sim",
};

/** OCR テキスト正規化に使う文字体系。en/de/fr はラテン文字として共通処理する。 */
export type Script = "ja" | "latin" | "ko" | "zh";
export function scriptOf(lang: AppLang): Script {
  return lang === "en" || lang === "de" || lang === "fr" ? "latin" : lang;
}

const ja = {
  appTitle: "FF14 宝の地図 照合",
  guideHintInitial: "地図をこの枠に合わせてください",
  defaultHint: "地図がこの枠内に入るようにカメラを向けてください（離れていてもOK）",
  hintAdjust:
    "認識できないときは、距離や角度を少し変えてみてください（画面の縞模様が消える位置があります）",
  hintEnableOcr: "誤認識が続く場合は「OCR認識を必須にする」をオンにしてください",
  hintZoneLocked: "ゾーン認識: {zone} — そのまま少し静止してください",
  hintTooSmall: "地図が小さすぎます。もう少し寄ってください",
  candidatesTitle: "候補（タップで採用）",
  rescan: "再スキャン",
  retry: "再試行",
  requireOcr: "OCR認識を必須にする",
  captureAlt: "認識した地図画像",
  dbLoading: "DB を読み込み中…",
  dbLoadFailed: "DB の読み込みに失敗しました: {message}",
  cameraNotAllowed: "カメラの使用が許可されていません。",
  cameraNotFound: "利用できる背面カメラが見つかりませんでした。",
  cameraUnavailable: "カメラを利用できません（{message}）。",
  ocrLoading: "OCR読込中…",
  ocrZone: "ゾーン: {zone}",
  ocrSearching: "ゾーン名を探しています",
  ocrDisabled: "OCR無効",
  confidence: "信頼度 {pct}%",
  confidenceOcrStable: "信頼度 {pct}%（OCR安定）",
  matchDegree: "一致度 {pct}%",
  desktopTitle: "FF14 宝の地図 照合（PC用）",
  desktopModeLink: "PC用モード（スクショ貼り付け）",
  cameraModeLink: "カメラモードへ",
  desktopModeShortLink: "PC用モードへ",
  dropHint:
    "ゲーム内で解読した地図ウィンドウを Win+Shift+S で切り取り、ここに Ctrl+V で貼り付けてください（画像のドロップ・ファイル選択も可）",
  selectFile: "画像ファイルを選択",
  pasteNoImage: "クリップボードに画像がありません。地図を切り取ってから貼り付けてください",
  decodeFailed: "画像を読み込めませんでした",
  matching: "照合中…",
  checkingZone: "ゾーン名を確認しています…",
  copyResult: "結果をコピー",
  copied: "コピーしました",
  autoReadClipboard: "このページに戻ったとき自動で貼り付ける",
  clipboardDenied: "クリップボードの読み取りが許可されていません。Ctrl+V で貼り付けてください",
} as const;

export type MsgKey = keyof typeof ja;

const en: Record<MsgKey, string> = {
  appTitle: "FFXIV Treasure Map Finder",
  guideHintInitial: "Align the map within this frame",
  defaultHint: "Point your camera so the map fits inside this frame (distance doesn't matter)",
  hintAdjust:
    "If it isn't recognized, try changing the distance or angle slightly (the on-screen moiré disappears at some position)",
  hintEnableOcr: 'If it keeps being misidentified, turn on "Require OCR zone match".',
  hintZoneLocked: "Zone detected: {zone} — hold still for a moment",
  hintTooSmall: "The map is too small. Move a little closer",
  candidatesTitle: "Candidates (tap to select)",
  rescan: "Rescan",
  retry: "Retry",
  requireOcr: "Require OCR zone match",
  captureAlt: "Recognized map image",
  dbLoading: "Loading database…",
  dbLoadFailed: "Failed to load the database: {message}",
  cameraNotAllowed: "Camera access was denied.",
  cameraNotFound: "No usable rear camera was found.",
  cameraUnavailable: "The camera is unavailable ({message}).",
  ocrLoading: "Loading OCR…",
  ocrZone: "Zone: {zone}",
  ocrSearching: "Looking for the zone name",
  ocrDisabled: "OCR unavailable",
  confidence: "Confidence {pct}%",
  confidenceOcrStable: "Confidence {pct}% (OCR stable)",
  matchDegree: "Match {pct}%",
  desktopTitle: "FFXIV Treasure Map Finder (PC)",
  desktopModeLink: "PC mode (paste a screenshot)",
  cameraModeLink: "Camera mode",
  desktopModeShortLink: "PC mode",
  dropHint:
    "Snip the decoded map window with Win+Shift+S, then paste it here with Ctrl+V (you can also drop an image or choose a file)",
  selectFile: "Choose an image file",
  pasteNoImage: "No image in the clipboard. Snip the map first, then paste.",
  decodeFailed: "Could not load the image",
  matching: "Matching…",
  checkingZone: "Checking the zone name…",
  copyResult: "Copy result",
  copied: "Copied!",
  autoReadClipboard: "Paste automatically when returning to this page",
  clipboardDenied: "Clipboard access was denied. Paste with Ctrl+V instead.",
};

const de: Record<MsgKey, string> = {
  appTitle: "FFXIV Schatzkarten-Erkennung",
  guideHintInitial: "Richte die Karte in diesem Rahmen aus",
  defaultHint:
    "Richte die Kamera so aus, dass die Karte in diesen Rahmen passt (Abstand egal)",
  hintAdjust:
    "Wird die Karte nicht erkannt, ändere leicht Abstand oder Winkel (in einer bestimmten Position verschwindet das Moiré-Muster)",
  hintEnableOcr: "Bei anhaltenden Fehlerkennungen aktiviere „OCR-Gebietsabgleich erforderlich“.",
  hintZoneLocked: "Gebiet erkannt: {zone} — bitte kurz stillhalten",
  hintTooSmall: "Die Karte ist zu klein. Geh etwas näher heran",
  candidatesTitle: "Kandidaten (zum Übernehmen tippen)",
  rescan: "Neu scannen",
  retry: "Erneut versuchen",
  requireOcr: "OCR-Gebietsabgleich erforderlich",
  captureAlt: "Erkanntes Kartenbild",
  dbLoading: "Datenbank wird geladen…",
  dbLoadFailed: "Datenbank konnte nicht geladen werden: {message}",
  cameraNotAllowed: "Kamerazugriff wurde verweigert.",
  cameraNotFound: "Keine nutzbare Rückkamera gefunden.",
  cameraUnavailable: "Kamera nicht verfügbar ({message}).",
  ocrLoading: "OCR wird geladen…",
  ocrZone: "Gebiet: {zone}",
  ocrSearching: "Suche nach dem Gebietsnamen",
  ocrDisabled: "OCR nicht verfügbar",
  confidence: "Konfidenz {pct}%",
  confidenceOcrStable: "Konfidenz {pct}% (OCR stabil)",
  matchDegree: "Übereinstimmung {pct}%",
  desktopTitle: "FFXIV Schatzkarten-Erkennung (PC)",
  desktopModeLink: "PC-Modus (Screenshot einfügen)",
  cameraModeLink: "Kameramodus",
  desktopModeShortLink: "PC-Modus",
  dropHint:
    "Schneide das entschlüsselte Kartenfenster mit Win+Shift+S aus und füge es hier mit Strg+V ein (Bild ablegen oder Datei auswählen geht auch)",
  selectFile: "Bilddatei auswählen",
  pasteNoImage:
    "Kein Bild in der Zwischenablage. Schneide zuerst die Karte aus und füge sie dann ein.",
  decodeFailed: "Bild konnte nicht geladen werden",
  matching: "Abgleich läuft…",
  checkingZone: "Gebietsname wird geprüft…",
  copyResult: "Ergebnis kopieren",
  copied: "Kopiert!",
  autoReadClipboard: "Beim Zurückkehren zu dieser Seite automatisch einfügen",
  clipboardDenied:
    "Zugriff auf die Zwischenablage wurde verweigert. Füge stattdessen mit Strg+V ein.",
};

const fr: Record<MsgKey, string> = {
  appTitle: "FFXIV Identification de cartes au trésor",
  guideHintInitial: "Alignez la carte dans ce cadre",
  defaultHint:
    "Orientez la caméra pour que la carte tienne dans ce cadre (peu importe la distance)",
  hintAdjust:
    "Si la carte n'est pas reconnue, modifiez légèrement la distance ou l'angle (le moiré à l'écran disparaît à une certaine position)",
  hintEnableOcr:
    "En cas d'erreurs répétées, activez « Exiger la correspondance OCR de la zone ».",
  hintZoneLocked: "Zone détectée : {zone} — restez immobile un instant",
  hintTooSmall: "La carte est trop petite. Rapprochez-vous un peu",
  candidatesTitle: "Candidats (touchez pour choisir)",
  rescan: "Rescanner",
  retry: "Réessayer",
  requireOcr: "Exiger la correspondance OCR de la zone",
  captureAlt: "Image de carte reconnue",
  dbLoading: "Chargement de la base de données…",
  dbLoadFailed: "Échec du chargement de la base de données : {message}",
  cameraNotAllowed: "L'accès à la caméra a été refusé.",
  cameraNotFound: "Aucune caméra arrière utilisable n'a été trouvée.",
  cameraUnavailable: "Caméra indisponible ({message}).",
  ocrLoading: "Chargement de l'OCR…",
  ocrZone: "Zone : {zone}",
  ocrSearching: "Recherche du nom de la zone",
  ocrDisabled: "OCR indisponible",
  confidence: "Confiance {pct} %",
  confidenceOcrStable: "Confiance {pct} % (OCR stable)",
  matchDegree: "Correspondance {pct} %",
  desktopTitle: "FFXIV Identification de cartes au trésor (PC)",
  desktopModeLink: "Mode PC (coller une capture d'écran)",
  cameraModeLink: "Mode caméra",
  desktopModeShortLink: "Mode PC",
  dropHint:
    "Capturez la fenêtre de la carte déchiffrée avec Win+Maj+S, puis collez-la ici avec Ctrl+V (glisser une image ou choisir un fichier fonctionne aussi)",
  selectFile: "Choisir un fichier image",
  pasteNoImage: "Aucune image dans le presse-papiers. Capturez d'abord la carte, puis collez.",
  decodeFailed: "Impossible de charger l'image",
  matching: "Identification…",
  checkingZone: "Vérification du nom de la zone…",
  copyResult: "Copier le résultat",
  copied: "Copié !",
  autoReadClipboard: "Coller automatiquement au retour sur cette page",
  clipboardDenied: "L'accès au presse-papiers a été refusé. Collez avec Ctrl+V à la place.",
};

const ko: Record<MsgKey, string> = {
  appTitle: "FF14 보물지도 판별",
  guideHintInitial: "지도를 이 틀에 맞춰 주세요",
  defaultHint: "지도가 이 틀 안에 들어오도록 카메라를 향해 주세요 (멀어도 괜찮습니다)",
  hintAdjust:
    "인식되지 않으면 거리나 각도를 조금 바꿔 보세요 (화면의 줄무늬가 사라지는 위치가 있습니다)",
  hintEnableOcr: '오인식이 계속되면 "OCR 지역 인식 필수"를 켜 주세요.',
  hintZoneLocked: "지역 인식: {zone} — 잠시 그대로 멈춰 주세요",
  hintTooSmall: "지도가 너무 작습니다. 조금 더 가까이 가 주세요",
  candidatesTitle: "후보 (탭하여 선택)",
  rescan: "다시 스캔",
  retry: "다시 시도",
  requireOcr: "OCR 지역 인식 필수",
  captureAlt: "인식된 지도 이미지",
  dbLoading: "DB 불러오는 중…",
  dbLoadFailed: "DB 불러오기에 실패했습니다: {message}",
  cameraNotAllowed: "카메라 사용이 허용되지 않았습니다.",
  cameraNotFound: "사용 가능한 후면 카메라를 찾을 수 없습니다.",
  cameraUnavailable: "카메라를 사용할 수 없습니다({message}).",
  ocrLoading: "OCR 로딩 중…",
  ocrZone: "지역: {zone}",
  ocrSearching: "지역명을 찾는 중",
  ocrDisabled: "OCR 사용 불가",
  confidence: "신뢰도 {pct}%",
  confidenceOcrStable: "신뢰도 {pct}% (OCR 안정)",
  matchDegree: "일치도 {pct}%",
  desktopTitle: "FF14 보물지도 판별 (PC)",
  desktopModeLink: "PC 모드 (스크린샷 붙여넣기)",
  cameraModeLink: "카메라 모드",
  desktopModeShortLink: "PC 모드",
  dropHint:
    "게임에서 해독한 지도 창을 Win+Shift+S로 잘라낸 뒤 Ctrl+V로 여기에 붙여넣어 주세요 (이미지 드롭·파일 선택도 가능)",
  selectFile: "이미지 파일 선택",
  pasteNoImage: "클립보드에 이미지가 없습니다. 지도를 잘라낸 뒤 붙여넣어 주세요.",
  decodeFailed: "이미지를 불러올 수 없습니다",
  matching: "판별 중…",
  checkingZone: "지역명을 확인하는 중…",
  copyResult: "결과 복사",
  copied: "복사했습니다",
  autoReadClipboard: "이 페이지로 돌아오면 자동으로 붙여넣기",
  clipboardDenied: "클립보드 읽기가 허용되지 않았습니다. Ctrl+V로 붙여넣어 주세요.",
};

const zh: Record<MsgKey, string> = {
  appTitle: "FF14 宝物地图识别",
  guideHintInitial: "请将地图对准此框",
  defaultHint: "请将相机对准地图，使其进入此框内（距离远也可以）",
  hintAdjust: "无法识别时，请稍微调整距离或角度（在某个位置屏幕上的条纹会消失）",
  hintEnableOcr: "若持续识别错误，请开启“必须通过 OCR 识别区域”。",
  hintZoneLocked: "已识别区域: {zone} — 请保持静止片刻",
  hintTooSmall: "地图太小了，请再靠近一些",
  candidatesTitle: "候选（点按选用）",
  rescan: "重新扫描",
  retry: "重试",
  requireOcr: "必须通过 OCR 识别区域",
  captureAlt: "已识别的地图图像",
  dbLoading: "正在加载数据库…",
  dbLoadFailed: "数据库加载失败: {message}",
  cameraNotAllowed: "相机使用未被允许。",
  cameraNotFound: "未找到可用的后置相机。",
  cameraUnavailable: "无法使用相机（{message}）。",
  ocrLoading: "正在加载 OCR…",
  ocrZone: "区域: {zone}",
  ocrSearching: "正在寻找区域名称",
  ocrDisabled: "OCR 不可用",
  confidence: "可信度 {pct}%",
  confidenceOcrStable: "可信度 {pct}%（OCR 稳定）",
  matchDegree: "匹配度 {pct}%",
  desktopTitle: "FF14 宝物地图识别（PC）",
  desktopModeLink: "PC 模式（粘贴截图）",
  cameraModeLink: "相机模式",
  desktopModeShortLink: "PC 模式",
  dropHint:
    "在游戏中解读地图后，用 Win+Shift+S 截取地图窗口，再按 Ctrl+V 粘贴到这里（也可拖放图片或选择文件）",
  selectFile: "选择图片文件",
  pasteNoImage: "剪贴板中没有图片。请先截取地图，再粘贴。",
  decodeFailed: "无法加载图片",
  matching: "正在识别…",
  checkingZone: "正在确认区域名称…",
  copyResult: "复制结果",
  copied: "已复制",
  autoReadClipboard: "返回本页面时自动粘贴",
  clipboardDenied: "剪贴板读取未被允许。请改用 Ctrl+V 粘贴。",
};

export const MESSAGES: Record<AppLang, Record<MsgKey, string>> = { ja, en, de, fr, ko, zh };

/** 文言を取得する。{name} プレースホルダを params で置換する。 */
export function t(
  lang: AppLang,
  key: MsgKey,
  params?: Record<string, string | number>,
): string {
  let text: string = MESSAGES[lang][key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

function isAppLang(value: string | null): value is AppLang {
  return value !== null && (APP_LANGS as readonly string[]).includes(value);
}

/**
 * 表示言語を決める。優先順: 保存済み設定 → ブラウザ言語（zh-CN/zh-TW/zh-Hant は zh に集約）→ en。
 * ブラウザ言語が対応外なら海外ユーザーの公算が高いので en に倒す。
 */
export function detectLang(): AppLang {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  if (isAppLang(saved)) return saved;
  for (const raw of navigator.languages ?? [navigator.language]) {
    const prefix = raw.toLowerCase().slice(0, 2);
    if (isAppLang(prefix)) return prefix;
  }
  return "en";
}

/**
 * ページの静的文言を差し替える。
 * data-i18n=キー → textContent、data-i18n-alt=キー → alt 属性。title と <html lang> も設定する。
 * ページタイトルのキーは titleKey で指定できる（カメラページは appTitle、PC用ページは desktopTitle）。
 */
export function applyStatic(lang: AppLang, titleKey: MsgKey = "appTitle"): void {
  document.documentElement.lang = lang;
  document.title = t(lang, titleKey);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = t(lang, el.dataset.i18n as MsgKey);
  }
  for (const el of document.querySelectorAll<HTMLImageElement>("[data-i18n-alt]")) {
    el.alt = t(lang, el.dataset.i18nAlt as MsgKey);
  }
}

/**
 * ゾーンの照合キー（言語非依存）。OCR ゲートと確定判定はこのキーで比較する。
 * 多言語表を持たない旧DB（Service Worker キャッシュ由来）では ja 地名がキーになる。
 */
export function zoneKeyOf(entry: Pick<MapEntry, "zone" | "zoneId">): string {
  return entry.zoneId !== undefined ? String(entry.zoneId) : entry.zone;
}
