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

    // Rótulo flutuante (qualquer tela): deixa claro que é demo e oferece trocar/sair.
    var mkBar = function () {
      if (document.getElementById('evxDemoBar') || !document.body) return;
      var papeis = { gestor: '📋 Gestor', mecanico: '🔧 Mecânico', consultor: '🎧 Consultor', admin: '👑 Admin', cliente: '👤 Cliente' };
      var quem = /app\.html/.test(location.pathname) ? papeis.cliente : (papeis[papel] || papel);
      var bar = document.createElement('div');
      bar.id = 'evxDemoBar';
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:99999;display:flex;gap:12px;align-items:center;background:#12151c;color:#e8ecf3;border:1px solid #2a3242;border-radius:999px;padding:8px 15px;font:600 12px/1.15 system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.5);max-width:calc(100vw - 24px)';
      bar.innerHTML = '<span>🧪 Demonstração · ' + quem + ' <span style="color:#8892a4;font-weight:500">— dados fictícios, nada é salvo na nuvem</span></span>'
        + '<a href="demo.html" style="color:#8ab4ff;text-decoration:none;white-space:nowrap">trocar acesso</a>'
        + '<a href="#" id="evxDemoOut" style="color:#ff9d9d;text-decoration:none">sair</a>';
      document.body.appendChild(bar);
      var out = document.getElementById('evxDemoOut');
      if (out) out.addEventListener('click', function (e) {
        e.preventDefault();
        try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(KP); } catch (_) {}
        location.href = location.pathname;   // recarrega sem a demo → volta à nuvem
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mkBar);
    else mkBar();
  } catch (e) { /* a demo nunca pode quebrar a página */ }
})();
