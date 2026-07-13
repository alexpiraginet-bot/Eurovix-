/* LexOS · service worker — app-shell + offline (network-first, cache como rede reserva).
   Não cacheia terceiros (Supabase, Sketchfab, fontes) nem POST/realtime. */
'use strict';
var CACHE = 'lexos-shell-v1';
var SHELL = [
  'app.html', 'werkos.html', 'index.html', 'agendamento.html',
  'assets/css/tokens.css', 'assets/css/app.css', 'assets/css/werkos.css', 'assets/css/site.css',
  'assets/js/data.js', 'assets/js/werk-data.js', 'assets/js/app.js', 'assets/js/werkos.js',
  'assets/js/theme.js', 'assets/js/pwa.js'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // POST/realtime passam direto
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return; // Supabase/Sketchfab/fonts: sem interceptar
  // Network-first: sempre fresco online; cai no cache offline. Guarda uma cópia dos GET ok.
  e.respondWith(
    fetch(req).then(function (r) {
      if (r && r.ok && r.type === 'basic') {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return r;
    }).catch(function () {
      return caches.match(req).then(function (m) {
        if (m) return m;
        if (req.mode === 'navigate') return caches.match('app.html') || caches.match('index.html');
        return Response.error();
      });
    })
  );
});
