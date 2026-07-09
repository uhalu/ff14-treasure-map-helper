// FF14 宝の地図 照合 PWA の簡易 Service Worker（手書き、vite-plugin-pwa 不使用）。
// - ナビゲーション（index.html）: network-first。新しいデプロイが次回アクセスで即反映される
//   （オフライン時のみキャッシュにフォールバック）。
// - その他（ハッシュ付きアセット・maps.json 等）: キャッシュ優先＋バックグラウンド更新。
const CACHE_NAME = "ff14-treasure-map-v3";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./desktop.html",
  "./manifest.webmanifest",
  "./maps.json",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // ナビゲーションは network-first（デプロイ即反映）。
  // ブラウザの HTTP キャッシュ（GitHub Pages は max-age=600）を素通しにせず、
  // ETag で毎回再検証させる（未変更なら 304 で軽い）
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((c) => c ?? caches.match("./index.html"))),
    );
    return;
  }

  // それ以外は stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
