/* ============================================================
   EUROVIX · WERK OS — painel da oficina
   Kanban · Check-in · OS/DVI · Orçamento · QC · Checkout ·
   Veículos/Prontuário · Motor de Peças · Gestão · Config
   ============================================================ */

(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const main = $('#wkMain');
  const I = (n, s) => EVX.icon(n, s || 16);

  /* ---------- infra: toast, modal, hash ---------- */
  function toast(t, s) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${I('check', 18)}<div><b>${t}</b><span>${s || ''}</span></div>`;
    $('#wkToasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
  function modal(html) {
    $('#wkModalBox').innerHTML = html;
    $('#wkModal').classList.add('open');
  }
  function closeModal() { $('#wkModal').classList.remove('open'); }
  $('#wkModal').addEventListener('click', e => { if (e.target.id === 'wkModal') closeModal(); });

  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
  }
  const aceiteHash = (os) => `${djb2(JSON.stringify(os.itens.map(i => [i.id, i.aprovacao, i.nivelEscolhido])))}…${djb2(os.vin)}`.slice(0, 18);

  /* ---------- compressão de foto → thumbnail dataURL ---------- */
  function fileToThumb(file, cb) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const k = Math.min(1, 480 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.55));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  /* ---------- assinatura (canvas) ---------- */
  function sigPad(canvas) {
    const ctx = canvas.getContext('2d');
    const fix = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * 2; canvas.height = r.height * 2;
      ctx.scale(2, 2); ctx.strokeStyle = '#14181F'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    };
    fix();
    let draw = false, empty = true, px = 0, py = 0;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    canvas.addEventListener('pointerdown', e => { draw = true; [px, py] = pos(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!draw) return;
      const [x, y] = pos(e);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
      px = x; py = y; empty = false;
    });
    canvas.addEventListener('pointerup', () => draw = false);
    return { isEmpty: () => empty, clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; }, data: () => canvas.toDataURL('image/png') };
  }

  /* ---------- QR ilustrativo (payload Pix real ao lado) ---------- */
  function fakeQR(canvas, payload) {
    const N = 29, ctx = canvas.getContext('2d');
    canvas.width = canvas.height = N * 4;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let seed = parseInt(djb2(payload), 16);
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    ctx.fillStyle = '#0A0A0A';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const inFinder = (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
      if (!inFinder && rnd() > .52) ctx.fillRect(x * 4, y * 4, 4, 4);
    }
    const finder = (fx, fy) => {
      ctx.fillRect(fx, fy, 28, 28); ctx.fillStyle = '#fff'; ctx.fillRect(fx + 4, fy + 4, 20, 20);
      ctx.fillStyle = '#0A0A0A'; ctx.fillRect(fx + 8, fy + 8, 12, 12);
    };
    finder(0, 0); finder((N - 7) * 4, 0); finder(0, (N - 7) * 4);
  }

  /* ============================================================
     ROUTER
     ============================================================ */
  const views = {};
  function go(route) { location.hash = '#/' + route; }
  function route() {
    if (WERK.cloud && !WERK.authUser()) { renderStaffLock(); return; } // produção: painel só para a equipe
    const [v, param] = (location.hash.replace(/^#\//, '') || 'kanban').split('/');
    $$('.wk-nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    (views[v] || views.kanban)(param);
    $('#wkSide').classList.remove('open');
  }
  window.addEventListener('hashchange', route);

  function renderStaffLock() {
    $$('.wk-nav button').forEach(b => b.classList.remove('on'));
    main.innerHTML = head('WERK OS — acesso da equipe', 'Sistema em produção: entre com seu usuário staff (criado no Supabase).') + `
      <div class="wk-panel" style="max-width:440px">
        <div class="wfield"><label>E-mail</label><input id="st-email" type="email" placeholder="voce@eurovix.com.br" autocomplete="username"></div>
        <div class="wfield" style="margin-top:10px"><label>Senha</label><input id="st-senha" type="password" autocomplete="current-password"></div>
        <div class="hintline err" id="stErr" style="display:none;margin-top:8px">E-mail ou senha inválidos — ou o usuário ainda não foi cadastrado como staff (SETUP-NUVEM.md, passo 4).</div>
        <button class="btn btn-primary" style="margin-top:14px;width:100%" id="stEntrar">Entrar no WERK OS</button>
        <p style="font-size:10.5px;color:var(--txt-3);margin-top:10px">O app do cliente não usa esta tela — o acesso dele nasce no check-in.</p>
      </div>`;
    const entrar = async () => {
      const u = await WERK.loginStaff($('#st-email').value.trim(), $('#st-senha').value);
      if (u) route(); else $('#stErr').style.display = 'block';
    };
    $('#stEntrar').addEventListener('click', entrar);
    $('#st-senha').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
  }
  $$('.wk-nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));

  /* Navegação mobile: burger + backdrop */
  const burger = $('#wkBurger'), backdrop = $('#wkBackdrop'), side = $('#wkSide');
  function closeSide() { side.classList.remove('open'); backdrop.classList.remove('show'); }
  if (burger) {
    burger.addEventListener('click', () => {
      side.classList.toggle('open');
      backdrop.classList.toggle('show', side.classList.contains('open'));
    });
    backdrop.addEventListener('click', closeSide);
    $$('.wk-nav button').forEach(b => b.addEventListener('click', closeSide));
  }

  const sevIcon = { critico: '🔴', preventivo: '🟡', ok: '🟢' };
  const head = (t, sub, actions) => `
    <div class="wk-head">
      <div><h1>${t}</h1><div class="sub">${sub || ''}</div></div>
      <div class="wk-actions">${actions || ''}</div>
    </div>`;

  /* ============================================================
     VIEW · KANBAN
     ============================================================ */
  const VIEWKEY = 'evx.werk.view';
  let boardMode = null;
  let boardQ = '';
  function getBoardMode() {
    if (boardMode) return boardMode;
    try { boardMode = localStorage.getItem(VIEWKEY); } catch (e) {}
    if (!boardMode) boardMode = window.innerWidth < 880 ? 'lista' : 'kanban';
    return boardMode;
  }
  function setBoardMode(m) {
    boardMode = m;
    try { localStorage.setItem(VIEWKEY, m); } catch (e) {}
    $$('#boardSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    renderBoardBody();
  }
  const modeloCurto = (o) => (o.veiculo || '').replace('BMW ', '').split(' (')[0];
  function boardData() {
    const all = WERK.getAllOS().filter(o => o.status !== 'entregue');
    const q = boardQ.trim().toLowerCase();
    if (!q) return all;
    return all.filter(o => `#${o.numero} ${o.placa} ${o.cliente} ${o.veiculo}`.toLowerCase().includes(q));
  }
  const sevPills = (o) => `<div class="sev-pills">${o.itens.map(i => `<span class="sev ${i.severidade}"></span>`).join('')}</div>`;

  function listaHTML(data) {
    const groups = WERK.STATUS.map(st => {
      const rows = data.filter(o => o.status === st.id);
      if (!rows.length) return '';
      return `
        <div class="bl-group" style="--st:${st.cor}">
          <div class="bl-head"><span class="bl-dot"></span>${st.nome}<span class="bl-count">${rows.length}</span></div>
          ${rows.map(o => `
            <div class="bl-row" data-os="${o.numero}">
              <b>#${o.numero} · ${o.placa || '—'}</b>
              <span class="bl-sub">${o.cliente.split(' ')[0]} · ${modeloCurto(o)}</span>
              <span class="bl-val">${WERK.brl(WERK.totalOS(o, !!o.aceite))}</span>
              <span class="bl-chev">›</span>
            </div>`).join('')}
        </div>`;
    }).join('');
    return groups || `<div class="board-empty">Nenhuma OS encontrada${boardQ ? ' para "' + boardQ + '"' : ''}.</div>`;
  }

  function gradeHTML(data) {
    const orden = [...data].sort((a, b) => WERK.statusIdx(a.status) - WERK.statusIdx(b.status));
    if (!orden.length) return `<div class="board-empty">Nenhuma OS encontrada${boardQ ? ' para "' + boardQ + '"' : ''}.</div>`;
    return `<div class="bg-grid">${orden.map(o => {
      const st = WERK.STATUS[WERK.statusIdx(o.status)];
      return `
        <div class="bg-tile" data-os="${o.numero}" style="--st:${st.cor}">
          <div class="bg-status">${st.nome}</div>
          <b>${o.placa || '#' + o.numero}</b>
          <span class="bg-mod">${modeloCurto(o)}</span>
          <span class="bg-cli">${o.cliente}</span>
          <div class="bg-foot">${sevPills(o)}<span class="bg-num">#${o.numero}</span></div>
        </div>`;
    }).join('')}</div>`;
  }

  function kanbanHTML(data) {
    return `<div class="kanban">${WERK.STATUS.map(st => {
      const cards = data.filter(o => o.status === st.id);
      return `
        <div class="kcol" style="--st:${st.cor}">
          <div class="kcol-head"><span>${st.nome}</span><span class="count">${cards.length}</span></div>
          <div class="kcol-body">
            ${cards.map(o => `
              <div class="kcard" data-os="${o.numero}">
                <b>#${o.numero} · ${o.placa || o.cliente.split(' ')[0]}</b>
                <div class="kv">${o.cliente.split(' ')[0]} · ${modeloCurto(o)}</div>
                <div class="kfoot">${sevPills(o)}<span class="ktec">${WERK.brl(WERK.totalOS(o, !!o.aceite))}</span></div>
              </div>`).join('') || '<div style="font-size:11px;color:var(--txt-3);padding:8px">vazio</div>'}
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  function renderBoardBody() {
    const el = $('#boardBody');
    if (!el) return;
    const data = boardData();
    const mode = getBoardMode();
    el.innerHTML = mode === 'lista' ? listaHTML(data) : mode === 'grade' ? gradeHTML(data) : kanbanHTML(data);
    $$('[data-os]', el).forEach(k => k.addEventListener('click', () => { location.hash = '#/os/' + k.dataset.os; }));
  }

  views.kanban = () => {
    const all = WERK.getAllOS().filter(o => o.status !== 'entregue');
    const done = WERK.getAllOS().filter(o => o.status === 'entregue');
    main.innerHTML = head('Quadro da Oficina',
      `${all.length} OS ativas · ${done.length} entregues no histórico`,
      `<button class="btn btn-primary" onclick="location.hash='#/checkin'">+ Novo check-in</button>`) + `
      <div class="board-tools">
        <div class="seg" id="boardSeg">
          <button data-m="lista">☰ Lista</button>
          <button data-m="grade">▦ Grade</button>
          <button data-m="kanban">⫴ Kanban</button>
        </div>
        <input id="boardQ" class="board-q" placeholder="Buscar placa, cliente, modelo, nº…" value="${boardQ.replace(/"/g, '&quot;')}">
      </div>
      <div id="boardBody"></div>`;
    $$('#boardSeg button').forEach(b => {
      b.classList.toggle('on', b.dataset.m === getBoardMode());
      b.addEventListener('click', () => setBoardMode(b.dataset.m));
    });
    $('#boardQ').addEventListener('input', (e) => { boardQ = e.target.value; renderBoardBody(); });
    renderBoardBody();
  };

  /* ============================================================
     VIEW · CHECK-IN (Etapas 0/1 — wizard)
     ============================================================ */
  const ck = { step: 1, fotos: {}, danos: [], sig: null };
  views.checkin = () => {
    ck.step = 1; ck.fotos = {}; ck.danos = []; ck.sig = null;
    renderCheckin();
  };

  const FOTO_SLOTS = ['Frente', 'Traseira', 'Lateral esq.', 'Lateral dir.', 'Teto', 'Interior', 'Painel/odômetro', 'Porta-malas'];

  function renderCheckin() {
    const stepNames = ['Veículo & VIN', 'Checklist 360°', 'Assinatura', 'Termo gerado'];
    main.innerHTML = head('Check-in Digital', 'Etapa 1 do fluxo — o Termo de Entrada nasce aqui.') + `
      <div class="wsteps">${stepNames.map((s, i) =>
        `<span class="wstep ${i + 1 === ck.step ? 'on' : i + 1 < ck.step ? 'done' : ''}">${i + 1} · ${s}</span>`).join('')}
      </div>
      <div id="ckBody"></div>`;
    const body = $('#ckBody');

    /* ---- Passo 1: veículo ---- */
    if (ck.step === 1) {
      body.innerHTML = `
        <div class="wk-panel">
          <h3>${I('scan')} Identificação por VIN <span style="font-size:10px;color:var(--txt-3);font-weight:400">— OCR da placa/etiqueta na integração; digitação validada aqui</span></h3>
          <div class="wk-grid2">
            <div class="wfield">
              <label>VIN (chassi — 17 caracteres)</label>
              <input id="ck-vin" maxlength="17" placeholder="WBA5U710X07L90210" style="text-transform:uppercase" value="${ck.vin || ''}">
              <div class="hintline" id="vinHint">Dígito verificador (posição 9) validado em tempo real — ISO 3779.</div>
            </div>
            <div class="wfield">
              <label>Placa</label>
              <input id="ck-placa" maxlength="8" placeholder="ABC-1D23" style="text-transform:uppercase" value="${ck.placa || ''}">
            </div>
          </div>
          <div id="vinDecoded" style="margin-top:12px"></div>
        </div>
        <div class="wk-panel">
          <h3>${I('user')} Cliente & sintoma</h3>
          <div class="wk-grid3">
            <div class="wfield"><label>Nome do cliente</label><input id="ck-cli" value="${ck.cliente || ''}" placeholder="Nome completo"></div>
            <div class="wfield"><label>Telefone/WhatsApp</label><input id="ck-tel" value="${ck.telefone || ''}" placeholder="(27) 9…"></div>
            <div class="wfield"><label>Técnico designado</label>
              <select id="ck-tec">${WERK.getConfig().tecnicos.map(t => `<option>${t.nome} — ${t.espec}</option>`).join('')}</select>
            </div>
          </div>
          <div class="wfield" style="margin-top:12px">
            <label>Sintoma relatado (texto — áudio/vídeo de 30s na integração do app)</label>
            <textarea id="ck-sintoma" rows="2" placeholder="Ex.: barulho seco na dianteira ao passar em lombada…">${ck.sintoma || ''}</textarea>
          </div>
        </div>
        <div class="wk-actions" style="justify-content:flex-end">
          <button class="btn btn-primary" id="ckNext1">Continuar → Checklist</button>
        </div>`;

      const vinInput = $('#ck-vin'), hint = $('#vinHint'), dec = $('#vinDecoded');
      const checkVin = () => {
        const v = WERK.validateVIN(vinInput.value);
        if (vinInput.value.length < 17) { hint.className = 'hintline'; hint.textContent = `${vinInput.value.length}/17 caracteres…`; dec.innerHTML = ''; return; }
        if (!v.ok) { hint.className = 'hintline err'; hint.textContent = '✗ ' + v.motivo; dec.innerHTML = ''; return; }
        hint.className = 'hintline ok'; hint.textContent = '✓ VIN válido — dígito verificador confere.';
        const d = WERK.decodeVIN(v.vin);
        const recalls = WERK.checkRecalls(v.vin);
        dec.innerHTML = `
          <div class="diag-item">
            <div class="di-head"><b>${d.modelo}</b><span class="sev-badge ok">ETK decodificado</span></div>
            <div class="di-nota">Motor ${d.motor} · Câmbio ${d.cambio} · Planta ${d.planta} · Ano-modelo ${d.anoModelo}${d.sa.length ? ' · SA: ' + d.sa.join(', ') : ''}</div>
            ${recalls.length ? recalls.map(r => `<div class="di-nota" style="color:var(--warn)">⚠ RECALL ABERTO ${r.codigo}: ${r.titulo}</div>`).join('') : '<div class="di-nota" style="color:var(--ok)">✓ Nenhum recall aberto para este chassi.</div>'}
          </div>`;
      };
      vinInput.addEventListener('input', checkVin); checkVin();
      $('#ckNext1').addEventListener('click', () => {
        const v = WERK.validateVIN(vinInput.value);
        if (!v.ok) { hint.className = 'hintline err'; hint.textContent = '✗ ' + (v.motivo || 'VIN inválido'); vinInput.focus(); return; }
        if (!$('#ck-cli').value.trim()) { $('#ck-cli').focus(); return; }
        Object.assign(ck, {
          vin: v.vin, placa: $('#ck-placa').value.toUpperCase(), cliente: $('#ck-cli').value.trim(),
          telefone: $('#ck-tel').value, tecnico: $('#ck-tec').value.split(' — ')[0], sintoma: $('#ck-sintoma').value.trim(),
          decoded: WERK.decodeVIN(v.vin),
        });
        ck.step = 2; renderCheckin();
      });
    }

    /* ---- Passo 2: checklist 360 ---- */
    if (ck.step === 2) {
      body.innerHTML = `
        <div class="wk-panel">
          <h3>${I('gauge')} Painel & níveis</h3>
          <div class="wk-grid3">
            <div class="wfield"><label>Odômetro (km) — OCR na integração</label><input id="ck-odo" inputmode="numeric" value="${ck.odometro || ''}" placeholder="48500"></div>
            <div class="wfield"><label>Combustível: <b id="fuelLabel">${ck.combustivel || 50}%</b></label>
              <input id="ck-fuel" type="range" min="0" max="100" step="5" value="${ck.combustivel || 50}" style="accent-color:var(--red)"></div>
            <div class="wfield"><label>Luzes de alerta acesas</label><input id="ck-luzes" value="${(ck.luzes || []).join(', ')}" placeholder="Ex.: Service, TPMS (separar por vírgula)"></div>
          </div>
        </div>
        <div class="wk-panel">
          <h3>${I('check')} Itens no veículo</h3>
          <div class="check-items" id="ckItens">
            ${['Documento (CRLV)', 'Chave reserva', 'Triângulo', 'Macaco/chave de roda', 'Estepe/kit reparo', 'Tapetes originais'].map((t, i) => `
              <label class="check-tile ${ck.itens && ck.itens[i] ? 'on' : ''}"><input type="checkbox" ${ck.itens && ck.itens[i] ? 'checked' : ''}> ${t}</label>`).join('')}
          </div>
        </div>
        <div class="wk-grid2">
          <div class="wk-panel">
            <h3>${I('car')} Tour fotográfico 360° <span style="font-size:10px;color:var(--txt-3)">(mín. 4 fotos — IA marca danos na Fase 3)</span></h3>
            <div class="media-grid" id="fotoGrid">
              ${FOTO_SLOTS.map((s, i) => `
                <label class="media-slot ${ck.fotos[i] ? 'filled' : ''}" data-i="${i}">
                  ${ck.fotos[i] ? `<img src="${ck.fotos[i]}" alt=""><span class="tagok">OK</span>` : `${I('scan', 18)}<span>${s}</span>`}
                  <input type="file" accept="image/*" capture="environment" hidden>
                </label>`).join('')}
            </div>
          </div>
          <div class="wk-panel">
            <h3>${I('alert')} Danos preexistentes <span style="font-size:10px;color:var(--txt-3)">— toque na silhueta para marcar</span></h3>
            <div class="car-map" id="carMap">
              <svg viewBox="0 0 400 190">
                <rect width="400" height="190" fill="#0B0E13"/>
                <path d="M60 130 Q70 96 110 88 L150 62 Q158 54 172 53 L250 53 Q266 54 276 64 L306 88 Q352 94 360 118 Q364 130 358 140 L52 140 Q54 132 60 130 Z" fill="none" stroke="#4A7FD4" stroke-width="2.5"/>
                <circle cx="120" cy="140" r="21" fill="none" stroke="#9AA3AF" stroke-width="2.5"/>
                <circle cx="300" cy="140" r="21" fill="none" stroke="#9AA3AF" stroke-width="2.5"/>
                <path d="M165 62 L172 88 M240 62 L240 88 M172 88 L276 88" stroke="#4A7FD4" stroke-width="1.6" fill="none" opacity=".6"/>
              </svg>
              ${ck.danos.map((d, i) => `<span class="dmark" style="left:${d.x}%;top:${d.y}%">${i + 1}</span>`).join('')}
            </div>
            <div class="dlist">
              ${ck.danos.map((d, i) => `<div class="drow"><span class="dn">${i + 1}</span> ${d.nota} <button data-del="${i}">✕</button></div>`).join('') || '<div style="font-size:11.5px;color:var(--txt-3)">Nenhum dano marcado.</div>'}
            </div>
          </div>
        </div>
        <div class="wk-actions" style="justify-content:space-between">
          <button class="btn btn-secondary" id="ckBack2">← Voltar</button>
          <button class="btn btn-primary" id="ckNext2">Continuar → Assinatura</button>
        </div>`;

      $('#ck-fuel').addEventListener('input', e => $('#fuelLabel').textContent = e.target.value + '%');
      $$('#ckItens .check-tile input').forEach(cb => cb.addEventListener('change', () => cb.closest('.check-tile').classList.toggle('on', cb.checked)));
      $$('#fotoGrid .media-slot').forEach(slot => {
        const inp = $('input', slot);
        slot.addEventListener('click', () => inp.click());
        inp.addEventListener('change', () => {
          if (!inp.files[0]) return;
          fileToThumb(inp.files[0], (url) => { ck.fotos[slot.dataset.i] = url; snap2(); renderCheckin(); });
        });
      });
      $('#carMap').addEventListener('click', e => {
        if (e.target.closest('.dmark')) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = Math.round((e.clientX - r.left) / r.width * 100);
        const y = Math.round((e.clientY - r.top) / r.height * 100);
        const nota = prompt('Descreva o dano (ex.: risco no para-choque):');
        if (nota) { ck.danos.push({ x, y, nota }); snap2(); renderCheckin(); }
      });
      body.addEventListener('click', e => {
        const del = e.target.dataset && e.target.dataset.del;
        if (del != null && e.target.tagName === 'BUTTON') { ck.danos.splice(+del, 1); snap2(); renderCheckin(); }
      });
      function snap2() {
        ck.odometro = $('#ck-odo') ? $('#ck-odo').value : ck.odometro;
        ck.combustivel = $('#ck-fuel') ? +$('#ck-fuel').value : ck.combustivel;
        ck.luzes = $('#ck-luzes') ? $('#ck-luzes').value.split(',').map(s => s.trim()).filter(Boolean) : ck.luzes;
        ck.itens = $$('#ckItens input').map(c => c.checked);
      }
      $('#ckBack2').addEventListener('click', () => { snap2(); ck.step = 1; renderCheckin(); });
      $('#ckNext2').addEventListener('click', () => {
        snap2();
        if (!ck.odometro) { $('#ck-odo').focus(); return; }
        if (Object.keys(ck.fotos).length < 4) { toast('Fotos insuficientes', 'O checklist exige no mínimo 4 fotos do tour 360°.'); return; }
        ck.step = 3; renderCheckin();
      });
    }

    /* ---- Passo 3: assinatura ---- */
    if (ck.step === 3) {
      body.innerHTML = `
        <div class="wk-panel">
          <h3>${I('doc')} Reconhecimento do estado de entrada</h3>
          <p style="font-size:12.5px;color:var(--txt-2);line-height:1.6;margin-bottom:14px">
            ${ck.cliente}, declaro que acompanhei a inspeção de entrada do veículo <b>${ck.decoded.modelo}</b>
            (placa ${ck.placa || '—'}, ${Number(ck.odometro).toLocaleString('pt-BR')} km) e reconheço o estado registrado:
            <b>${Object.keys(ck.fotos).length} fotos timestampadas</b> e <b>${ck.danos.length} dano(s) preexistente(s)</b> marcados.
          </p>
          <div class="sig-pad"><canvas id="sigCli"></canvas><div class="sig-line"></div><div class="sig-hint">assine aqui</div></div>
          <button class="sig-clear" id="sigClear">limpar assinatura</button>
        </div>
        <div class="wk-actions" style="justify-content:space-between">
          <button class="btn btn-secondary" id="ckBack3">← Voltar</button>
          <button class="btn btn-primary" id="ckFinish">Gerar Termo de Entrada ✓</button>
        </div>`;
      const pad = sigPad($('#sigCli'));
      $('#sigClear').addEventListener('click', () => pad.clear());
      $('#ckBack3').addEventListener('click', () => { ck.step = 2; renderCheckin(); });
      $('#ckFinish').addEventListener('click', async () => {
        if (pad.isEmpty()) { toast('Assinatura obrigatória', 'O termo só é válido com o aceite do cliente.'); return; }
        const os = await WERK.novaOS({
          vin: ck.vin, veiculo: ck.decoded.modelo, placa: ck.placa, cliente: ck.cliente,
          telefone: ck.telefone, sintoma: ck.sintoma, tecnico: ck.tecnico,
          checkin: {
            ts: new Date().toISOString(), odometro: +ck.odometro, combustivel: ck.combustivel,
            itens: ck.itens, luzes: ck.luzes || [], danos: ck.danos,
            fotos: Object.keys(ck.fotos).length, fotosData: ck.fotos, assinatura: pad.data(),
          },
          ator: 'Recepção',
        });
        WERK.upsertVehicle({ vin: ck.vin, ...ck.decoded, placa: ck.placa, km: +ck.odometro, cliente: ck.cliente, telefone: ck.telefone });
        ck.clienteRec = await WERK.upsertCliente({ nome: ck.cliente, telefone: ck.telefone });
        ck.osNum = os.numero; ck.step = 4; renderCheckin();
      });
    }

    /* ---- Passo 4: termo gerado + acesso do cliente ---- */
    if (ck.step === 4) {
      const rec = ck.clienteRec;
      const url = rec ? WERK.conviteUrl(rec) : '';
      const ativo = !!(rec && rec.senha);
      const primeiro = (ck.cliente || 'Cliente').split(' ')[0];
      const msgWa = `Olá, ${primeiro}! Seu ${ck.decoded.modelo} deu entrada na EUROVIX (OS #${ck.osNum}). ` +
        (ativo ? `Acompanhe tudo pelo app — login: seu telefone. ${url}` : `Crie seu acesso e acompanhe tudo pelo app: ${url}`);
      body.innerHTML = `
        <div class="wk-panel" style="text-align:center;padding:40px 20px">
          <div style="font-size:40px;margin-bottom:8px">✅</div>
          <h3 style="justify-content:center;font-size:18px">OS #${ck.osNum} aberta — Termo de Entrada gerado</h3>
          <p style="font-size:12.5px;color:var(--txt-2);max-width:52ch;margin:8px auto 20px">
            Fotos timestampadas, danos marcados e assinatura arquivados no prontuário do VIN.
            Blindagem jurídica ativa: nenhum "esse risco não estava aí" prospera contra este documento.
          </p>
          <div class="wk-actions" style="justify-content:center">
            <a class="btn btn-secondary" href="documento.html?tipo=termo&os=${ck.osNum}" target="_blank">📄 Ver Termo (PDF)</a>
            <button class="btn btn-primary" onclick="location.hash='#/os/${ck.osNum}'">Abrir OS → Diagnóstico</button>
          </div>
        </div>
        <div class="wk-panel">
          <h3>${I('key')} Acesso do cliente ao app ${rec ? `<span class="ap-badge ${ativo ? 'aprovado' : 'pendente'}">${ativo ? 'acesso já ativo' : 'convite pendente'}</span>` : ''}</h3>
          ${rec ? `
            <p style="font-size:12px;color:var(--txt-2);margin-bottom:10px">
              ${ativo
                ? `${primeiro} já tem acesso — entra com o telefone ${rec.telefone} + a senha que criou. A garagem dele já mostra este veículo.`
                : `Envie o link exclusivo: ${primeiro} abre, cria a própria senha e acompanha tudo pelo app (login = telefone). O link também sai impresso no Termo de Entrada.`}
            </p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
              <code style="flex:1;min-width:220px;background:var(--navy);border:1px solid var(--line-strong);border-radius:9px;padding:10px 12px;font-size:11px;color:var(--txt-2);overflow-wrap:anywhere">${url}</code>
              <button class="btn btn-secondary" id="ckCopy">Copiar link</button>
              <a class="btn btn-secondary" target="_blank" rel="noopener" href="${WERK.waLink(rec.telefone, msgWa)}">Enviar por WhatsApp</a>
            </div>
            <div id="ckQr" style="margin-top:12px"></div>
          ` : '<p style="font-size:12px;color:var(--txt-3)">Check-in sem telefone — informe o telefone/WhatsApp do cliente no próximo check-in para gerar o link de acesso ao app.</p>'}
        </div>`;
      const cp = $('#ckCopy');
      if (cp) cp.addEventListener('click', () => { navigator.clipboard.writeText(url); toast('Link copiado', 'Cole no WhatsApp ou SMS do cliente.'); });
      const qrEl = $('#ckQr');
      if (qrEl && rec && typeof qrcode === 'function') {
        const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
        qrEl.innerHTML = `<div style="display:inline-block;background:#fff;padding:8px;border-radius:8px;vertical-align:middle">${qr.createSvgTag(3, 0)}</div><span style="font-size:10.5px;color:var(--txt-3);margin-left:10px">cliente aponta a câmera → cria a senha</span>`;
      }
    }
  }

  /* ============================================================
     VIEW · OS (detalhe) — Etapas 2–7
     ============================================================ */
  views.os = (num) => {
    const os = WERK.getOS(num);
    if (!os) { go('kanban'); return; }
    const cfg = WERK.getConfig();
    const cli = WERK.clientePorTelefone(os.telefone);
    const idx = WERK.statusIdx(os.status);
    const aprovaveis = os.itens.filter(i => i.severidade !== 'ok');
    const aprovados = aprovaveis.filter(i => i.aprovacao === 'aprovado');
    const pendentes = aprovaveis.filter(i => i.aprovacao === 'pendente');
    const midiaOk = aprovaveis.every(i => i.midia);

    const docs = `
      <a class="quote-btn" href="documento.html?tipo=termo&os=${os.numero}" target="_blank">📄 Termo</a>
      <a class="quote-btn" href="documento.html?tipo=dvi&os=${os.numero}" target="_blank">📄 DVI</a>
      <a class="quote-btn" href="documento.html?tipo=orcamento&os=${os.numero}" target="_blank">📄 Orçamento</a>
      <a class="quote-btn" href="documento.html?tipo=os&os=${os.numero}" target="_blank">📄 OS completa</a>
      ${os.pagamento ? `<a class="quote-btn" href="documento.html?tipo=fatura&os=${os.numero}" target="_blank">📄 Fatura</a>` : ''}
      ${os.itens.some(i => i.garantia) ? `<a class="quote-btn" href="documento.html?tipo=garantia&os=${os.numero}" target="_blank">📄 Garantia</a>` : ''}`;

    main.innerHTML = head(`OS #${os.numero}`, '', `<button class="btn btn-secondary" onclick="location.hash='#/kanban'">← Kanban</button>`) + `
      <div class="os-head-row">
        <span class="idbox">#${os.numero}</span>
        <div class="meta">
          <b>${os.veiculo} · ${os.placa}</b>
          <span>${os.cliente} · ${os.telefone || 's/ tel'} · VIN <code style="font-size:10.5px">${os.vin}</code> · Téc: ${os.tecnico}</span>
          ${cli ? `<span style="margin-top:4px"><button class="quote-btn" id="osConvite">📲 ${cli.senha ? 'app ativo' : 'convite pendente'} · copiar link de acesso</button></span>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${docs}</div>
      </div>
      <div class="status-track">
        ${WERK.STATUS.map((s, i) => `<span class="stseg ${i < idx ? 'done' : i === idx ? 'now' : ''}">${s.nome}</span>`).join('')}
        ${os.status === 'entregue' ? '<span class="stseg done">Entregue ✓</span>' : ''}
      </div>
      <div id="osActions" style="margin-bottom:16px"></div>
      <div class="wk-grid2">
        <div>
          <div class="wk-panel">
            <h3>${I('scan')} Sintoma & DTCs</h3>
            <p style="font-size:12.5px;color:var(--txt-2);margin-bottom:10px">${os.sintoma || 'Sem sintoma registrado.'}</p>
            ${os.dtcs.map(d => `<code style="display:block;background:var(--navy);border:1px solid var(--line-strong);border-radius:8px;padding:8px 11px;font-size:11.5px;color:var(--warn);margin-bottom:6px">${d}</code>`).join('')}
            <div style="display:flex;gap:8px;margin-top:8px">
              <input id="dtcInput" placeholder="Colar DTC do scanner (ISTA/Autel)…" style="flex:1;background:var(--navy);border:1px solid var(--line-strong);border-radius:9px;padding:9px 12px;font-size:12px;color:var(--txt)">
              <button class="btn btn-secondary" style="padding:9px 14px;font-size:12px" id="dtcAdd">Importar</button>
            </div>
          </div>
          <div class="wk-panel">
            <h3>${I('list')} Itens de diagnóstico (DVI) <span style="font-size:10px;color:var(--txt-3)">🔴 crítico · 🟡 preventivo · 🟢 ok — item sem mídia não avança</span></h3>
            <div id="diagList">${os.itens.map(i => diagItemHTML(os, i)).join('') || '<p style="font-size:12px;color:var(--txt-3)">Nenhum item ainda — adicione abaixo.</p>'}</div>
            ${os.status === 'diagnostico' || os.status === 'fila' ? diagFormHTML() : ''}
          </div>
        </div>
        <div>
          <div class="wk-panel">
            <h3>${I('chart')} Orçamento ${os.aceite ? `<span class="ap-badge aprovado">aceite ✓ ${os.aceite.hash}</span>` : ''}</h3>
            <div class="budget">
              ${aprovaveis.map(i => `
                <div class="b-item" style="display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:8px 0;border-bottom:1px dashed var(--line)">
                  <span>${sevIcon[i.severidade]} ${i.titulo} <em style="color:var(--txt-3);font-style:normal">(${i.niveis[i.nivelEscolhido || 'original'].rotulo} + ${i.aw} AW)</em></span>
                  <span style="font-family:var(--font-display);font-weight:700;${i.aprovacao === 'recusado' ? 'text-decoration:line-through;color:var(--txt-3)' : ''}">${WERK.brl(WERK.itemPreco(i))}</span>
                </div>`).join('')}
              <div class="b-total" style="display:flex;justify-content:space-between;font-family:var(--font-display);font-weight:800;padding-top:10px">
                <span>${os.aceite ? 'Total aprovado' : 'Total proposto'}</span>
                <span style="color:var(--red)">${WERK.brl(WERK.totalOS(os, !!os.aceite))}</span>
              </div>
            </div>
            <p style="font-size:10.5px;color:var(--txt-3);margin-top:8px">MO: tabela AW × ${WERK.brl(cfg.valorHora)}/h · margens ${cfg.margens.original}/${cfg.margens.oem}/${cfg.margens.aftermarket}% (orig/OEM/after) — Config.</p>
          </div>
          <div class="wk-panel">
            <h3>${I('bell')} Timeline de eventos <span style="font-size:10px;color:var(--txt-3)">(log imutável)</span></h3>
            <div class="ev-list">${[...os.eventos].reverse().map(e => `
              <div class="ev tipo-${e.tipo}"><span class="ev-dot"></span>
                <div><b>${e.titulo}</b><p>${e.desc || ''}</p><time>${WERK.fdt(e.ts)} · ${e.ator}</time></div>
              </div>`).join('')}
            </div>
          </div>
          <div class="wk-panel">
            <h3>${I('whats')} Chat com o cliente</h3>
            <div class="chat-box" id="chatBox">
              ${os.chat.map(m => `<div class="msg ${m.de === os.cliente ? 'cliente' : 'oficina'}">${m.texto}<time>${WERK.fdt(m.ts)} · ${m.de}</time></div>`).join('') || '<p style="font-size:11.5px;color:var(--txt-3)">Sem mensagens.</p>'}
            </div>
            <div class="chat-send">
              <input id="chatInput" placeholder="Mensagem para ${os.cliente.split(' ')[0]}…">
              <button class="btn btn-primary" style="padding:10px 16px" id="chatSend">Enviar</button>
            </div>
          </div>
        </div>
      </div>`;

    const convBtn = $('#osConvite');
    if (convBtn) convBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(WERK.conviteUrl(cli));
      toast('Link de acesso copiado', cli.senha ? 'Cliente já ativo — o link só reabre o app.' : 'Envie ao cliente: ele cria a senha no primeiro acesso.');
    });
    renderOSActions(os, { aprovaveis, aprovados, pendentes, midiaOk });
    bindOSHandlers(os);
  };

  function diagItemHTML(os, i) {
    const nv = i.niveis[i.nivelEscolhido || 'original'];
    return `
      <div class="diag-item">
        <div class="di-head">
          <span class="sev-badge ${i.severidade}">${sevIcon[i.severidade]} ${i.severidade}</span>
          <b>${i.titulo}</b>
          ${i.aprovacao ? `<span class="ap-badge ${i.aprovacao}">${i.aprovacao}</span>` : ''}
          ${i.midia ? (i.midia === 'demo' ? '<span class="ap-badge aprovado">📷 mídia ok</span>' : `<img src="${i.midia}" alt="" style="width:44px;height:33px;object-fit:cover;border-radius:6px;border:1px solid var(--line-strong)">`) : '<span class="ap-badge pendente">⚠ sem mídia</span>'}
        </div>
        ${i.nota ? `<div class="di-nota">${i.nota}</div>` : ''}
        ${i.severidade !== 'ok' ? `
          <div class="di-part">
            <span>${i.pecaDescricao}</span>
            <code>${i.niveis.original.partNumber}</code>
            <span>${i.aw} AW = ${WERK.brl(i.mo)} MO</span>
            <button class="quote-btn" data-quote="${i.id}">3 níveis + cotações ▾</button>
          </div>
          <div id="q-${i.id}" hidden>
            <table class="lvl-table">
              <tr><th>Nível</th><th>Fabricante</th><th>Part #</th><th>Prazo</th><th>Fornecedor</th><th style="text-align:right">Preço</th></tr>
              ${['original', 'oem', 'aftermarket'].map(nvk => {
                const n = i.niveis[nvk];
                return `<tr class="${(i.nivelEscolhido || 'original') === nvk ? 'sel' : ''}">
                  <td><b style="font-family:var(--font-display)">${n.rotulo}</b></td><td>${n.fabricante}</td>
                  <td><code style="font-size:10px">${n.partNumber}</code></td><td>${n.prazo}d</td><td>${n.fornecedor}</td>
                  <td class="pr" style="text-align:right">${WERK.brl(n.preco + i.mo)}</td></tr>`;
              }).join('')}
            </table>
            <p style="font-size:10px;color:var(--txt-3);margin-top:6px">Cotações (${i.niveis.original.cotacoes.length + i.niveis.oem.cotacoes.length + i.niveis.aftermarket.cotacoes.length} fornecedores): ${WERK.SUPPLIERS.map(s => s.nome).join(' · ')} — melhor preço×prazo selecionado automaticamente.</p>
          </div>` : ''}
      </div>`;
  }

  function diagFormHTML() {
    return `
      <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:14px">
        <div class="wk-grid3">
          <div class="wfield"><label>Novo item — título</label><input id="ni-titulo" placeholder="Ex.: Bieleta com folga"></div>
          <div class="wfield"><label>Categoria (motor de peças)</label>
            <select id="ni-cat">${WERK.CATEGORIAS.map(c => `<option value="${c}">${c.replace('_', ' ')}</option>`).join('')}</select></div>
          <div class="wfield"><label>Severidade</label>
            <select id="ni-sev"><option value="critico">🔴 Crítico / segurança</option><option value="preventivo">🟡 Preventivo</option><option value="ok">🟢 OK (sem ação)</option></select></div>
        </div>
        <div class="wk-grid2" style="margin-top:10px">
          <div class="wfield"><label>Nota técnica</label><input id="ni-nota" placeholder="Evidência / recomendação"></div>
          <div class="wfield"><label>Mídia (obrigatória p/ 🔴🟡)</label>
            <label class="media-slot" id="ni-media-slot" style="aspect-ratio:auto;height:44px;flex-direction:row">${I('scan', 15)}<span id="ni-media-label">anexar foto/vídeo</span><input id="ni-media" type="file" accept="image/*" capture="environment" hidden></label>
          </div>
        </div>
        <button class="btn btn-primary" style="margin-top:12px;padding:11px 18px;font-size:12.5px" id="ni-add">+ Adicionar item ao DVI</button>
      </div>`;
  }

  /* ---------- ações contextuais por status ---------- */
  function renderOSActions(os, ctx) {
    const box = $('#osActions');
    const btn = (label, id, primary) => `<button class="btn ${primary ? 'btn-primary' : 'btn-secondary'}" style="padding:11px 18px;font-size:12.5px" id="${id}">${label}</button>`;
    let html = '';
    if (os.status === 'fila') html = btn('Iniciar diagnóstico →', 'stDiag', true);
    else if (os.status === 'diagnostico') {
      html = ctx.midiaOk && ctx.aprovaveis.length
        ? btn(`Enviar orçamento p/ aprovação (${ctx.aprovaveis.length} itens) →`, 'stAprov', true)
        : `<span style="font-size:12px;color:var(--warn)">⚠ ${!ctx.aprovaveis.length ? 'Adicione ao menos 1 item 🔴/🟡.' : 'Todo item 🔴/🟡 precisa de mídia antes de gerar orçamento — regra dura.'}</span>`;
    }
    else if (os.status === 'aprovacao') {
      html = `<span style="font-size:12px;color:var(--txt-2)">Aguardando o cliente no app (push + WhatsApp enviados). ${ctx.pendentes.length} de ${ctx.aprovaveis.length} itens pendentes.</span> `
        + btn('Registrar aceite presencial', 'stAceite', false)
        + (ctx.aprovados.length ? ' ' + btn('Itens aprovados → iniciar', 'stExec', true) : '');
    }
    else if (os.status === 'peca') html = btn('Peça recebida → Em execução', 'stExec2', true);
    else if (os.status === 'execucao') {
      html = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="upTxt" placeholder="Micro-update p/ timeline do cliente (ex.: 📷 peça velha vs nova)…" style="flex:1;min-width:240px;background:var(--navy);border:1px solid var(--line-strong);border-radius:9px;padding:10px 12px;font-size:12px;color:var(--txt)">
          ${btn('Postar update', 'upSend', false)}
          ${btn('Aguardando peça ⏸', 'stPeca', false)}
          ${btn('Concluir → QC', 'stQC', true)}
        </div>`;
    }
    else if (os.status === 'qc') html = btn('Abrir checklist de QC (dupla assinatura)', 'qcOpen', true);
    else if (os.status === 'lavagem') html = btn('Lavagem concluída → Pronto', 'stPronto', true);
    else if (os.status === 'pronto') html = os.pagamento ? btn('Registrar entrega ✓', 'stEntregue', true) : btn('Checkout & pagamento →', 'ckOpen', true);
    else if (os.status === 'entregue') html = `<span class="ap-badge aprovado">Ciclo concluído · pago ${os.pagamento ? WERK.brl(os.pagamento.valor) + ' via ' + os.pagamento.metodo : ''} · ${os.nf ? os.nf.numero : ''} ${os.nps ? '· NPS ' + os.nps : ''}</span>`;
    box.innerHTML = html;

    const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
    on('stDiag', () => { WERK.setStatus(os.numero, 'diagnostico', os.tecnico); views.os(os.numero); });
    on('stAprov', () => {
      WERK.setStatus(os.numero, 'aprovacao', 'Sistema', 'Orçamento enviado — push + WhatsApp com link de aprovação.');
      toast('Orçamento enviado', 'O cliente aprova item a item no app.');
      views.os(os.numero);
    });
    on('stAceite', () => modalAceite(os));
    on('stExec', () => { startExec(os); });
    on('stExec2', () => { WERK.setStatus(os.numero, 'execucao', os.tecnico, 'Peça recebida e conferida — serviço retomado.'); views.os(os.numero); });
    on('stPeca', () => {
      const forn = prompt('Fornecedor / rastreio (ex.: Pierburg via Importador BR — #BR-88412):');
      WERK.setStatus(os.numero, 'peca', 'Sistema', forn ? `Tracking do fornecedor: ${forn}` : 'Aguardando peça.');
      views.os(os.numero);
    });
    on('upSend', () => {
      const t = $('#upTxt').value.trim();
      if (!t) return;
      WERK.updateOS(os.numero, () => {}, { tipo: 'update', titulo: 'Micro-update do técnico', desc: t, ator: os.tecnico });
      if (typeof EVX !== 'undefined') EVX.pushNotification({ titulo: `OS #${os.numero} — update do box`, texto: t, quando: Date.now(), tipo: 'os' });
      views.os(os.numero);
    });
    on('stQC', () => { WERK.setStatus(os.numero, 'qc', os.tecnico); views.os(os.numero); });
    on('qcOpen', () => modalQC(os));
    on('stPronto', () => { WERK.setStatus(os.numero, 'pronto', 'Sistema', 'Veículo lavado, pronto para retirada. Cliente avisado.'); views.os(os.numero); });
    on('ckOpen', () => modalCheckout(os));
    on('stEntregue', () => {
      WERK.updateOS(os.numero, o => { o.status = 'entregue'; }, { tipo: 'entrega', titulo: 'Veículo entregue', desc: 'Checkout concluído. NPS será solicitado em 24h.', ator: 'Recepção' });
      toast('Entrega registrada', 'Garantias ativadas e NPS agendado.');
      views.os(os.numero);
    });
  }

  function startExec(os) {
    WERK.updateOS(os.numero, o => {
      o.itens.forEach(i => { if (i.aprovacao === 'pendente') i.aprovacao = 'recusado'; });
    });
    WERK.setStatus(os.numero, 'execucao', os.tecnico, 'Itens aprovados entraram em execução no box.');
    views.os(os.numero);
  }

  /* ---------- modal: aceite presencial (assinatura + hash) ---------- */
  function modalAceite(os) {
    const aprovaveis = os.itens.filter(i => i.severidade !== 'ok');
    modal(`
      <h3>Aceite presencial — OS #${os.numero}</h3>
      <p style="font-size:12px;color:var(--txt-2);margin-bottom:12px">Aprovação item a item com validade jurídica: assinatura + timestamp + hash do documento.</p>
      ${aprovaveis.map(i => `
        <div class="diag-item" style="padding:11px 13px">
          <div class="di-head" style="gap:8px">
            <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;font-size:12.5px">
              <input type="checkbox" data-ap="${i.id}" ${i.aprovacao !== 'recusado' ? 'checked' : ''} style="accent-color:var(--ok);width:16px;height:16px">
              <b style="font-family:var(--font-display)">${sevIcon[i.severidade]} ${i.titulo}</b>
            </label>
            <select data-nv="${i.id}" style="background:var(--navy);border:1px solid var(--line-strong);border-radius:7px;color:var(--txt);font-size:11px;padding:5px 7px">
              ${['original', 'oem', 'aftermarket'].map(n => `<option value="${n}" ${(i.nivelEscolhido || 'original') === n ? 'selected' : ''}>${i.niveis[n].rotulo} — ${WERK.brl(i.niveis[n].preco + i.mo)}</option>`).join('')}
            </select>
          </div>
        </div>`).join('')}
      <div class="sig-pad" style="margin-top:12px"><canvas id="sigAceite"></canvas><div class="sig-line"></div><div class="sig-hint">assinatura do cliente</div></div>
      <div class="wk-actions" style="justify-content:flex-end;margin-top:14px">
        <button class="btn btn-secondary" onclick="document.getElementById('wkModal').classList.remove('open')">Cancelar</button>
        <button class="btn btn-primary" id="aceiteOk">Registrar aceite ✓</button>
      </div>`);
    const pad = sigPad($('#sigAceite'));
    $('#aceiteOk').addEventListener('click', () => {
      if (pad.isEmpty()) { toast('Assinatura obrigatória', 'O aceite exige assinatura do cliente.'); return; }
      WERK.updateOS(os.numero, o => {
        o.itens.forEach(i => {
          if (i.severidade === 'ok') return;
          const cb = $(`[data-ap="${i.id}"]`), nv = $(`[data-nv="${i.id}"]`);
          i.aprovacao = cb.checked ? 'aprovado' : 'recusado';
          i.nivelEscolhido = nv.value;
        });
        o.aceite = { assinatura: true, ip: 'presencial (tablet recepção)', hash: aceiteHash(o), ts: new Date().toISOString() };
        o.aprovadoEm = o.aceite.ts;
      }, { tipo: 'aceite', titulo: 'Orçamento aprovado (presencial)', desc: 'Aceite assinado no tablet — hash registrado.', ator: os.cliente });
      closeModal();
      startExec(WERK.getOS(os.numero));
    });
  }

  /* ---------- modal: QC com dupla assinatura ---------- */
  function modalQC(os) {
    modal(`
      <h3>Controle de qualidade — OS #${os.numero}</h3>
      <div class="check-items" style="grid-template-columns:1fr;margin-bottom:12px">
        <label class="check-tile"><input type="checkbox" id="qc1"> Torques registrados conforme especificação</label>
        <label class="check-tile"><input type="checkbox" id="qc2"> Reset de service / CBS executado</label>
        <label class="check-tile"><input type="checkbox" id="qc3"> Luzes de alerta apagadas · scanner limpo</label>
      </div>
      <div class="wfield" style="margin-bottom:12px"><label>Test-drive — km rodados</label><input id="qcKm" placeholder="Ex.: 4,2 km"></div>
      <div class="wk-grid2">
        <div><div class="sig-pad"><canvas id="sigTec"></canvas><div class="sig-line"></div><div class="sig-hint">técnico executor — ${os.tecnico}</div></div></div>
        <div><div class="sig-pad"><canvas id="sigInsp"></canvas><div class="sig-line"></div><div class="sig-hint">inspetor de qualidade</div></div></div>
      </div>
      <p style="font-size:10.5px;color:var(--txt-3);margin-top:10px">Sem QC completo e duplamente assinado, o sistema não libera o checkout — regra dura.</p>
      <div class="wk-actions" style="justify-content:flex-end;margin-top:12px">
        <button class="btn btn-primary" id="qcOk">Aprovar QC → Lavagem</button>
      </div>`);
    const p1 = sigPad($('#sigTec')), p2 = sigPad($('#sigInsp'));
    $('#qcOk').addEventListener('click', () => {
      if (!$('#qc1').checked || !$('#qc2').checked || !$('#qc3').checked) { toast('Checklist incompleto', 'Todos os itens de QC são obrigatórios.'); return; }
      if (!$('#qcKm').value.trim()) { $('#qcKm').focus(); return; }
      if (p1.isEmpty() || p2.isEmpty()) { toast('Dupla assinatura obrigatória', 'Técnico + inspetor precisam assinar.'); return; }
      WERK.updateOS(os.numero, o => {
        o.qc = { torques: true, resetService: true, testDrive: $('#qcKm').value, assinaturaTecnico: os.tecnico, assinaturaInspetor: 'Inspetor QC', ts: new Date().toISOString() };
      }, { tipo: 'status', titulo: 'QC aprovado', desc: `Test-drive ${$('#qcKm').value} · dupla assinatura registrada.`, ator: os.tecnico });
      WERK.setStatus(os.numero, 'lavagem', 'Sistema');
      closeModal(); views.os(os.numero);
    });
  }

  /* ---------- modal: checkout (Pix real EMV + NF) ---------- */
  function modalCheckout(os) {
    const total = WERK.totalOS(os, true);
    const payload = WERK.pixPayload(total, 'EVX' + os.numero);
    modal(`
      <h3>Checkout — OS #${os.numero}</h3>
      <div class="budget" style="margin-bottom:14px">
        ${os.itens.filter(i => i.aprovacao === 'aprovado').map(i => `
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:7px 0;border-bottom:1px dashed var(--line)">
            <span>${i.titulo} (${i.niveis[i.nivelEscolhido || 'original'].rotulo})</span><span>${WERK.brl(WERK.itemPreco(i))}</span>
          </div>`).join('')}
        <div style="display:flex;justify-content:space-between;font-family:var(--font-display);font-weight:800;font-size:16px;padding-top:10px">
          <span>Total</span><span style="color:var(--red)">${WERK.brl(total)}</span>
        </div>
      </div>
      <div class="pix-box">
        <div class="pix-qr"><canvas id="pixQr"></canvas></div>
        <div>
          <b style="font-family:var(--font-display);font-size:13px">Pix — QR dinâmico</b>
          <p style="font-size:11px;color:var(--txt-3);margin:4px 0 8px">Payload BR Code EMV real (CRC16 válido) · QR ilustrativo na demo — Orders API do Mercado Pago/Stone pluga aqui.</p>
          <div class="pix-copy" id="pixCopy">${payload}</div>
          <button class="quote-btn" style="margin-top:6px" id="pixCopyBtn">copiar código</button>
        </div>
      </div>
      <div class="wk-grid2" style="margin-top:14px">
        <div class="wfield"><label>Ou cartão parcelado</label>
          <select id="parcelas">${[1, 2, 3, 6, 10].map(p => `<option>${p}x de ${WERK.brl(Math.round(total / p))}${p > 1 ? ' s/ juros' : ''}</option>`).join('')}</select></div>
        <div class="wfield"><label>Janela de retirada</label>
          <select id="retirada"><option>Hoje · 17h–18h</option><option>Amanhã · 8h–9h</option><option>Amanhã · 12h–13h</option></select></div>
      </div>
      <div class="wk-actions" style="justify-content:flex-end;margin-top:14px">
        <button class="btn btn-primary" id="payOk">Confirmar pagamento (demo) → emitir NF</button>
      </div>`);
    fakeQR($('#pixQr'), payload);
    $('#pixCopyBtn').addEventListener('click', () => {
      navigator.clipboard && navigator.clipboard.writeText(payload);
      toast('Pix copia-e-cola copiado', 'Payload EMV com CRC16 válido.');
    });
    $('#payOk').addEventListener('click', () => {
      const cfgG = WERK.getConfig().garantiaMeses;
      WERK.updateOS(os.numero, o => {
        o.pagamento = { metodo: 'Pix', valor: total, ts: new Date().toISOString(), txid: 'EVX' + o.numero, retirada: $('#retirada').value };
        o.nf = { numero: `NFS-e 2026/${String(400 + o.numero % 100).padStart(6, '0')}`, ts: new Date().toISOString() };
        const fim = new Date(); fim.setMonth(fim.getMonth() + cfgG.peca);
        o.itens.forEach(i => { if (i.aprovacao === 'aprovado') i.garantia = { inicio: new Date().toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) }; });
      }, { tipo: 'entrega', titulo: 'Pagamento confirmado', desc: `Pix ${WERK.brl(total)} · NF emitida automaticamente · garantia por item ativada.`, ator: 'Financeiro' });
      if (typeof EVX !== 'undefined') EVX.pushNotification({ titulo: `OS #${os.numero} — pagamento confirmado`, texto: `Recibo e NF disponíveis no app. Retirada: ${$('#retirada').value}.`, quando: Date.now(), tipo: 'ok' });
      closeModal(); toast('Pagamento registrado', 'NF emitida e garantias ativadas.');
      views.os(os.numero);
    });
  }

  /* ---------- handlers do detalhe ---------- */
  function bindOSHandlers(os) {
    const dtcAdd = $('#dtcAdd');
    if (dtcAdd) dtcAdd.addEventListener('click', () => {
      const v = $('#dtcInput').value.trim();
      if (!v) return;
      WERK.updateOS(os.numero, o => o.dtcs.push(v), { tipo: 'update', titulo: 'DTC importado', desc: v, ator: os.tecnico });
      views.os(os.numero);
    });

    $$('[data-quote]').forEach(b => b.addEventListener('click', () => {
      const el = $('#q-' + b.dataset.quote);
      if (el) el.hidden = !el.hidden;
    }));

    let mediaThumb = null;
    const niMedia = $('#ni-media');
    if (niMedia) niMedia.addEventListener('change', () => {
      if (!niMedia.files[0]) return;
      fileToThumb(niMedia.files[0], url => {
        mediaThumb = url;
        $('#ni-media-slot').classList.add('filled');
        $('#ni-media-label').textContent = 'foto anexada ✓';
      });
    });
    const niAdd = $('#ni-add');
    if (niAdd) niAdd.addEventListener('click', () => {
      const titulo = $('#ni-titulo').value.trim();
      const sev = $('#ni-sev').value;
      if (!titulo) { $('#ni-titulo').focus(); return; }
      if (sev !== 'ok' && !mediaThumb) { toast('Mídia obrigatória', 'Item 🔴/🟡 sem foto/vídeo não entra no DVI — regra dura.'); return; }
      WERK.updateOS(os.numero, o => {
        o.itens.push(WERK.novoItem(o, { titulo, severidade: sev, nota: $('#ni-nota').value.trim(), midia: mediaThumb || 'demo', categoria: $('#ni-cat').value }, WERK.getConfig()));
      }, { tipo: 'update', titulo: 'Item de diagnóstico adicionado', desc: `${sevIcon[sev]} ${titulo}`, ator: os.tecnico });
      views.os(os.numero);
    });

    const send = $('#chatSend');
    if (send) send.addEventListener('click', () => {
      const t = $('#chatInput').value.trim();
      if (!t) return;
      WERK.chatSend(os.numero, os.consultor || 'Consultor', t);
      if (typeof EVX !== 'undefined') EVX.pushNotification({ titulo: `Mensagem do consultor — OS #${os.numero}`, texto: t, quando: Date.now(), tipo: 'os' });
      views.os(os.numero);
    });
  }

  /* ============================================================
     VIEW · VEÍCULOS & PRONTUÁRIO
     ============================================================ */
  views.veiculos = (vin) => {
    const veics = WERK.getVehicles();
    if (vin) {
      const v = veics.find(x => x.vin === vin);
      if (!v) { go('veiculos'); return; }
      const historia = WERK.getAllOS().filter(o => o.vin === vin);
      const recalls = WERK.checkRecalls(vin);
      main.innerHTML = head(v.modelo, `VIN ${v.vin} · ${v.placa} · ${v.cliente}`,
        `<a class="btn btn-secondary" href="documento.html?tipo=prontuario&vin=${vin}" target="_blank">📄 Prontuário completo (PDF)</a>
         <button class="btn btn-secondary" onclick="location.hash='#/veiculos'">← Veículos</button>`) + `
        <div class="kpis">
          <div class="kpi"><div class="n">${(v.km || 0).toLocaleString('pt-BR')}</div><div class="t">km registrados</div></div>
          <div class="kpi"><div class="n">${historia.length}</div><div class="t">OS no prontuário</div></div>
          <div class="kpi"><div class="n">${WERK.brl(historia.reduce((s, o) => s + (o.pagamento ? o.pagamento.valor : 0), 0))}</div><div class="t">investido em manutenção</div></div>
          <div class="kpi"><div class="n ${recalls.length ? 'neg' : ''}">${recalls.length}</div><div class="t">recalls abertos</div></div>
        </div>
        ${recalls.map(r => `<div class="wk-panel" style="border-color:rgba(217,162,27,.5)"><h3>⚠ ${r.codigo} — ${r.titulo}</h3><p style="font-size:12px;color:var(--txt-2)">Detectado automaticamente no check-in. Oferecer atendimento do recall = confiança + serviço.</p></div>`).join('')}
        <div class="wk-grid2">
          <div class="wk-panel">
            <h3>${I('doc')} Histórico de OS (prontuário vitalício)</h3>
            ${historia.map(o => `
              <div class="kcard" style="margin-bottom:8px" onclick="location.hash='#/os/${o.numero}'">
                <b>OS #${o.numero} · ${WERK.fd(o.criada)}</b>
                <div class="kv">${o.sintoma ? o.sintoma.slice(0, 80) : (o.itens[0] ? o.itens[0].titulo : '')} · ${o.status === 'entregue' ? '✓ entregue' : WERK.STATUS[WERK.statusIdx(o.status)].nome}</div>
                <div class="kfoot"><div class="sev-pills">${o.itens.map(i => `<span class="sev ${i.severidade}"></span>`).join('')}</div><span class="ktec">${WERK.brl(WERK.totalOS(o, true))}</span></div>
              </div>`).join('') || '<p style="font-size:12px;color:var(--txt-3)">Sem OS registradas.</p>'}
          </div>
          <div>
            <div class="wk-panel">
              <h3>${I('key')} Cofre digital do veículo</h3>
              ${(v.cofre || []).map(d => `<div style="display:flex;gap:9px;align-items:center;font-size:12.5px;color:var(--txt-2);padding:8px 0;border-bottom:1px dashed var(--line)">${I('doc', 15)} ${d}</div>`).join('') || '<p style="font-size:12px;color:var(--txt-3)">Nenhum documento no cofre.</p>'}
              <p style="font-size:10.5px;color:var(--txt-3);margin-top:8px">Manual, nota da chave codificada, laudos — o cliente acessa tudo no app.</p>
            </div>
            <div class="wk-panel">
              <h3>${I('shield')} Garantias ativas</h3>
              ${historia.flatMap(o => o.itens.filter(i => i.garantia).map(i => `
                <div style="display:flex;justify-content:space-between;font-size:12px;padding:8px 0;border-bottom:1px dashed var(--line)">
                  <span>${i.titulo}<br><em style="color:var(--txt-3);font-style:normal;font-size:10.5px">OS #${o.numero} · peça + MO</em></span>
                  <b style="color:var(--ok);font-family:var(--font-display)">até ${WERK.fd(i.garantia.fim)}</b>
                </div>`)).join('') || '<p style="font-size:12px;color:var(--txt-3)">Sem garantias ativas.</p>'}
            </div>
          </div>
        </div>`;
      return;
    }
    main.innerHTML = head('Veículos & Prontuário', 'Pesquisou o chassi, aparece a vida inteira do carro.',
      `<button class="btn btn-primary" onclick="location.hash='#/checkin'">+ Novo check-in</button>`) + `
      <div class="wk-panel">
        <table class="wk-table">
          <tr><th>VIN</th><th>Veículo</th><th>Placa</th><th>Cliente</th><th class="num">km</th><th class="num">OS</th><th></th></tr>
          ${veics.map(v => `
            <tr style="cursor:pointer" onclick="location.hash='#/veiculos/${v.vin}'">
              <td><code style="font-size:10.5px;color:var(--blue-light)">${v.vin}</code></td>
              <td><b>${v.modelo}</b></td><td>${v.placa || '—'}</td><td>${v.cliente || '—'}</td>
              <td class="num">${(v.km || 0).toLocaleString('pt-BR')}</td>
              <td class="num">${WERK.getAllOS().filter(o => o.vin === v.vin).length}</td>
              <td>${WERK.checkRecalls(v.vin).length ? '<span class="ap-badge pendente">recall</span>' : ''}</td>
            </tr>`).join('')}
        </table>
      </div>`;
  };

  /* ============================================================
     VIEW · CLIENTES & ACESSO AO APP
     ============================================================ */
  views.clientes = () => {
    const clientes = WERK.getClientes();
    const oss = WERK.getAllOS();
    main.innerHTML = head('Clientes & Acesso', 'O acesso nasce no check-in: link de convite → cliente cria a senha → login por telefone.',
      `<button class="btn btn-primary" onclick="location.hash='#/checkin'">+ Novo check-in</button>`) + `
      <div class="wk-panel">
        <table class="wk-table">
          <tr><th>Cliente</th><th>Telefone (login)</th><th>Garagem</th><th class="num">OS</th><th>Acesso</th><th></th></tr>
          ${clientes.map(c => {
            const g = WERK.garagemDe(c.telefone);
            const n = oss.filter(o => WERK.normTel(o.telefone) === WERK.normTel(c.telefone)).length;
            return `
            <tr>
              <td><b>${c.nome}</b></td>
              <td>${c.telefone}</td>
              <td style="font-size:11px">${g.map(v => v.placa).join(' · ') || '—'}</td>
              <td class="num">${n}</td>
              <td>${c.senha ? `<span class="ap-badge aprovado">ativo${c.ativadoEm ? ' · ' + WERK.fd(c.ativadoEm) : ''}</span>` : '<span class="ap-badge pendente">convite pendente</span>'}</td>
              <td style="white-space:nowrap">
                <button class="quote-btn" data-copy-convite="${c.convite}">copiar link</button>
                <a class="quote-btn" target="_blank" rel="noopener" href="${WERK.waLink(c.telefone, `Olá, ${c.nome.split(' ')[0]}! Acompanhe seu BMW pelo app EUROVIX: ${WERK.conviteUrl(c)}`)}">WhatsApp</a>
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="6" style="color:var(--txt-3)">Nenhum cliente ainda — o cadastro nasce no check-in.</td></tr>'}
        </table>
        <p style="font-size:10.5px;color:var(--txt-3);margin-top:10px">A garagem segue o telefone do último check-in de cada placa: trocou de dono, o carro migra sozinho para o acesso do novo dono — e o histórico pago continua com quem pagou. Prontuário completo (por VIN) exportável em Veículos.</p>
      </div>`;
    $$('[data-copy-convite]').forEach(b => b.addEventListener('click', () => {
      const c = WERK.clientePorConvite(b.dataset.copyConvite);
      if (!c) return;
      navigator.clipboard.writeText(WERK.conviteUrl(c));
      toast('Link copiado', c.senha ? 'Cliente já ativo — o link só reabre o app.' : 'Envie ao cliente: ele cria a senha no primeiro acesso.');
    }));
  };

  /* ============================================================
     VIEW · MOTOR DE PEÇAS (playground das 4 camadas)
     ============================================================ */
  views.pecas = () => {
    main.innerHTML = head('Motor de Peças por Chassi', 'VIN → ETK → part number → TecDoc cross-ref → cotação multi-fornecedor. Zero digitação de código.') + `
      <div class="wk-panel">
        <div class="wk-grid3">
          <div class="wfield"><label>Família (via VIN na OS real)</label>
            <select id="mp-fam"><option value="f40">M135i (F40)</option><option value="g20">320i (G20)</option><option value="f48">X1 (F48)</option><option value="g80">M3 (G80)</option></select></div>
          <div class="wfield"><label>Categoria da peça</label>
            <select id="mp-cat">${WERK.CATEGORIAS.filter(c => c !== 'outro').map(c => `<option value="${c}">${c.replace('_', ' ')}</option>`).join('')}</select></div>
          <div class="wfield"><label>&nbsp;</label><button class="btn btn-primary" style="width:100%" id="mp-run">Resolver peça →</button></div>
        </div>
        <div id="mp-out" style="margin-top:16px"></div>
      </div>
      <div class="wk-panel">
        <h3>${I('chart')} Como funciona em produção</h3>
        <table class="wk-table">
          <tr><th>Camada</th><th>Fonte</th><th>O que entrega</th><th>Status na demo</th></tr>
          <tr><td><b>1 · ETK</b></td><td>Catálogo eletrônico BMW (RealOEM)</td><td>VIN → variante exata → part number</td><td>mock fiel por família</td></tr>
          <tr><td><b>2 · PartsLink24</b></td><td>Portal oficial B2B</td><td>Preço + disponibilidade original em tempo real</td><td>tabela de referência</td></tr>
          <tr><td><b>3 · TecDoc</b></td><td>API comercial</td><td>Cross-ref OE → OEM/aftermarket validado</td><td>cross-ref estático</td></tr>
          <tr><td><b>4 · Cotação</b></td><td>Fornecedores cadastrados</td><td>Comparativo preço × prazo × nível</td><td>5 fornecedores simulados</td></tr>
        </table>
      </div>`;
    $('#mp-run').addEventListener('click', () => {
      const eng = WERK.motorDePecas($('#mp-cat').value, $('#mp-fam').value, WERK.getConfig());
      $('#mp-out').innerHTML = `
        <div class="diag-item">
          <div class="di-head"><b>${eng.descricao}</b><span class="sev-badge ok">ETK ✓</span><code>${eng.partNumber}</code><span style="font-size:11px;color:var(--txt-2)">${eng.aw} AW = ${WERK.brl(eng.mo)} MO</span></div>
          <table class="lvl-table">
            <tr><th>Nível</th><th>Fabricante</th><th>Part #</th><th>Custo</th><th>Margem</th><th>Preço cliente</th><th>Cotações</th></tr>
            ${['original', 'oem', 'aftermarket'].map(k => {
              const n = eng.niveis[k];
              return `<tr><td><b style="font-family:var(--font-display)">${n.rotulo}</b></td><td>${n.fabricante}</td><td><code style="font-size:10px">${n.partNumber}</code></td>
                <td>${WERK.brl(n.custo)}</td><td>${WERK.getConfig().margens[k]}%</td><td class="pr">${WERK.brl(n.preco)}</td>
                <td style="font-size:10.5px">${n.cotacoes.map(c => `${c.fornecedor.split(' ')[0]} ${WERK.brl(c.custo)}·${c.prazo}d`).join(' | ')}</td></tr>`;
            }).join('')}
          </table>
        </div>`;
    });
  };

  /* ============================================================
     VIEW · GESTÃO (DRE, comissão, ABC, exports)
     ============================================================ */
  views.gestao = () => {
    const all = WERK.getAllOS();
    const pagas = all.filter(o => o.pagamento);
    const fat = pagas.reduce((s, o) => s + o.pagamento.valor, 0);
    const custos = pagas.reduce((s, o) => s + WERK.custoOS(o), 0);
    const cfg = WERK.getConfig();

    const awPorTec = {};
    all.forEach(o => o.itens.forEach(i => {
      if (i.aprovacao !== 'aprovado') return;
      awPorTec[o.tecnico] = (awPorTec[o.tecnico] || 0) + i.aw;
    }));

    const pecasCount = {};
    all.forEach(o => o.itens.forEach(i => {
      if (i.aprovacao !== 'aprovado') return;
      pecasCount[i.pecaDescricao] = (pecasCount[i.pecaDescricao] || { qtd: 0, valor: 0 });
      pecasCount[i.pecaDescricao].qtd++;
      pecasCount[i.pecaDescricao].valor += i.niveis[i.nivelEscolhido || 'original'].preco;
    }));
    const abc = Object.entries(pecasCount).sort((a, b) => b[1].valor - a[1].valor);

    main.innerHTML = head('Gestão & DRE', 'Margem real por OS, produção por técnico e curva ABC — dados vivos do sistema.',
      `<button class="btn btn-secondary" id="csvDre">⬇ DRE (CSV)</button><button class="btn btn-secondary" id="csvAbc">⬇ Curva ABC (CSV)</button>`) + `
      <div class="kpis">
        <div class="kpi"><div class="n">${WERK.brl(fat)}</div><div class="t">faturamento (OS pagas)</div></div>
        <div class="kpi"><div class="n">${WERK.brl(pagas.length ? Math.round(fat / pagas.length) : 0)}</div><div class="t">ticket médio</div></div>
        <div class="kpi"><div class="n pos">${fat ? Math.round((fat - custos) / fat * 100) : 0}%</div><div class="t">margem bruta média</div></div>
        <div class="kpi"><div class="n">${Object.values(awPorTec).reduce((a, b) => a + b, 0)} <em>AW</em></div><div class="t">produção total aprovada</div></div>
      </div>
      <div class="wk-panel">
        <h3>${I('chart')} DRE por OS</h3>
        <table class="wk-table" id="dreTable">
          <tr><th>OS</th><th>Cliente</th><th>Status</th><th class="num">Receita</th><th class="num">Custo peça</th><th class="num">MO</th><th class="num">Margem</th><th class="num">%</th></tr>
          ${all.map(o => {
            const rec = WERK.totalOS(o, true);
            const cst = WERK.custoOS(o);
            const mo = o.itens.filter(i => i.aprovacao === 'aprovado').reduce((s, i) => s + i.mo, 0);
            const mg = rec - cst;
            return `<tr>
              <td><b>#${o.numero}</b></td><td>${o.cliente}</td>
              <td>${o.status === 'entregue' ? '✓ entregue' : WERK.STATUS[WERK.statusIdx(o.status)].nome}</td>
              <td class="num">${WERK.brl(rec)}</td><td class="num">${WERK.brl(cst)}</td><td class="num">${WERK.brl(mo)}</td>
              <td class="num ${mg >= 0 ? 'pos' : 'neg'}">${WERK.brl(mg)}</td>
              <td class="num">${rec ? Math.round(mg / rec * 100) + '%' : '—'}</td></tr>`;
          }).join('')}
        </table>
      </div>
      <div class="wk-grid2">
        <div class="wk-panel">
          <h3>${I('badge')} Comissão por técnico (AW produzido)</h3>
          <table class="wk-table">
            <tr><th>Técnico</th><th class="num">AW</th><th class="num">Horas</th><th class="num">Comissão (12% MO)</th></tr>
            ${Object.entries(awPorTec).map(([t, aw]) => `
              <tr><td><b>${t}</b></td><td class="num">${aw}</td><td class="num">${(aw / 12).toFixed(1)}h</td>
              <td class="num pos">${WERK.brl(Math.round(aw / 12 * cfg.valorHora * 0.12))}</td></tr>`).join('') || '<tr><td colspan="4">Sem produção aprovada.</td></tr>'}
          </table>
          <p style="font-size:10.5px;color:var(--txt-3);margin-top:8px">Painel do técnico em tempo real — fim da planilha de comissão.</p>
        </div>
        <div class="wk-panel">
          <h3>${I('part')} Curva ABC de peças</h3>
          <table class="wk-table">
            <tr><th>Peça</th><th class="num">Qtd</th><th class="num">Valor</th></tr>
            ${abc.map(([p, d]) => `<tr><td>${p}</td><td class="num">${d.qtd}</td><td class="num">${WERK.brl(d.valor)}</td></tr>`).join('') || '<tr><td colspan="3">Sem dados ainda.</td></tr>'}
          </table>
        </div>
      </div>`;

    const csv = (rows, name) => {
      const blob = new Blob(['﻿' + rows.map(r => r.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      toast('Export gerado', name);
    };
    $('#csvDre').addEventListener('click', () => csv([
      ['OS', 'Cliente', 'Status', 'Receita', 'CustoPeca', 'MO', 'Margem'],
      ...all.map(o => [o.numero, o.cliente, o.status, WERK.totalOS(o, true), WERK.custoOS(o),
        o.itens.filter(i => i.aprovacao === 'aprovado').reduce((s, i) => s + i.mo, 0),
        WERK.totalOS(o, true) - WERK.custoOS(o)]),
    ], 'eurovix-dre.csv'));
    $('#csvAbc').addEventListener('click', () => csv([['Peca', 'Qtd', 'Valor'], ...abc.map(([p, d]) => [p, d.qtd, d.valor])], 'eurovix-abc.csv'));
  };

  /* ============================================================
     VIEW · CONFIG
     ============================================================ */
  views.config = () => {
    const c = WERK.getConfig();
    main.innerHTML = head('Configurações', 'Valor-hora, margens por nível e dados da oficina — aplicados no motor de orçamento.') + `
      <div class="wk-panel">
        <h3>${I('tool')} Motor de orçamento</h3>
        <div class="wk-grid3">
          <div class="wfield"><label>Valor-hora de MO (R$) — 12 AW/h</label><input id="cf-hora" type="number" value="${c.valorHora}"></div>
          <div class="wfield"><label>Garantia peça (meses)</label><input id="cf-gp" type="number" value="${c.garantiaMeses.peca}"></div>
          <div class="wfield"><label>Garantia MO (meses)</label><input id="cf-gm" type="number" value="${c.garantiaMeses.mo}"></div>
        </div>
        <div class="wk-grid3" style="margin-top:12px">
          <div class="wfield"><label>Margem Original (%)</label><input id="cf-mo" type="number" value="${c.margens.original}"></div>
          <div class="wfield"><label>Margem OEM (%)</label><input id="cf-me" type="number" value="${c.margens.oem}"></div>
          <div class="wfield"><label>Margem Aftermarket (%)</label><input id="cf-ma" type="number" value="${c.margens.aftermarket}"></div>
        </div>
      </div>
      <div class="wk-panel">
        <h3>${I('home')} Dados da oficina</h3>
        <div class="wk-grid2">
          <div class="wfield"><label>Chave Pix (recebimento)</label><input id="cf-pix" value="${c.oficina.pixChave}"></div>
          <div class="wfield"><label>CNPJ</label><input id="cf-cnpj" value="${c.oficina.cnpj}"></div>
        </div>
      </div>
      ${WERK.cloud ? `
      <div class="wk-panel">
        <h3>${I('user')} Sessão da equipe (nuvem)</h3>
        <p style="font-size:12px;color:var(--txt-2);margin-bottom:10px">Conectado como <b>${(WERK.authUser() || {}).email || '—'}</b> · dados servidos pelo Supabase com RLS.</p>
        <button class="btn btn-secondary" id="cf-sair">Sair do WERK OS</button>
      </div>` : ''}
      <div class="wk-actions" style="justify-content:space-between">
        <button class="btn btn-secondary" id="cf-seed15">🚗 Carga de teste: +15 OS</button>\n        <button class="btn btn-secondary" id="cf-reset">${WERK.cloud ? '↺ Limpar cache local' : '↺ Resetar demo (limpa localStorage)'}</button>
        <button class="btn btn-primary" id="cf-save">Salvar configurações</button>
      </div>`;
    $('#cf-save').addEventListener('click', () => {
      const c2 = WERK.getConfig();
      c2.valorHora = +$('#cf-hora').value || 380;
      c2.margens = { original: +$('#cf-mo').value, oem: +$('#cf-me').value, aftermarket: +$('#cf-ma').value };
      c2.garantiaMeses = { peca: +$('#cf-gp').value, mo: +$('#cf-gm').value };
      c2.oficina.pixChave = $('#cf-pix').value;
      c2.oficina.cnpj = $('#cf-cnpj').value;
      WERK.saveConfig(c2);
      toast('Configurações salvas', 'Novos orçamentos usam os valores atualizados.');
    });
    $('#cf-seed15').addEventListener('click', () => {
      if (WERK.cloud) { toast('Indisponível na nuvem', 'A carga de teste é exclusiva do modo demonstração — produção só recebe dados reais.'); return; }
      const modelos = [
        ['WBA7A91000', 'BMW 320i M Sport (G20)'], ['WBA5U71000', 'BMW M135i xDrive (F40)'],
        ['WBAJA51000', 'BMW X1 sDrive20i (F48)'], ['WBS8M91000', 'BMW M3 Competition (G80)'],
        ['WBY7Z21000', 'BMW i4 eDrive40 (G26)'],
      ];
      const nomes = ['Carlos Souza', 'Fernanda Lima', 'João Pedro', 'Mariana Alves', 'Rafael Torres', 'Beatriz Melo', 'Gustavo Rocha', 'Larissa Prado', 'Eduardo Nunes', 'Camila Duarte'];
      const fones = nomes.map((_, i) => `(27) 9910${i}-000${i}`); // fictícios, determinísticos por nome
      const cats = ['oleo', 'freio_d', 'disco_d', 'vela', 'amortecedor', 'bieleta', 'bomba_agua', 'correia'];
      const cfg2 = WERK.getConfig();
      const AL = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
      const rnd = (n) => Math.floor(Math.random() * n);
      for (let i = 0; i < 15; i++) {
        const [pref, nomeM] = modelos[rnd(modelos.length)];
        let sufixo = '';
        for (let j = 0; j < 7; j++) sufixo += AL[rnd(AL.length)];
        const vin = WERK.fixVIN(pref + sufixo);
        const placa = AL[rnd(24)] + AL[rnd(24)] + AL[rnd(24)] + '-' + rnd(10) + AL[rnd(24)] + rnd(10) + rnd(10);
        const ni = rnd(nomes.length);
        const odo = 20000 + rnd(90000);
        const os = WERK.novaOS({
          vin, veiculo: nomeM, placa,
          cliente: nomes[ni], telefone: fones[ni],
          sintoma: 'OS de carga de teste.',
          tecnico: cfg2.tecnicos[rnd(cfg2.tecnicos.length)].nome,
          checkin: { ts: new Date().toISOString(), odometro: odo, combustivel: 25 + rnd(70), itens: {}, luzes: [], danos: [], fotos: 4, assinatura: true },
          ator: 'Carga de teste',
        });
        WERK.upsertVehicle({ vin, ...WERK.decodeVIN(vin), placa, km: odo, cliente: nomes[ni], telefone: fones[ni] });
        WERK.upsertCliente({ nome: nomes[ni], telefone: fones[ni] });
        const stIdx = rnd(WERK.STATUS.length);
        WERK.updateOS(os.numero, (o) => {
          const nItens = 1 + rnd(3);
          for (let k = 0; k < nItens; k++) {
            const sev = ['critico', 'preventivo', 'preventivo'][rnd(3)];
            const it = WERK.novoItem(o, { titulo: 'Item de teste ' + (k + 1), severidade: sev, nota: '', midia: 'demo', categoria: cats[rnd(cats.length)] }, cfg2);
            if (stIdx > 2) { it.aprovacao = 'aprovado'; it.nivelEscolhido = ['original', 'oem', 'aftermarket'][rnd(3)]; }
            o.itens.push(it);
          }
          if (stIdx > 2) o.aceite = { assinatura: true, ip: 'teste', hash: 'carga-' + o.numero, ts: new Date().toISOString() };
          o.status = WERK.STATUS[stIdx].id;
        });
      }
      toast('Carga criada', '15 OS de teste espalhadas pelo quadro — veja o modo Grade.');
      location.hash = '#/kanban';
      route();
    });

    $('#cf-reset').addEventListener('click', () => {
      if (WERK.cloud) {
        if (!confirm('Limpar apenas o CACHE local? Os dados reais continuam intactos no banco (nuvem).')) return;
      } else if (!confirm('Limpar todos os dados da demo (OS, veículos, notificações)?')) return;
      Object.keys(localStorage).filter(k => k.startsWith('evx.')).forEach(k => localStorage.removeItem(k));
      location.reload();
    });
    const sair = $('#cf-sair');
    if (sair) sair.addEventListener('click', async () => { await WERK.logoutAuth(); location.reload(); });
  };

  /* Tempo real entre abas: aprovações/mudanças feitas no app
     do cliente redesenham a view atual do painel na hora. */
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('evx.') && !$('#wkModal').classList.contains('open')) route();
  });
  window.addEventListener('evx:sync', () => { // realtime da nuvem
    if (!$('#wkModal').classList.contains('open')) route();
  });

  WERK.ready.then(route);
})();
