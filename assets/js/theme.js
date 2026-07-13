/* ============================================================
   EUROVIX · Tema + push flutuante (horário)
   - Tema ÚNICO escuro (black + midnight) em todo o sistema;
     não há alternador — dark é sempre aplicado e persistido.
   - Horário oficial (Google Business da EUROVIX):
     Seg–Sex 9h–18h · Sáb 9h–13h · Dom fechado
   ============================================================ */

window.EVXTheme = (function () {
  'use strict';
  const KEY = 'evx.theme';

  function current() {
    return 'dark'; // EUROVIX: tema único black + midnight
  }
  function apply() {
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem(KEY, 'dark'); } catch (e) {} // normaliza valor antigo p/ o anti-flash
  }

  /* ---------- Horário de funcionamento (fonte: Google Business) ---------- */
  const HOURS = [
    { dias: [1, 2, 3, 4, 5], rotulo: 'Segunda a sexta', abre: 9 * 60, fecha: 18 * 60 },
    { dias: [6], rotulo: 'Sábado', abre: 9 * 60, fecha: 13 * 60 },
    { dias: [0], rotulo: 'Domingo' }, // fechado
  ];
  const fmt = (m) => Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '');
  function hoursStatus(now) {
    const d = now.getDay(), min = now.getHours() * 60 + now.getMinutes();
    const hoje = HOURS.find(h => h.dias.includes(d));
    if (hoje && hoje.abre != null && min >= hoje.abre && min < hoje.fecha) {
      return { aberto: true, texto: 'Aberto agora · fecha às ' + fmt(hoje.fecha) };
    }
    if (hoje && hoje.abre != null && min < hoje.abre) {
      return { aberto: false, texto: 'Fechado · abre hoje às ' + fmt(hoje.abre) };
    }
    const nomes = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    for (let i = 1; i <= 7; i++) {
      const nd = (d + i) % 7;
      const r = HOURS.find(h => h.dias.includes(nd));
      if (r && r.abre != null) {
        return { aberto: false, texto: 'Fechado · abre ' + (i === 1 ? 'amanhã' : nomes[nd]) + ' às ' + fmt(r.abre) };
      }
    }
    return { aberto: false, texto: 'Fechado' };
  }

  /* ---------- Push flutuante: horário + alternador de tema ---------- */
  function mountFab() {
    if (document.getElementById('evxFab')) return;
    // Tenant-aware: no site institucional (sem WERK) mantém a EUROVIX-piloto + horário ao vivo;
    // no app/painel (WERK presente) usa a identidade da oficina logada.
    let M = null;
    try { if (window.WERK && WERK.marca) M = WERK.marca(); } catch (_) { M = null; }
    const custom = !!(M && M.nome);
    const nome = custom ? M.nome : 'EUROVIX';
    const endereco = custom ? (M.endereco || '') : 'R. Hermes Curry Carneiro, 421 · Ilha de Santa Maria, Vitória/ES';
    const digits = String((custom ? M.fone : '5527997306440') || '').replace(/\D/g, '');
    const wa = digits.length >= 12 ? digits : (digits.length >= 10 ? '55' + digits : '');
    const scheduleHTML = custom
      ? `<div class="ehp-row"><span>Horário</span><b>${M.horario || '—'}</b></div>`
      : HOURS.map(h => `<div class="ehp-row"><span>${h.rotulo}</span><b>${h.abre != null ? fmt(h.abre) + ' – ' + fmt(h.fecha) : 'Fechado'}</b></div>`).join('');
    const el = document.createElement('div');
    el.className = 'evx-fab';
    el.id = 'evxFab';
    el.innerHTML = `
      <div class="evx-hours-pop" id="evxHoursPop" hidden>
        <b>${nome} · horário de funcionamento</b>
        <div class="ehp-status" id="ehpStatus"></div>
        ${scheduleHTML}
        <div class="ehp-foot">${endereco ? endereco + '<br>' : ''}
          ${wa ? `<a href="https://wa.me/${wa}?text=${encodeURIComponent('Olá! Vim pelo ' + (custom ? 'app' : 'site') + ' da ' + nome + '.')}" target="_blank" rel="noopener">WhatsApp${custom ? '' : ' (27) 99730-6440'}</a>` : ''}
        </div>
      </div>
      <button class="evx-fab-btn" id="evxHoursBtn" type="button" aria-label="Horário de funcionamento" title="Horário de funcionamento">🕐<span class="evx-fab-dot" id="evxHoursDot"></span></button>`;
    (document.getElementById('shell') || document.body).appendChild(el);

    const pop = el.querySelector('#evxHoursPop');
    const refresh = () => {
      const box = el.querySelector('#ehpStatus');
      const dot = el.querySelector('#evxHoursDot');
      if (custom) { box.textContent = M.horario || ''; box.className = 'ehp-status'; dot.className = 'evx-fab-dot'; return; }
      const st = hoursStatus(new Date());
      box.textContent = st.texto;
      box.className = 'ehp-status ' + (st.aberto ? 'open' : 'closed');
      dot.className = 'evx-fab-dot ' + (st.aberto ? 'open' : 'closed');
    };
    refresh();
    if (!custom) setInterval(refresh, 60000);
    el.querySelector('#evxHoursBtn').addEventListener('click', () => { pop.hidden = !pop.hidden; });
    document.addEventListener('click', (e) => { if (!el.contains(e.target)) pop.hidden = true; });
  }

  apply(); // fixa data-theme=dark e normaliza o localStorage na hora, sem esperar o DOM
  const remount = () => { const f = document.getElementById('evxFab'); if (f) f.remove(); mountFab(); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountFab);
  } else { mountFab(); }
  // App/painel: a identidade da oficina pode chegar depois (hidratação da nuvem) — re-monta com a marca certa.
  try { if (window.WERK && WERK.ready && WERK.ready.then) WERK.ready.then(remount); } catch (_) {}
  window.addEventListener('evx:sync', remount);

  return { get: current, apply, HOURS, hoursStatus };
})();
