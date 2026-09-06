/* =============================================================
 *  副業収支管理アプリ用 Service Worker
 *  - 単一HTMLアプリ対応（index.html 中心）
 *  - ナビゲーションはキャッシュ優先（オフライン起動を実現）
 *  - その他アセットは Cache-First
 *  - 旧キャッシュは activate 時に破棄
 * ============================================================= */
'use strict';

const CACHE = 'fukufuku-v1';

/** @type {string[]} */
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* ---------- Install: precache + 即時 activate ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    await self.skipWaiting();   // 新SWを即座に有効化
  })());
});

/* ---------- Activate: 旧キャッシュ削除 + clients.claim ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();   // オープン中のタブにも即適用
  })());
});

/* ---------- Fetch: ナビゲーション=キャッシュ優先／その他=Cache-First ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // POST/PUT などは素通し
  if (req.method !== 'GET') return;

  // chrome-extension スキームなどは関与しない
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    /* === ナビゲーション（HTML）: Stale-While-Revalidate 風 === */
    if (req.mode === 'navigate') {
      // 1) まず該当URLのキャッシュ
      const cachedExact = await cache.match(req);
      // 2) あればそれを返しつつ、裏でネット更新
      if (cachedExact) {
        event.waitUntil(updateFromNetwork(req, cache));
        return cachedExact;
      }

      // 3) 該当キャッシュが無ければ ./index.html にフォールバック（PWA起動用）
      const cachedIndex = await cache.match('./index.html');
      if (cachedIndex) {
        event.waitUntil(updateFromNetwork(req, cache));
        return cachedIndex;
      }

      // 4) キャッシュが完全になければネットワークから
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (_) {
        // オフラインでキャッシュも無いときは最小HTMLを返す
        return new Response(
          '<!DOCTYPE html><meta charset="utf-8"><title>副業収支管理</title>' +
          '<body style="font-family:-apple-system,sans-serif;padding:24px;color:#1f6f43">' +
          '<h2>オフラインです</h2>' +
          '<p>電波の良い場所で再読み込みしてください。</p></body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    }

    /* === 通常アセット: Cache-First（無ければネット） === */
    const cachedAsset = await cache.match(req);
    if (cachedAsset) return cachedAsset;

    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (_) {
      // 画像等のフォールバック空GIF
      if (req.destination === 'image') {
        return new Response(
          Uint8Array.from(atob('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='), (c) => c.charCodeAt(0)),
          { headers: { 'Content-Type': 'image/gif' } }
        );
      }
      return Response.error();
    }
  })());
});

/** ナビゲーションを裏側で更新する */
async function updateFromNetwork(req, cache) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      await cache.put(req, res.clone());
      // クライアントにも通知（任意）
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach((c) => {
        c.postMessage({ type: 'sw-updated', url: req.url });
      });
    }
  } catch (_) {
    /* オフライン時は何もしない */
  }
}

/* ---------- メッセージ: 即時更新要求 ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
