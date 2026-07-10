/* ============================================================
   EUROVIX · Temas claro/escuro para todo o sistema
   - Persistência em localStorage (evx.theme) e sync entre abas
   - Padrão por família: páginas do cliente = claro;
     WERK OS = escuro. O toggle explícito vale para tudo.
   - Botões: qualquer elemento com [data-theme-toggle]
   ============================================================ */

window.EVXTheme = (function () {
  'use strict';
  const KEY = 'evx.theme';

  function pageDefault() {
    return document.body && document.body.classList.contains('werk-body') ? 'dark' : 'light';
  }
  function current() {
    let t = null;
    try { t = localStorage.getItem(KEY); } catch (e) {}
    return t || pageDefault();
  }
  function apply() {
    let stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) {}
    if (stored) document.documentElement.setAttribute('data-theme', stored);
    else document.documentElement.removeAttribute('data-theme');

    const t = current();
    // ícone dos botões e cor da barra do navegador
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      b.textContent = t === 'dark' ? '☀️' : '🌙';
      b.setAttribute('aria-label', t === 'dark' ? 'Tema claro' : 'Tema escuro');
      b.title = b.getAttribute('aria-label');
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0D1014' : '#FFFFFF');
  }
  function set(t) {
    try { localStorage.setItem(KEY, t); } catch (e) {}
    apply();
  }
  function toggle() { set(current() === 'dark' ? 'light' : 'dark'); }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-toggle]');
    if (b) { e.preventDefault(); toggle(); }
  });
  window.addEventListener('storage', (e) => { if (e.key === KEY) apply(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();

  return { get: current, set, toggle, apply };
})();
