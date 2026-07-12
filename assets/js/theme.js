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
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#0A0C10');
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
    const el = document.createElement('div');
    el.className = 'evx-fab';
    el.id = 'evxFab';
    el.innerHTML = `
      <div class="evx-hours-pop" id="evxHoursPop" hidden>
        <b>EUROVIX · horário de funcionamento</b>
        <div class="ehp-status" id="ehpStatus"></div>
        ${HOURS.map(h => `<div class="ehp-row"><span>${h.rotulo}</span><b>${h.abre != null ? fmt(h.abre) + ' – ' + fmt(h.fecha) : 'Fechado'}</b></div>`).join('')}
        <div class="ehp-foot">R. Hermes Curry Carneiro, 421 · Ilha de Santa Maria, Vitória/ES<br>
          <a href="https://wa.me/5527997306440?text=${encodeURIComponent('Olá! Vim pelo site da EUROVIX.')}" target="_blank" rel="noopener">WhatsApp (27) 99730-6440</a>
        </div>
      </div>
      <button class="evx-fab-btn" id="evxHoursBtn" type="button" aria-label="Horário de funcionamento" title="Horário de funcionamento">🕐<span class="evx-fab-dot" id="evxHoursDot"></span></button>`;
    (document.getElementById('shell') || document.body).appendChild(el);

    const pop = el.querySelector('#evxHoursPop');
    const refresh = () => {
      const st = hoursStatus(new Date());
      const box = el.querySelector('#ehpStatus');
      box.textContent = st.texto;
      box.className = 'ehp-status ' + (st.aberto ? 'open' : 'closed');
      el.querySelector('#evxHoursDot').className = 'evx-fab-dot ' + (st.aberto ? 'open' : 'closed');
    };
    refresh();
    setInterval(refresh, 60000);
    el.querySelector('#evxHoursBtn').addEventListener('click', () => { pop.hidden = !pop.hidden; });
    document.addEventListener('click', (e) => { if (!el.contains(e.target)) pop.hidden = true; });
    apply();
  }

  apply(); // aplica o tema (data-theme + theme-color) na hora, sem esperar o DOM (evita flash da barra no mobile)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountFab);
  } else { mountFab(); }

  return { get: current, apply, HOURS, hoursStatus };
})();
