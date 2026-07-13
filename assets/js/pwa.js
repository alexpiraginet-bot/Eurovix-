/* ============================================================
   LexOS · PWA instalável por app e por empresa (white-label)
   Cada tela declara data-app no <script> (cliente|painel|agenda|site).
   O manifest é gerado em runtime: nome, start_url/scope certos e o ÍCONE
   com a marca da oficina logada (ícone quadrado > logo > monograma),
   compositado num quadrado maskable via canvas. iOS via apple-touch-icon.
   ============================================================ */
(function () {
  'use strict';
  var self = document.currentScript;
  var APP = (self && self.getAttribute('data-app')) || window.PWA_APP || 'cliente';

  // Perfil por tipo de app. bg/accent diferenciam o ícone (cliente ≠ painel).
  var APPS = {
    cliente: { start: 'app.html',          suf: '',          label: 'App do cliente', bg: '#0A0C10', theme: '#0A0C10', scopeSelf: true },
    painel:  { start: 'werkos.html',        suf: ' · Painel', label: 'Painel',         bg: '#0D0F14', theme: '#07090C', accent: '#E63928', scopeSelf: true },
    agenda:  { start: 'agendamento.html',   suf: ' · Agenda', label: 'Agendamento',    bg: '#0A0C10', theme: '#0A0C10', scopeSelf: true },
    site:    { start: 'index.html',         suf: '',          label: 'Site',           bg: '#0A0C10', theme: '#0A0C10', scopeSelf: false }
  };
  var cfg = APPS[APP] || APPS.cliente;
  var DIR = new URL('.', location.href).href; // base absoluta (obrigatório: manifest é blob:)
  // Telas sem WERK (site/agenda) declaram a marca por atributo (fallback da oficina-dona do site).
  var DNAME = (self && self.getAttribute('data-name')) || '';
  var DICON = (self && self.getAttribute('data-icon')) || '';

  function marca() { try { return (window.WERK && WERK.marca) ? WERK.marca() : {}; } catch (e) { return {}; } }

  function initials(nome) {
    var stop = /^(ltda|me|epp|eireli|s\.?a\.?|automotiva|reparação|reparacao|oficina|auto|center|centro|do|da|de|e)$/i;
    var parts = String(nome || '').trim().split(/\s+/).filter(function (w) { return w && !stop.test(w); });
    if (!parts.length) parts = String(nome || 'LX').trim().split(/\s+/).filter(Boolean);
    var a = (parts[0] || 'L').charAt(0);
    var b = parts[1] ? parts[1].charAt(0) : (parts[0] || 'LX').charAt(1) || 'X';
    return (a + b).toUpperCase();
  }

  function drawIcon(size, img, m) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    var ctx = c.getContext('2d');
    ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, size, size);
    if (img) {
      var pad = size * 0.17, box = size - pad * 2;
      var k = Math.min(box / img.width, box / img.height);
      var w = img.width * k, h = img.height * k;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#F2F3F5';
      ctx.font = '800 ' + Math.round(size * 0.4) + 'px Montserrat, system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(initials(m.nome), size / 2, size / 2 + size * 0.03);
    }
    if (cfg.accent) { // anel de acento p/ diferenciar o painel do app do cliente
      var lw = Math.max(4, size * 0.05);
      ctx.strokeStyle = cfg.accent; ctx.lineWidth = lw;
      ctx.strokeRect(lw / 2, lw / 2, size - lw, size - lw);
    }
    try { return c.toDataURL('image/png'); } catch (e) { return null; }
  }

  function loadImg(src) {
    return new Promise(function (res) {
      if (!src) return res(null);
      var im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = function () { res(im); }; im.onerror = function () { res(null); };
      im.src = src;
    });
  }

  function setMeta(name, content) {
    var el = document.querySelector('meta[name="' + name + '"]');
    if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
    el.setAttribute('content', content);
  }
  function setLink(rel, href, attrs) {
    var sel = 'link[rel="' + rel + '"]' + (attrs && attrs.sizes ? '[sizes="' + attrs.sizes + '"]' : '');
    var el = document.querySelector(sel);
    if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); if (attrs && attrs.sizes) el.setAttribute('sizes', attrs.sizes); document.head.appendChild(el); }
    el.setAttribute('href', href);
    return el;
  }

  var lastBlob = null;
  async function build() {
    var m = marca();
    var nome = (m.nome || '').trim() || DNAME || 'LexOS';
    var img = await loadImg(m.icon || m.logo || DICON || null); // símbolo quadrado > logo > monograma
    var i512 = drawIcon(512, img, { nome: nome }), i192 = drawIcon(192, img, { nome: nome });
    if (!i512 || !i192) return; // canvas indisponível
    var short = ((nome.split(/\s+/)[0]) || nome).slice(0, 12);
    var manifest = {
      name: nome + cfg.suf,
      short_name: short,
      description: nome + ' — ' + cfg.label,
      lang: 'pt-BR',
      dir: 'ltr',
      id: DIR + cfg.start,
      start_url: DIR + cfg.start + '?src=pwa',
      scope: cfg.scopeSelf ? DIR + cfg.start : DIR,
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      orientation: APP === 'painel' ? 'any' : 'portrait',
      background_color: cfg.bg,
      theme_color: cfg.theme,
      icons: [
        { src: i192, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: i512, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: i512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    };
    var blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    var url = URL.createObjectURL(blob);
    var link = document.querySelector('link[rel="manifest"]');
    if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'manifest'); document.head.appendChild(link); }
    link.setAttribute('href', url);
    if (lastBlob) { try { URL.revokeObjectURL(lastBlob); } catch (e) {} }
    lastBlob = url;
    // iOS (não lê o manifest): apple-touch-icon + metas
    setLink('apple-touch-icon', i192, { sizes: '192x192' });
    setLink('apple-touch-icon', i512, { sizes: '512x512' });
    setMeta('apple-mobile-web-app-capable', 'yes');
    setMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    setMeta('apple-mobile-web-app-title', short);
    setMeta('mobile-web-app-capable', 'yes');
    setMeta('application-name', nome + cfg.suf);
  }

  // ---- Service worker (app-shell + offline; satisfaz o critério de instalação) ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register(DIR + 'sw.js').catch(function () {}); });
  }

  // ---- Chip "Instalar app" (beforeinstallprompt; Android/desktop Chrome/Edge) ----
  var deferred = null, chip = null;
  function mountChip() {
    if (chip || !deferred) return;
    chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'pwaInstallChip';
    chip.textContent = '📲 Instalar ' + (APP === 'painel' ? 'o Painel' : APP === 'site' ? 'o app' : 'o app');
    chip.setAttribute('style', 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483000;' +
      'font:600 13px/1 Montserrat,system-ui,sans-serif;color:#fff;background:#E63928;border:0;border-radius:26px;' +
      'padding:12px 20px;box-shadow:0 10px 30px rgba(0,0,0,.4);cursor:pointer;letter-spacing:.01em');
    chip.addEventListener('click', doInstall);
    document.body.appendChild(chip);
  }
  function removeChip() { if (chip) { chip.remove(); chip = null; } }
  async function doInstall() {
    if (!deferred) return;
    var d = deferred; deferred = null; removeChip();
    d.prompt();
    try { await d.userChoice; } catch (e) {}
    document.documentElement.classList.remove('pwa-installable');
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    document.documentElement.classList.add('pwa-installable');
    if (document.body) mountChip(); else document.addEventListener('DOMContentLoaded', mountChip);
    window.dispatchEvent(new Event('pwa:installable'));
  });
  window.addEventListener('appinstalled', function () { removeChip(); document.documentElement.classList.remove('pwa-installable'); });
  window.__pwaInstall = doInstall; // botões do app/painel podem chamar direto

  // ---- (re)constrói o manifest quando a marca chega/atualiza ----
  function rebuild() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rebuild); else rebuild();
  try { if (window.WERK && WERK.ready && WERK.ready.then) WERK.ready.then(rebuild); } catch (e) {}
  window.addEventListener('evx:sync', rebuild);
  window.addEventListener('storage', function (e) { if (e.key && /evx\.werk\.config/.test(e.key)) rebuild(); });
})();
