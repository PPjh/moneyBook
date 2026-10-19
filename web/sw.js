/* 轻记账 · 导航网络优先，静态资源缓存优先。按应用路径隔离缓存。 */
const CACHE_PREFIX = 'jz-' + self.registration.scope;
const VERSION = CACHE_PREFIX + '1.5.4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // 任一外壳文件失败则保留旧版本，不激活不完整的离线缓存。
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 页面导航：网络优先，失败时回退到缓存的 index.html（离线打开也不白屏）
  if (req.mode === 'navigate') {
    e.respondWith(
      // cache:'no-cache' = 每次启动都向服务器校验一次，而不是等 HTTP 缓存的 max-age 过期。
      // GitHub Pages 会给 HTML 加 600 秒的 max-age，不加这一句，换完文件后可能十几分钟内
      // 手机仍然拿到旧版 index.html，让人误以为更新失败。
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if(!res.ok) throw new Error('页面暂不可用');
          const cp = res.clone();
          e.waitUntil(caches.open(VERSION).then((c) => c.put('./index.html', cp)).catch(() => {}));
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true, cacheName: VERSION })
          .then((r) => r || caches.match('./', { cacheName: VERSION }))
          .then((r) => r || new Response('暂时无法打开，请联网后重试。', { status:503, headers:{ 'Content-Type':'text/plain; charset=utf-8' } })))
    );
    return;
  }

  // 仅缓存应用自身的静态资源，不缓存同域下其他站点或任意请求。
  if(!ASSETS.some((asset) => new URL(asset, self.registration.scope).pathname === url.pathname)) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true, cacheName: VERSION }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const cp = res.clone();
          e.waitUntil(caches.open(VERSION).then((c) => c.put(req, cp)).catch(() => {}));
        }
        return res;
      });
    })
  );
});
