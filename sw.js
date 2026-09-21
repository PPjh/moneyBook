/* 轻记账 · Service Worker
   策略：应用外壳缓存优先（离线可用），后台静默更新。
   改了 index.html 之后，把下面的版本号 +1 即可让手机端拿到新版本。 */
const VERSION = 'jz-v3';
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
      .then((c) => Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
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
          const cp = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', cp)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }).then((r) => r || caches.match('./')))
    );
    return;
  }

  // 静态资源：缓存优先
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const cp = res.clone();
          caches.open(VERSION).then((c) => c.put(req, cp)).catch(() => {});
        }
        return res;
      });
    })
  );
});
