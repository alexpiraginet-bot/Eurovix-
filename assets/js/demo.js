/* ============================================================
   LexOS · Modo Demonstração / Teste
   ------------------------------------------------------------
   Carregado LOGO APÓS assets/js/env.js e ANTES de werk-data.js.
   Com ?demo=1 (ou a flag de sessão) NEUTRALIZA a nuvem
   (window.EVX_ENV = {}) para o app rodar 100% local, com dados
   fictícios semeados — sem tocar em nada da conta real. O
   armazenamento fica ISOLADO (chaves evx.demo.*), então a demo
   nunca mistura com o cache da nuvem, e sair volta ao normal.

   Papel opcional (persona do painel):
     ?papel=gestor | mecanico | consultor | admin
   Sair: ?demo=0  (ou o botão "sair" do rótulo flutuante).
   ============================================================ */
(function () {
  'use strict';
  var KEY = 'evx.demo', KP = 'evx.demo.papel';
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('demo') === '0' || q.get('demo') === 'off') {          // saída explícita
      try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(KP); } catch (_) {}
      return;                                                        // segue no modo normal (nuvem, se houver env)
    }
    var on = q.has('demo') || (function () { try { return sessionStorage.getItem(KEY) === '1'; } catch (_) { return false; } })();
    if (!on) return;

    var papel = q.get('papel');
    try {
      sessionStorage.setItem(KEY, '1');
      if (papel) sessionStorage.setItem(KP, papel);
      papel = sessionStorage.getItem(KP) || 'gestor';
    } catch (_) { papel = papel || 'gestor'; }

    window.EVX_ENV = {};                    // sem nuvem → módulo local (werk-data.js) com seeds fictícios
    window.EVX_DEMO = { papel: papel };     // persona da demonstração (painel)

    // Chip discreto de demonstração: pequeno, no canto, sem cobrir o app. Tocar leva
    // ao hub (demo.html) para trocar de papel ou encerrar; o "×" apenas oculta o aviso.
    var HB = 'evx.demo.barhide';
    var barHidden = function () { try { return sessionStorage.getItem(HB) === '1'; } catch (_) { return false; } };
    var mkBar = function () {
      if (document.getElementById('evxDemoBar') || !document.body || barHidden()) return;
      var bar = document.createElement('div');
      bar.id = 'evxDemoBar';
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99998;display:inline-flex;gap:7px;align-items:center;background:rgba(16,19,26,.82);color:#c6cedb;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:5px 6px 5px 11px;font:600 11px/1 -apple-system,system-ui,\'Segoe UI\',Roboto,sans-serif;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:0 6px 20px rgba(0,0,0,.4);max-width:calc(100vw - 24px)';
      bar.innerHTML = '<a href="demo.html" title="Trocar de acesso ou encerrar a demonstração" style="color:#c6cedb;text-decoration:none;white-space:nowrap">🧪 Demonstração</a>'
        + '<button id="evxDemoOut" aria-label="Ocultar aviso" title="Ocultar" style="border:none;background:rgba(255,255,255,.09);color:#9aa4b4;width:18px;height:18px;border-radius:50%;cursor:pointer;font:600 13px/1 system-ui;display:flex;align-items:center;justify-content:center;padding:0">×</button>';
      document.body.appendChild(bar);
      var out = document.getElementById('evxDemoOut');
      if (out) out.addEventListener('click', function () { try { sessionStorage.setItem(HB, '1'); } catch (_) {} bar.remove(); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mkBar);
    else mkBar();
  } catch (e) { /* a demo nunca pode quebrar a página */ }
})();
