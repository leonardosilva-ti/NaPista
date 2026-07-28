const CACHE_NAME = 'napista-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './auth.js',
  './drive.js',
  './logic.js',
  './manifest.json',
  './icon.svg'
];

// Instalação do Service Worker e cache dos arquivos estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Interceptando requisições (Cache First para assets estáticos)
self.addEventListener('fetch', (event) => {
  // Não interceptar requisições para a API do Google
  if (event.request.url.includes('googleapis.com') || event.request.url.includes('accounts.google.com')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});

// Atualizando o Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});
