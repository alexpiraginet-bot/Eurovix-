/* ============================================================
   EUROVIX · mirror de publicação (Vercel)
   Service Worker que serve o ecossistema inteiro direto do
   GitHub (raw) com os content-types corretos, mesma origem.
   Cada push no branch atualiza o site publicado.
   ============================================================ */

const REPO = 'alexpiraginet-bot/Eurovix-';
const REF = 'refs/heads/main';
const UPSTREAM = `https://raw.githubusercontent.com/${REPO}/${REF}`;
const CACHE = 'evx-mirror-v1';

const MIME = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
};

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return; // o próprio worker vem do Vercel
  e.respondWith(mirror(url));
});

async function mirror(url) {
  let path = url.pathname.replace(/\/+$/, '');
  if (path === '' || path === '/') path = '/index.html';
  const ext = (path.split('.').pop() || '').toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const upstream = UPSTREAM + path;
  const isHTML = ext === 'html';
  const cache = await caches.open(CACHE);

  // HTML: rede primeiro (pega push novo); assets: cache primeiro
  if (!isHTML) {
    const hit = await cache.match(upstream);
    if (hit) {
      refresh(cache, upstream, type); // atualiza em segundo plano
      return hit;
    }
  }
  try {
    const res = await fetch(upstream, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.arrayBuffer();
    const out = new Response(body, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } });
    cache.put(upstream, out.clone());
    return out;
  } catch (err) {
    const hit = await cache.match(upstream);
    if (hit) return hit;
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="background:#0A0A0A;color:#F2F3F5;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center"><div><h2>EUROVIX</h2><p>Não foi possível carregar <code>${path}</code>.<br>Verifique a conexão e recarregue.</p></div>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

function refresh(cache, upstream, type) {
  fetch(upstream, { cache: 'no-cache' }).then(async (res) => {
    if (!res.ok) return;
    const body = await res.arrayBuffer();
    cache.put(upstream, new Response(body, { status: 200, headers: { 'Content-Type': type } }));
  }).catch(() => {});
}
