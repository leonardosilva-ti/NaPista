// Network-first para os arquivos do app: sempre pega a versão mais nova
// quando há internet e usa o cache quando está offline.
const CACHE_NAME = 'napista-v16';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './auth.js',
    './drive.js',
    './logic.js',
    './plans.js',
    './finance.js',
    './gestao.js',
    './manifest.json',
    './icon.svg',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png',
    './covem.svg',
    './favicon.ico'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // Google APIs, fontes etc.

    // `no-cache` força conferir com o servidor: sem isso o navegador pode misturar
    // arquivos novos e antigos (o GitHub Pages manda guardar cada um por 10 min).
    event.respondWith(
        fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
});
