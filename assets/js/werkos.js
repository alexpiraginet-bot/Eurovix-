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
  const bnome = () => { try { return (WERK.marca && WERK.marca().displayNome) || 'a oficina'; } catch (_) { return 'a oficina'; } };
  // Buffer em memória (não persistido) da última leitura anexada por OS: permite
  // "aprofundar com IA" depois de uma leitura local (dicionário), sem reanexar.
  const laudoBuf = {};
  // Carrega o banco OBD-II mundial cedo, para as estatísticas do dicionário já aparecerem.
  try { if (WERK && WERK.carregarSeedObd) WERK.carregarSeedObd(); } catch (_) {}

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

  // Logo da oficina → dataURL PNG (preserva transparência; até 400px no maior lado).
  function logoToDataURL(file, cb) {
    if (file && file.type === 'image/svg+xml') { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(file); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const k = Math.min(1, 400 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/png'));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  // ---- Scanner: extrai a MEMÓRIA DE FALHAS de um PDF no navegador (pdf.js) ----
  // Manda só o texto relevante à IA em vez das páginas do PDF como imagem → ~10× menos
  // tokens de entrada (o PDF inteiro seria tokenizado; o texto filtrado, não).
  // Reconhece os dois padrões: hex proprietário prefixado com "0x" (BMW ISTA) E
  // código SAE/OBD-II (P/C/B/U + 4 díg. — Autel, Launch, ELM327, genéricos).
  const RE_COD = /[0-9A-Fa-f]{5,6}|[PBCU][0-3][0-9A-F]{3}/;              // núcleo do código
  const RE_COD_LINHA = new RegExp('^► (' + RE_COD.source + ') · (.*)$', 'i');
  async function pdfFalhasTexto(file) {
    if (!window.pdfjsLib) return '';
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      // Concatena os itens SEM espaço extra: o ISTA fragmenta os glifos do código
      // (ex.: "8", "040D2") — só juntando sem espaço o código sobrevive inteiro.
      let raw = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const items = (await (await pdf.getPage(i)).getTextContent()).items;
        raw += items.map(it => it.str).join('') + '\n';
      }
      if (raw.replace(/\s/g, '').length < 400) return ''; // PDF escaneado (imagem) → sem texto útil
      // Marca uma linha por falha: hex com "0x" (BMW) e SAE/OBD-II avulso (genérico).
      const linhas = raw
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/0x([0-9A-Fa-f]{5,6})/g, '\n► $1 · ')
        .replace(/([^0-9A-Za-z]|^)([PBCU][0-3][0-9A-F]{3})(?![0-9A-Za-z])/g, '$1\n► $2 · ')
        .split(/\r?\n/);
      const keep = [];
      for (let i = 0; i < Math.min(30, linhas.length); i++) { const s = linhas[i].trim(); if (s && !/^► /.test(s)) keep.push(s.slice(0, 200)); } // cabeçalho do veículo
      const vistos = new Set();
      for (const l of linhas) {
        const m = RE_COD_LINHA.exec(l.trim());
        if (!m) continue;
        const cod = m[1].toUpperCase(), desc = m[2].trim();
        const ehSae = /^[PBCU][0-3][0-9A-F]{3}$/i.test(cod);
        // hex proprietário exige prosa (descarta valores de codificação/ruído); código
        // SAE entra mesmo sem descrição — o dicionário/IA preenche o significado.
        if (!ehSae && (/^n\/a/i.test(desc) || !/[a-zà-ú]{3}/i.test(desc))) continue;
        if (vistos.has(cod)) continue; vistos.add(cod);
        keep.push('► ' + cod + ' · ' + desc.slice(0, 220));
      }
      if (!vistos.size) return ''; // formato não reconhecido → deixa o fallback mandar o PDF (imagem)
      return keep.join('\n').slice(0, 40000);
    } catch (_) { return ''; }
  }
  // Lista os códigos das linhas ► já extraídas (para tentar a leitura local sem IA).
  function codigosDoTexto(texto) {
    const out = []; const seen = new Set();
    for (const l of String(texto || '').split(/\r?\n/)) {
      const m = RE_COD_LINHA.exec(l.trim());
      if (!m) continue;
      const c = m[1].toUpperCase();
      if (seen.has(c)) continue; seen.add(c);
      out.push(c);
    }
    return out;
  }
  function lerArquivoDataUrl(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); }); }
  function fotoLaudo(file) { // comprime a foto do laudo p/ menos tokens, mantendo legível
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); const k = Math.min(1, 1500 / Math.max(img.width, img.height)); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.72)); URL.revokeObjectURL(img.src); };
      img.onerror = () => res(null);
      img.src = URL.createObjectURL(file);
    });
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
    // Produção: painel SÓ para STAFF — exige sessão E papel de equipe. Uma sessão
    // persistida qualquer (cliente, ativação stale, conta sem equipe) NÃO entra.
    if (WERK.cloud && !(WERK.authUser() && WERK.staffPerfil())) { renderStaffLock(); return; }
    const [v, param] = (location.hash.replace(/^#\//, '') || 'kanban').split('/');
    $$('.wk-nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    (views[v] || views.kanban)(param);
    wrapTables();
    $('#wkSide').classList.remove('open');
  }
  // Toda tabela larga ganha um contêiner com rolagem horizontal própria — no mobile
  // ela rola dentro do card em vez de estourar a página para o lado.
  function wrapTables() {
    $$('#wkMain table.wk-table').forEach(t => {
      if (t.parentElement && t.parentElement.classList.contains('wk-scroll')) return;
      const wrap = document.createElement('div');
      wrap.className = 'wk-scroll';
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });
  }
  // Ícones do menu: injeta os SVG do set do app (fim dos emojis "pobres").
  function pintarNavIcons() {
    $$('#wkNav button[data-icon]').forEach(b => {
      if (b.querySelector('svg.ico')) return;
      b.insertAdjacentHTML('afterbegin', I(b.dataset.icon, 18));
    });
  }
  window.addEventListener('hashchange', route);

  function renderStaffLock() {
    $$('.wk-nav button').forEach(b => b.classList.remove('on'));
    const u = WERK.cloud ? WERK.authUser() : null;
    // Tem sessão mas não é staff (cliente logado, ativação de outra conta, etc.) → não é login inválido.
    if (u && !WERK.staffPerfil()) {
      main.innerHTML = `
        <div class="wk-lock">
          <div class="wk-lock-card">
            <div class="wk-lock-mark"><span>Lex</span>OS</div>
            <h2>Acesso restrito à equipe</h2>
            <p>Você está conectado como <b>${esc(u.email || '—')}</b>, mas esta conta não faz parte da equipe de nenhuma oficina.</p>
            <p class="wk-lock-sub">Se você é da equipe, peça ao administrador para incluir este e-mail em <b>Equipe</b>. Para usar outra conta, saia primeiro.</p>
            <button class="btn btn-primary" id="stSair">Sair e entrar com outra conta</button>
            <a class="wk-lock-alt" href="app.html">Sou cliente — ir para o app →</a>
          </div>
        </div>`;
      $('#stSair').addEventListener('click', async () => { await WERK.logoutAuth(); location.reload(); });
      return;
    }
    main.innerHTML = `
      <div class="wk-lock">
        <div class="wk-lock-card">
          <div class="wk-lock-mark"><span>Lex</span>OS</div>
          <h2>Painel da oficina</h2>
          <p class="wk-lock-sub">Entre com seu usuário de equipe para abrir o painel da sua oficina.</p>
          <div class="wfield"><label>E-mail</label><input id="st-email" type="email" placeholder="voce@suaoficina.com.br" autocomplete="username"></div>
          <div class="wfield" style="margin-top:12px"><label>Senha</label><input id="st-senha" type="password" autocomplete="current-password" placeholder="••••••••"></div>
          <div class="hintline err" id="stErr" style="display:none;margin-top:10px">E-mail ou senha inválidos — ou este usuário ainda não foi incluído na equipe da oficina.</div>
          <button class="btn btn-primary" style="margin-top:16px;width:100%" id="stEntrar">Entrar no painel</button>
          <a class="wk-lock-alt" href="app.html">O app do cliente é por aqui →</a>
          <a class="wk-lock-alt" href="demo.html">🧪 Ver uma demonstração (sem conta) →</a>
        </div>
      </div>`;
    const entrar = async () => {
      const btn = $('#stEntrar'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Entrando…';
      const u2 = await WERK.loginStaff($('#st-email').value.trim(), $('#st-senha').value);
      if (u2) { renderBrand(); route(); } else { $('#stErr').style.display = 'block'; btn.disabled = false; btn.textContent = t; }
    };
    $('#stEntrar').addEventListener('click', entrar);
    $('#st-senha').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
  }
  $$('.wk-nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  pintarNavIcons(); // ícones SVG do menu (no lugar dos emojis)

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
      `<button type="button" class="btn btn-primary wk-cta-checkin" onclick="location.hash='#/checkin'">${I('scan', 18)} Novo check-in</button>`) + `
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
    ck.step = 1; ck.fotos = {}; ck.danos = []; ck.sig = null; ck.view3 = null;
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
              <label>VIN (chassi) <span style="font-weight:400;color:var(--txt-3);text-transform:none;letter-spacing:0">— opcional por ora</span></label>
              <input id="ck-vin" maxlength="17" placeholder="WBA5U710X07L90210 (opcional)" style="text-transform:uppercase" value="${ck.vin || ''}">
              <div class="hintline" id="vinHint">Se preencher, valido o dígito verificador (ISO 3779). Sem VIN, o check-in segue normalmente — dá pra completar depois.</div>
            </div>
            <div class="wfield">
              <label>Placa</label>
              <input id="ck-placa" maxlength="8" placeholder="ABC-1D23" style="text-transform:uppercase" value="${ck.placa || ''}">
              <button type="button" class="ck-ai-btn" id="ckPlaca">${I('scan', 15)} Ler placa &amp; puxar dados do veículo</button>
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
      $('#ckPlaca').addEventListener('click', async () => {
        const btn = $('#ckPlaca'); const placaVal = $('#ck-placa').value;
        if (!WERK.normPlaca(placaVal)) { toast('Placa', 'Digite a placa primeiro.'); return; }
        btn.disabled = true; btn.classList.add('loading'); const orig = btn.innerHTML; btn.textContent = 'Consultando…';
        try {
          const r = await WERK.consultarPlaca(placaVal);
          if (!r.ok) { toast('Placa não encontrada', r.erro); return; }
          $('#ck-placa').value = r.placa;
          if (r.vin) { vinInput.value = r.vin; checkVin(); }
          const fonteTxt = r.fonte === 'api' ? 'consulta oficial' : r.fonte === 'garagem' ? 'já na garagem' : 'base demo';
          const det = [r.modelo || 'Veículo', r.anoModelo, r.cor, r.combustivel].filter(Boolean).join(' · ');
          toast('Veículo identificado', `${det} · ${fonteTxt}`);
        } finally { btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = orig; }
      });
      $('#ckNext1').addEventListener('click', () => {
        const raw = (vinInput.value || '').trim().toUpperCase();
        const v = WERK.validateVIN(raw);
        // VIN é OPCIONAL (até haver leitura automática da placa/etiqueta): se ficou
        // vazio ou não confere, alerta mas NÃO bloqueia o check-in.
        if (raw && !v.ok) { hint.className = 'hintline err'; hint.textContent = '⚠ ' + (v.motivo || 'VIN não confere') + ' — seguindo sem validar; ajuste depois se precisar.'; }
        if (!$('#ck-cli').value.trim()) { toast('Falta o cliente', 'Informe ao menos o nome do cliente.'); $('#ck-cli').focus(); return; }
        const vin = v.ok ? v.vin : raw;
        Object.assign(ck, {
          vin, placa: $('#ck-placa').value.toUpperCase(), cliente: $('#ck-cli').value.trim(),
          telefone: $('#ck-tel').value, tecnico: $('#ck-tec').value.split(' — ')[0], sintoma: $('#ck-sintoma').value.trim(),
          decoded: WERK.decodeVIN(vin),
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
            <div class="wfield"><label>Odômetro (km) — OCR na integração</label><input id="ck-odo" inputmode="numeric" value="${ck.odometro ?? ''}" placeholder="48500"></div>
            <div class="wfield"><label>Combustível: <b id="fuelLabel">${ck.combustivel ?? 50}%</b></label>
              <input id="ck-fuel" type="range" min="0" max="100" step="5" value="${ck.combustivel ?? 50}" style="accent-color:var(--red)"></div>
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
            <h3>${I('car')} Tour fotográfico 360° <span style="font-size:10px;color:var(--txt-3)">(mín. 4 fotos)</span></h3>
            <div class="media-grid" id="fotoGrid">
              ${FOTO_SLOTS.map((s, i) => `
                <label class="media-slot ${ck.fotos[i] ? 'filled' : ''}" data-i="${i}">
                  ${ck.fotos[i] ? `<img src="${ck.fotos[i]}" alt=""><span class="tagok">OK</span>` : `${I('scan', 18)}<span>${s}</span>`}
                  <input type="file" accept="image/*" capture="environment" hidden>
                </label>`).join('')}
            </div>
            <button type="button" class="ck-ai-btn primary" id="ckAnalisar">${I('scan', 15)} Analisar fotos com IA — km, combustível, luzes e avarias</button>
          </div>
          <div class="wk-panel">
            <h3>${I('alert')} Danos preexistentes <span style="font-size:10px;color:var(--txt-3)">— gire o carro 3D e toque num painel para marcar</span></h3>
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
            <button type="button" class="ck-ai-btn" id="ckReal3d" style="margin-top:12px">${I('car', 15)} Ver o modelo real (BMW) em 3D</button>
            <div id="ckReal3dBox" style="display:none;height:300px;margin-top:10px"></div>
          </div>
        </div>
        ${ck.iaResumo ? `
        <div class="wk-panel ck-ia-panel">
          <h3>${I('gauge')} Leitura da IA
            <span class="ck-ia-badge">${ck.iaResumo.modo === 'assistida' ? 'assistida' : 'IA'} · ${Math.round(ck.iaResumo.confianca * 100)}% confiança</span></h3>
          <div class="ck-ia-grid">
            <div class="ck-ia-cell"><span class="k">Odômetro</span><span class="v">${ck.iaResumo.km != null ? Number(ck.iaResumo.km).toLocaleString('pt-BR') + ' km' : (ck.iaResumo.kmRecepcao ? Number(ck.iaResumo.kmRecepcao).toLocaleString('pt-BR') + ' km · informado' : '— não lido')}</span></div>
            <div class="ck-ia-cell"><span class="k">Combustível</span><span class="v">${ck.iaResumo.combustivel != null ? ck.iaResumo.combustivel + '%' : '— não lido'}</span></div>
            <div class="ck-ia-cell"><span class="k">Luzes de alerta</span><span class="v">${ck.iaResumo.luzes.length ? ck.iaResumo.luzes.join(', ') : 'nenhuma'}</span></div>
            <div class="ck-ia-cell"><span class="k">Avarias marcadas</span><span class="v">${ck.iaResumo.avarias.length}</span></div>
            <div class="ck-ia-cell"><span class="k">Itens faltando</span><span class="v">${ck.iaResumo.itensFaltantes.length ? ck.iaResumo.itensFaltantes.join(', ') : 'nenhum'}</span></div>
            <div class="ck-ia-cell"><span class="k">A conferir</span><span class="v">${(ck.iaResumo.itensNaoVerificados || []).length ? ck.iaResumo.itensNaoVerificados.join(', ') : '—'}</span></div>
          </div>
          <p class="ck-ia-note">Campos pré-preenchidos acima — <b>revise e ajuste</b> antes de continuar. A IA marcou ${ck.iaResumo.avarias.length} avaria(s) na silhueta.</p>
          <button type="button" class="ck-ai-btn" id="ckSugerir">Sugerir orçamento a partir dos sinais</button>
          ${ck.iaOrcamento ? `<div class="ck-ia-orc">${ck.iaOrcamento.map(o => `<div class="orc-row"><span>${o.descricao} <small>${o.motivo}</small></span><b>${WERK.brl(o.preco)}</b></div>`).join('')}<div class="orc-foot">Sugestões — o consultor confirma o que entra na OS.</div></div>` : ''}
        </div>` : ''}
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
      const _map = $('#carMap');
      if (_map && window.WERK3D && WERK3D.supported) {          // carro 3D interativo (com fallback 2D abaixo)
        ck._v3 = WERK3D.mount(_map, {
          danos: ck.danos, view: ck.view3,
          onView: v => { ck.view3 = v; },
          onAdd: (d) => {
            const nota = prompt('Descreva o dano (ex.: risco no para-choque):');
            if (!nota) return;
            ck.danos.push(Object.assign({}, d, { nota })); snap2(); renderCheckin();
          },
          onPick: (i) => {
            const d = ck.danos[i];
            if (d && confirm('Remover a avaria "' + (d.nota || '') + '"?')) { ck.danos.splice(i, 1); snap2(); renderCheckin(); }
          },
        });
      } else if (_map) {                                        // fallback: silhueta 2D (sem WebGL/CSS-3D)
        _map.addEventListener('click', e => {
          if (e.target.closest('.dmark')) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = Math.round((e.clientX - r.left) / r.width * 100);
          const y = Math.round((e.clientY - r.top) / r.height * 100);
          const nota = prompt('Descreva o dano (ex.: risco no para-choque):');
          if (nota) { ck.danos.push({ x, y, nota }); snap2(); renderCheckin(); }
        });
      }
      body.addEventListener('click', e => {
        const del = e.target.dataset && e.target.dataset.del;
        if (del != null && e.target.tagName === 'BUTTON') { ck.danos.splice(+del, 1); snap2(); renderCheckin(); }
      });
      const _r3 = $('#ckReal3d');                              // showcase do modelo 3D real (BMW · Sketchfab)
      if (_r3) _r3.addEventListener('click', () => {
        const box = $('#ckReal3dBox'); if (!box) return;
        if (box.style.display !== 'none') { box.style.display = 'none'; _r3.innerHTML = I('car', 15) + ' Ver o modelo real (BMW) em 3D'; return; }
        box.style.display = 'block';
        if (!box.dataset.loaded && window.WERK3D && WERK3D.embedReal) {
          try { WERK3D.embedReal(box, (ck.decoded && ck.decoded.modelo) || ck.placa || 'BMW'); box.dataset.loaded = '1'; }
          catch (_) { box.innerHTML = '<div style="padding:14px;color:var(--txt-3);font-size:12px">Modelo 3D indisponível offline.</div>'; }
        }
        _r3.innerHTML = '▲ Ocultar modelo 3D real';
      });
      $('#ckAnalisar').addEventListener('click', async () => {
        if (Object.keys(ck.fotos).length < 1) { toast('Sem fotos', 'Anexe ao menos uma foto do tour para a IA analisar.'); return; }
        snap2();
        const btn = $('#ckAnalisar'); btn.disabled = true; btn.classList.add('loading'); const orig = btn.innerHTML; btn.textContent = 'Analisando fotos…';
        try {
          const a = await WERK.analisarFotos(ck.fotos, { vin: ck.vin, placa: ck.placa, km: ck.odometro });
          ck.odometro = a.km ?? ck.odometro; ck.combustivel = a.combustivel ?? ck.combustivel; ck.luzes = a.luzes; ck.itens = a.itens;
          ck.danos = ck.danos.filter(d => !d.ia);                 // re-análise substitui só as avarias da IA
          a.avarias.forEach(av => ck.danos.push({ x: av.x, y: av.y, nota: av.nota, ia: true }));
          ck.iaResumo = a; ck.iaOrcamento = null;
        } catch (_) { toast('IA', 'Não foi possível analisar agora. Tente de novo.'); btn.disabled = false; btn.innerHTML = orig; return; }
        renderCheckin();
      });
      const sug = $('#ckSugerir');
      if (sug) sug.addEventListener('click', () => {
        snap2();
        ck.iaOrcamento = WERK.sugerirOrcamento({ luzes: ck.luzes, sintoma: ck.sintoma }, ck.decoded && ck.decoded.familia, null);
        renderCheckin();
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
        // sem VIN não grava no prontuário por VIN (evita colidir vários "sem chassi" na mesma chave)
        if (ck.vin) WERK.upsertVehicle({ vin: ck.vin, ...ck.decoded, placa: ck.placa, km: +ck.odometro, cliente: ck.cliente, telefone: ck.telefone });
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
      const msgWa = `Olá, ${primeiro}! Seu ${ck.decoded.modelo} deu entrada na ${bnome()} (OS #${ck.osNum}). ` +
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
      ${os.itens.some(i => i.garantia) ? `<a class="quote-btn" href="documento.html?tipo=garantia&os=${os.numero}" target="_blank">📄 Garantia</a>` : ''}
      ${os.vin ? `<button class="quote-btn" data-realoem="${os.vin}" title="Abre o catálogo BMW no VIN deste carro e copia o VIN">🔧 Peças (RealOEM)</button>` : ''}`;

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
            <h3>${I('scan')} Diagnóstico do scanner — perito IA <span style="font-size:10px;color:var(--txt-3)">qualquer aparelho (ISTA · Autel · Launch · Thinkcar · OBD-II) — foto da tela ou PDF; extraio só a memória de falhas no navegador (leitura barata) e priorizo</span></h3>
            ${(() => { const ev = [...os.eventos].reverse().find(e => e.tipo === 'ista'); return (ev && ev.laudo) ? renderLaudoIsta(ev.laudo, os) : '<p style="font-size:12px;color:var(--txt-3);margin-bottom:8px">Anexe a leitura do scanner (foto da tela do aparelho ou PDF). Leio os códigos, traduzo, separo causa-raiz de consequência e sugiro as medições — você revisa antes de orçar. Códigos já conhecidos são decodificados pelo dicionário local, sem custo de IA.</p>'; })()}
            <label class="btn btn-secondary" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:9px 14px;font-size:12px;margin-top:6px">
              📎 Anexar leitura do scanner (foto/PDF)
              <input id="istaFile" type="file" accept="image/*,application/pdf" multiple hidden>
            </label>
            <span id="istaStatus" style="font-size:11px;color:var(--txt-3);margin-left:8px"></span>
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

  // Render do laudo ISTA analisado pela IA. Escapa tudo (conteúdo vem da IA/OCR).
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
  function renderLaudoIsta(l, os) {
    l = l || {};
    if (l.eh_ista === false) return `<p style="font-size:12px;color:var(--warn);margin-bottom:8px">${esc(l.resumo_executivo || 'O anexo não parece um laudo de scanner.')}</p>`;
    os = os || {};
    const vin = os.vin || '';
    const ehBmw = /bmw|mini/i.test(os.veiculo || '') || /^(WBA|WBS|WBY|WBX|4US|5UX|5YM|WMW|WME)/i.test(vin);
    const podeLancar = os.status === 'diagnostico' || os.status === 'fila';
    const istaKey = c => c.codigo || String(c.termo_peca || c.descricao || 'Peça do diagnóstico').slice(0, 90);
    const lancados = new Set((os.itens || []).filter(i => i.origem && i.origem.indexOf('ista:') === 0).map(i => i.origem.slice(5)));
    const sevCor = { critica: 'var(--red)', alta: '#ff8a3d', media: 'var(--warn)', baixa: 'var(--txt-3)' };
    const aviso = (l.requer_confirmacao_profissional && (l.avisos_seguranca || []).length)
      ? `<div style="background:rgba(255,60,60,.1);border:1px solid var(--red);border-radius:9px;padding:9px 11px;font-size:11.5px;color:#ffb4b4;margin-bottom:10px">⚠️ ${esc((l.avisos_seguranca || []).join(' '))}</div>` : '';
    const recap = l.recaptura_necessaria
      ? `<div style="background:rgba(255,176,49,.1);border:1px solid var(--warn);border-radius:9px;padding:8px 11px;font-size:11px;color:#ffd89a;margin-bottom:10px">📷 ${esc(l.motivo_recaptura || 'Reenvie uma captura mais nítida do laudo.')}</div>` : '';
    const codigos = (l.codigos || []).map((c, ci) => {
      const launched = lancados.has(istaKey(c));
      const botaoDvi = launched
        ? `<${podeLancar ? 'button class="ista-add" disabled' : 'span class="ista-add" style="cursor:default;opacity:.8"'}>✓ no DVI</${podeLancar ? 'button' : 'span'}>`
        : (podeLancar ? `<button class="ista-add" data-ista-add="${ci}">➕ lançar no DVI</button>` : '');
      return `
      <div style="border:1px solid var(--line-strong);border-radius:9px;padding:9px 11px;margin-bottom:6px;background:var(--navy)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
          <code style="font-size:12.5px;color:${sevCor[c.severidade] || 'var(--txt)'};font-weight:700">${esc(c.codigo)}</code>
          <span style="font-size:9.5px;color:var(--txt-3)">${esc(c.modulo || '')}${c.modulo ? ' · ' : ''}${esc(c.sistema || '')} · ${c.tipo === 'raiz' ? '🎯 causa-raiz' : c.tipo === 'consequente' ? '↪ consequente' : 'a investigar'}${c.critico_seguranca ? ' · 🛡️ segurança' : ''}</span>
        </div>
        <div style="font-size:11.5px;color:var(--txt);margin-top:3px">${esc(c.descricao)}</div>
        ${c.causa_provavel ? `<div style="font-size:10.5px;color:var(--txt-2);margin-top:3px">Causa provável: ${esc(c.causa_provavel)}</div>` : ''}
        ${c.exige_medicao && c.medicao ? `<div style="font-size:10.5px;color:var(--accent,#5aa0ff);margin-top:3px">🔧 Medir antes: ${esc(c.medicao)}</div>` : ''}
        <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${(ehBmw && (vin || c.termo_peca))
            ? `<a href="#" class="ista-peca" data-realoem="${esc(vin || '')}" data-termo="${esc(c.termo_peca || '')}" style="font-size:10.5px;color:#ff9d3d;text-decoration:none;font-weight:600">🔧 buscar peça no RealOEM${c.termo_peca ? ' · ' + esc(c.termo_peca) : ''}</a>`
            : (c.termo_peca ? `<a href="https://www.google.com/search?q=${encodeURIComponent(c.termo_peca + ' ' + (os.veiculo || '') + ' peça')}" target="_blank" rel="noopener" style="font-size:10.5px;color:#ff9d3d;text-decoration:none;font-weight:600">🔧 buscar peça · ${esc(c.termo_peca)}</a>` : '')}
          ${botaoDvi}
        </div>
      </div>`;
    }).join('');
    const lancaveis = (l.codigos || []).filter(c => c && (c.termo_peca || c.descricao || c.codigo));
    const pendentes = lancaveis.filter(c => !lancados.has(istaKey(c))).length;
    const bulk = (podeLancar && lancaveis.length)
      ? (pendentes ? `<button class="ista-add-all" data-ista-all>➕ Lançar ${pendentes} peça${pendentes > 1 ? 's' : ''} no DVI / orçamento</button>`
                   : '<p style="font-size:10.5px;color:var(--ok);margin:0 0 8px;font-weight:600">✓ Todas as peças do laudo já estão no DVI</p>') : '';
    return `
      ${aviso}${recap}
      <p style="font-size:12px;color:var(--txt);margin-bottom:8px">${esc(l.resumo_executivo)}</p>
      ${l.causa_raiz_provavel ? `<p style="font-size:11.5px;color:var(--txt-2);margin-bottom:8px">🎯 <b>Causa-raiz provável:</b> ${esc(l.causa_raiz_provavel)}</p>` : ''}
      ${bulk}
      ${codigos ? `<div style="margin-bottom:8px">${codigos}</div>` : '<p style="font-size:11.5px;color:var(--txt-3);margin-bottom:8px">Nenhum código legível no anexo.</p>'}
      ${pranchaPecas(l, vin)}
      ${(l.proximos_passos || []).length ? `<div style="font-size:11px;color:var(--txt-2)"><b>Próximos passos:</b><ul style="margin:4px 0 0;padding-left:16px">${l.proximos_passos.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
      ${l.codigos_omitidos > 0 ? `<p style="font-size:10.5px;color:var(--warn);margin-top:6px">+${l.codigos_omitidos} código(s) além dos ${(l.codigos || []).length} priorizados acima — o laudo é extenso; anexe as páginas restantes em separado se precisar de todos.</p>` : ''}
      ${l.modo === 'dicionario' ? `<button data-ista-ia style="margin-top:8px;background:none;border:1px solid var(--line-strong);border-radius:8px;padding:7px 12px;font-size:11px;color:var(--accent,#5aa0ff);cursor:pointer;font-weight:600">🧠 aprofundar com IA (causa-raiz)</button>` : ''}
      <p style="font-size:10px;color:var(--txt-3);margin-top:8px">Confiança da leitura: ${Math.round((l.confianca || 0) * 100)}% · ${l.modo === 'demo' ? 'modo demonstração' : l.modo === 'dicionario' ? '📕 dicionário local — sem custo de IA' : 'IA'} · <b>revise antes de orçar</b>${dicResumo()}</p>`;
  }
  // Resumo curto do estado do dicionário (aprendidos + banco mundial) para o rodapé do laudo.
  function dicResumo() {
    try {
      if (!WERK.dicStats) return '';
      const s = WERK.dicStats();
      const partes = [];
      if (s.aprendidos) partes.push(s.aprendidos + ' aprendido' + (s.aprendidos > 1 ? 's' : ''));
      if (s.banco) partes.push((s.banco >= 1000 ? (s.banco / 1000).toFixed(1).replace('.0', '') + ' mil' : s.banco) + ' no banco mundial');
      return partes.length ? ` · 📕 dicionário: ${partes.join(' + ')}` : '';
    } catch (_) { return ''; }
  }
  // ---- Prancha de peças 2D (estilo catálogo ETK) — desenho esquemático das peças do diagnóstico ----
  function glyphKind(c) {
    const t = ((c.termo_peca || '') + ' ' + (c.descricao || '') + ' ' + (c.sistema || '') + ' ' + (c.modulo || '')).toLowerCase();
    if (/airbag|\bsrs\b|acsm|pretensor|cinto|pyro/.test(t)) return 'airbag';
    if (/bateria|\bibs\b|\bbms\b|aliment|subtens|tens[aã]o|12\s?v|\bvolt/.test(t)) return 'bateria';
    if (/freio|\bdsc\b|\babs\b|disco|pastilha|pin[çc]a|caliper|est[aá]bil/.test(t)) return 'freio';
    if (/bobina|vela|igni[çc]|spark|coil/.test(t)) return 'bobina';
    if (/bomba|pump|combust[ií]vel|[óo]leo|arrefec|[áa]gua/.test(t)) return 'bomba';
    if (/conector|chicote|cabo|\bfio\b|plug|terminal|contato|corros/.test(t)) return 'conector';
    if (/sensor|sonda|lambda|\bnox\b|rota[çc]|temperat|press[aã]o/.test(t)) return 'sensor';
    if (/m[óo]dulo|unidade|\becu\b|\bdme\b|\bdde\b|\begs\b|central|control/.test(t)) return 'modulo';
    return 'generic';
  }
  function glyphSVG(kind, a) {
    switch (kind) {
      case 'bateria': return `<rect x="-34" y="-18" width="68" height="38" rx="5"/><line x1="-34" y1="-4" x2="34" y2="-4"/><rect x="-22" y="-25" width="9" height="8" rx="1.5"/><rect x="13" y="-25" width="9" height="8" rx="1.5"/><path d="M-19 4 h9 M-14.5 -0.5 v9"/><path d="M6 4 h9"/><circle cx="17.5" cy="-29" r="5" fill="${a}" stroke="none"/>`;
      case 'sensor': return `<rect x="-8" y="-4" width="16" height="26" rx="6"/><polygon points="-10,-4 10,-4 7,-12 -7,-12"/><line x1="0" y1="-12" x2="0" y2="-20"/><path d="M0 22 q0 10 15 12 q13 2 18 -5" fill="none"/><rect x="29" y="26" width="13" height="9" rx="2" fill="${a}" stroke="none"/>`;
      case 'modulo': return `<rect x="-34" y="-20" width="62" height="38" rx="4"/><rect x="-28" y="-14" width="50" height="18" rx="2" opacity=".5"/><line x1="-26" y1="18" x2="-26" y2="24"/><line x1="-18" y1="18" x2="-18" y2="24"/><line x1="-10" y1="18" x2="-10" y2="24"/><line x1="-2" y1="18" x2="-2" y2="24"/><line x1="6" y1="18" x2="6" y2="24"/><line x1="14" y1="18" x2="14" y2="24"/><rect x="28" y="-10" width="11" height="18" rx="2" fill="${a}" stroke="none"/><circle cx="-28" cy="-16" r="1.6"/><circle cx="22" cy="-16" r="1.6"/>`;
      case 'freio': return `<circle r="27"/><circle r="9"/><circle cx="0" cy="-14" r="1.7"/><circle cx="13" cy="7" r="1.7"/><circle cx="-13" cy="7" r="1.7"/><line x1="0" y1="-27" x2="0" y2="-20" opacity=".6"/><line x1="23" y1="13" x2="17" y2="10" opacity=".6"/><line x1="-23" y1="13" x2="-17" y2="10" opacity=".6"/><rect x="-13" y="-34" width="26" height="13" rx="3" fill="${a}" stroke="none"/>`;
      case 'airbag': return `<circle r="25"/><path d="M0 -9 V-25"/><path d="M0 0 L20 12" opacity=".8"/><path d="M0 0 L-20 12" opacity=".8"/><circle r="9" fill="${a}" stroke="none"/>`;
      case 'bobina': return `<rect x="-9" y="-24" width="18" height="22" rx="3"/><rect x="-11" y="-2" width="22" height="6" rx="2" fill="${a}" stroke="none"/><rect x="-4" y="4" width="8" height="9"/><line x1="0" y1="13" x2="0" y2="22"/><path d="M-3 22 h6"/>`;
      case 'bomba': return `<circle r="20"/><circle r="6"/><path d="M0 -6 A6 6 0 0 1 5 3" opacity=".7"/><path d="M0 6 A6 6 0 0 1 -5 -3" opacity=".7"/><rect x="16" y="-6" width="12" height="12" rx="2" fill="${a}" stroke="none"/><rect x="-6" y="-30" width="12" height="10" rx="2"/>`;
      case 'conector': return `<rect x="-20" y="-14" width="32" height="28" rx="4"/><line x1="12" y1="-7" x2="24" y2="-7"/><line x1="12" y1="0" x2="24" y2="0"/><line x1="12" y1="7" x2="24" y2="7"/><rect x="-25" y="-5" width="5" height="10" rx="1.5" fill="${a}" stroke="none"/><path d="M-20 -8 q-14 0 -18 8" fill="none" opacity=".7"/><path d="M-20 8 q-12 2 -16 10" fill="none" opacity=".7"/>`;
      default: return `<rect x="-28" y="-18" width="56" height="36" rx="6"/><polygon points="18,-18 28,-18 28,-8" fill="${a}" stroke="none"/><line x1="-18" y1="-6" x2="12" y2="-6" opacity=".55"/><line x1="-18" y1="4" x2="6" y2="4" opacity=".55"/>`;
    }
  }
  function carSVG() {
    return `<path d="M-42 10 C-42 2 -36 0 -30 0 L-20 0 C-16 -12 -8 -16 2 -16 C12 -16 18 -10 22 -2 L34 0 C40 1 42 4 42 10 L42 12 L-42 12 Z"/><circle cx="-22" cy="12" r="8"/><circle cx="22" cy="12" r="8"/><circle cx="-22" cy="12" r="3.4"/><circle cx="22" cy="12" r="3.4"/><path class="win" d="M-15 -1 L-5 -12 L9 -12 L17 -2 Z"/>`;
  }
  function pranchaPecas(l, vin) {
    l = l || {};
    const sevCor = { critica: 'var(--red)', alta: '#ff8a3d', media: 'var(--warn)', baixa: 'var(--txt-3)' };
    let parts = (l.codigos || []).filter(c => c && c.termo_peca);
    if (!parts.length) parts = (l.codigos || []).filter(c => c && (c.codigo || c.descricao));
    if (!parts.length) return '';
    const DRAW_MAX = 8;
    const drawn = parts.slice(0, DRAW_MAX);
    const rest = parts.length - drawn.length;
    const realVin = vin || '';
    const vinMask = realVin ? '••••' + esc(realVin.slice(-4)) : '—';
    const sysCount = {};
    parts.forEach(c => { const s = (c.sistema || '').trim(); if (s) sysCount[s] = (sysCount[s] || 0) + 1; });
    const domSys = Object.keys(sysCount).sort((x, y) => sysCount[y] - sysCount[x])[0] || 'multissistema';
    const n = drawn.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const W = 680, cellW = W / cols, cellTop = 150, cellH = 152, botBand = 48;
    const H = cellTop + rows * cellH + botBand;
    const carX = W / 2, carY = 66;
    let bodySvg = '';
    drawn.forEach((c, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = Math.round(col * cellW + cellW / 2);
      const cy = Math.round(cellTop + row * cellH + 62);
      const a = sevCor[c.severidade] || 'var(--txt-2)';
      const termo = c.termo_peca || c.descricao || c.codigo || 'peça';
      const termoShort = termo.length > 30 ? termo.slice(0, 29) + '…' : termo;
      const modtag = [c.modulo, c.sistema].filter(Boolean).join(' · ');
      const bx = cx - 48, by = cy - 40;
      bodySvg += `<line class="prancha-leader" x1="${carX}" y1="${carY + 22}" x2="${bx}" y2="${by}"/>`;
      bodySvg += `<g class="prancha-part" data-realoem="${esc(realVin)}" data-termo="${esc(c.termo_peca || '')}" role="button" tabindex="0" aria-label="Abrir ${esc(termo)} no RealOEM" style="cursor:pointer">`;
      bodySvg += `<g class="prancha-glyph" transform="translate(${cx},${cy})" style="--acc:${a}">${glyphSVG(glyphKind(c), a)}</g>`;
      bodySvg += `<text class="prancha-label" x="${cx}" y="${cy + 46}" text-anchor="middle">${esc(termoShort)}</text>`;
      if (modtag) bodySvg += `<text class="prancha-sub" x="${cx}" y="${cy + 59}" text-anchor="middle">${esc(modtag.length > 34 ? modtag.slice(0, 33) + '…' : modtag)}</text>`;
      bodySvg += `<g class="prancha-balloon"><circle cx="${bx}" cy="${by}" r="12" fill="${a}"/><text class="prancha-bnum" x="${bx}" y="${by + 1}" text-anchor="middle" dominant-baseline="middle">${i + 1}</text></g>`;
      bodySvg += `</g>`;
    });
    const car = `<g class="prancha-car" transform="translate(${carX},${carY})">${carSVG()}<text class="prancha-vin" x="0" y="34" text-anchor="middle">VIN ${vinMask}</text></g>`;
    const tb = `<g class="prancha-tb" transform="translate(${W - 190},${H - 44})"><rect x="0" y="0" width="186" height="40" rx="4"/><text class="prancha-tbk" x="10" y="14">${esc(bnome().toUpperCase().slice(0, 22))} · PRANCHA DE PEÇAS</text><text class="prancha-tbv" x="10" y="27">Sistema: ${esc(domSys)}</text><text class="prancha-tbs" x="10" y="36">Ref. catálogo BMW ETK · RealOEM</text></g>`;
    const svg = `<svg class="prancha-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Prancha de peças do diagnóstico"><rect class="prancha-bg" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10"/>${car}${bodySvg}${tb}</svg>`;
    const legend = parts.map((c, i) => {
      const a = sevCor[c.severidade] || 'var(--txt-3)';
      const termo = c.termo_peca || c.descricao || c.codigo || 'peça';
      const sub = [c.modulo, c.sistema].filter(Boolean).join(' · ') + (c.tipo === 'raiz' ? ' · 🎯 causa-raiz' : '');
      return `<button class="prancha-row" data-realoem="${esc(realVin)}" data-termo="${esc(c.termo_peca || '')}"><span class="prancha-rn" style="background:${a}">${i + 1}</span><span class="prancha-rt"><b>${esc(termo)}</b><small>${esc(sub)}</small></span><span class="prancha-ro">RealOEM ↗</span></button>`;
    }).join('');
    return `<div class="prancha"><div class="prancha-head"><span>🔧 Prancha de peças <em>— clique numa peça pra abrir o desenho no RealOEM</em></span>${realVin ? `<button class="prancha-cat" data-realoem="${esc(realVin)}" data-termo="">Catálogo completo ↗</button>` : ''}</div><div class="prancha-plate">${svg}</div><div class="prancha-legend">${legend}</div>${rest > 0 ? `<p class="prancha-more">+${rest} peça(s) listada(s) acima, não desenhada(s) na prancha.</p>` : ''}<p class="prancha-foot">Desenho esquemático gerado pelo LexOS para orientar a busca — o número e o preço oficiais da peça vêm do RealOEM (catálogo BMW ETK). O VIN é copiado ao abrir.</p></div>`;
  }
  function diagItemHTML(os, i) {
    const nv = i.niveis[i.nivelEscolhido || 'original'];
    return `
      <div class="diag-item">
        <div class="di-head">
          <span class="sev-badge ${i.severidade}">${sevIcon[i.severidade]} ${i.severidade}</span>
          <b>${i.titulo}</b>
          ${i.aprovacao ? `<span class="ap-badge ${i.aprovacao}">${i.aprovacao}</span>` : ''}
          ${i.midia ? (i.midia === 'demo' ? '<span class="ap-badge aprovado">📷 mídia ok</span>' : i.midia === 'ista' ? '<span class="ap-badge aprovado">🧾 laudo ISTA</span>' : `<img src="${i.midia}" alt="" style="width:44px;height:33px;object-fit:cover;border-radius:6px;border:1px solid var(--line-strong)">`) : '<span class="ap-badge pendente">⚠ sem mídia</span>'}
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
      const retirada = $('#retirada').value;
      // mesmo registro de pagamento/NF/garantia do app do cliente (contrato WERK)
      const paga = WERK.registrarPagamento(os.numero, { valor: total, retirada, ator: 'Financeiro', desc: `Pix ${WERK.brl(total)} · NF emitida automaticamente · garantia por item ativada.` });
      // só notifica/toast de sucesso quando registrou de fato (evita push/feedback
      // duplicado se o checkout for reaberto ou houver concorrência).
      if (paga && typeof EVX !== 'undefined') EVX.pushNotification({ titulo: `OS #${os.numero} — pagamento confirmado`, texto: `Recibo e NF disponíveis no app. Retirada: ${retirada}.`, quando: Date.now(), tipo: 'ok' });
      closeModal();
      toast(paga ? 'Pagamento registrado' : 'OS já estava paga', paga ? 'NF emitida e garantias ativadas.' : 'NF e garantias já haviam sido liberadas.');
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

    // Diagnóstico do scanner → perito IA. Local-first: se todos os códigos já são
    // conhecidos, decodifica pelo dicionário (custo ZERO); só cai na IA quando há
    // código inédito — e aí a IA ENSINA o dicionário para a próxima sair de graça.
    const gravarLaudo = (laudo) => {
      const via = laudo.modo === 'dicionario' ? 'dicionário local' : laudo.modo === 'demo' ? 'demonstração' : 'IA';
      const resumo = (laudo.resumo_executivo || 'Laudo lido').slice(0, 140);
      WERK.updateOS(os.numero, () => {}, { tipo: 'ista', titulo: 'Diagnóstico do scanner lido (' + via + ')', desc: resumo, ator: os.tecnico, laudo });
    };
    async function lerScanner(arquivos, texto, opts) {
      opts = opts || {};
      const ctx = { modelo: os.veiculo, placa: os.placa, vin: os.vin, km: os.km };
      laudoBuf[os.numero] = { arquivos, texto, ctx };   // guarda p/ "aprofundar com IA"
      // 1) leitura local pelo dicionário (sem IA) quando dá para cobrir todos os códigos
      if (!opts.forcarIa && texto && WERK.lerLocal) {
        const codes = codigosDoTexto(texto);
        if (codes.length) {
          const local = await WERK.lerLocal(codes, ctx);
          if (local && local.ok) {
            gravarLaudo(local);
            toast('Lido pelo dicionário — sem custo de IA', local.requer_confirmacao_profissional ? '⚠️ Há sistema de segurança — confirme antes de orçar.' : codes.length + ' código(s) decodificados localmente.');
            return local;
          }
        }
      }
      // 2) IA (transcreve o que o dicionário não cobre) — e aprende com o resultado
      const laudo = await WERK.analisarIsta(arquivos, ctx, texto);
      if (!laudo || !laudo.ok) return laudo;
      let novos = 0;
      try { if (WERK.dicAprender && Array.isArray(laudo.codigos)) novos = (WERK.dicAprender(laudo.codigos) || {}).novos || 0; } catch (_) {}
      gravarLaudo(laudo);
      toast('Diagnóstico analisado pela IA', laudo.requer_confirmacao_profissional ? '⚠️ Há sistema de segurança — confirme antes de orçar.' : (novos ? novos + ' código(s) novos aprendidos — a próxima leitura desses sai sem IA.' : 'Códigos decifrados e priorizados na OS.'));
      return laudo;
    }
    const istaFile = $('#istaFile');
    if (istaFile) istaFile.addEventListener('change', async () => {
      const files = [...(istaFile.files || [])].slice(0, 6);
      if (!files.length) return;
      const status = $('#istaStatus');
      const setStatus = (t) => { if (status) status.textContent = t; };
      setStatus('⏳ Preparando a leitura…');
      try {
        const arquivos = []; let texto = '';
        for (const f of files) {
          if (f.type === 'application/pdf') {
            setStatus('⏳ Extraindo a memória de falhas do PDF (no aparelho)…');
            const t = await pdfFalhasTexto(f);
            if (t) texto += (texto ? '\n\n——\n\n' : '') + t;   // só o texto das falhas vai à IA (barato)
            else arquivos.push(await lerArquivoDataUrl(f));      // PDF escaneado (imagem): manda o arquivo
          } else if (/^image\//.test(f.type)) {
            arquivos.push((await fotoLaudo(f)) || await lerArquivoDataUrl(f)); // foto comprimida
          } else {
            arquivos.push(await lerArquivoDataUrl(f));
          }
        }
        setStatus('⏳ Lendo os códigos…');
        const laudo = await lerScanner(arquivos, texto);
        if (!laudo || !laudo.ok) { setStatus('⚠️ ' + ((laudo && laudo.erro) || 'Não consegui ler o laudo.')); return; }
        setStatus('');
        views.os(os.numero);
      } catch (e) { setStatus('⚠️ Falha ao ler o arquivo.'); }
    });
    // "aprofundar com IA": depois de uma leitura local, roda a IA (causa-raiz) reusando o buffer.
    const istaIa = $('[data-ista-ia]');
    if (istaIa) istaIa.addEventListener('click', async () => {
      const buf = laudoBuf[os.numero];
      if (!buf) { toast('Reanexe a leitura', 'A tela recarregou desde a leitura local — anexe o laudo de novo para aprofundar com IA.'); return; }
      const rearm = () => { istaIa.disabled = false; istaIa.textContent = '🧠 aprofundar com IA (causa-raiz)'; };
      istaIa.disabled = true; istaIa.textContent = '⏳ IA lendo…';
      try {
        const laudo = await lerScanner(buf.arquivos, buf.texto, { forcarIa: true });
        if (!laudo || !laudo.ok) { toast('IA indisponível', (laudo && laudo.erro) || 'Não consegui aprofundar agora.'); rearm(); return; }
        views.os(os.numero);
      } catch (_) { rearm(); }
    });

    // RealOEM: abre o catálogo BMW e copia o VIN pra colar na busca por VIN (sem API — é só linkar).
    document.querySelectorAll('[data-realoem]').forEach(el => {
      const go = (e) => {
        e.preventDefault();
        const vin = el.getAttribute('data-realoem') || '';
        const termo = el.getAttribute('data-termo') || '';
        if (vin && navigator.clipboard) { try { navigator.clipboard.writeText(vin); } catch (_) {} }
        window.open('https://www.realoem.com/bmw/enUS/select', '_blank', 'noopener');
        toast('RealOEM aberto', vin ? ('VIN copiado — cole na busca por VIN' + (termo ? '; depois procure: ' + termo : '') + '.') : 'Selecione o modelo no RealOEM.');
      };
      el.addEventListener('click', go);
      const tag = el.tagName.toLowerCase();
      if (tag !== 'a' && tag !== 'button') el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
    });

    // ISTA → DVI: lançar as peças do laudo como itens do orçamento (o mecânico revisa depois).
    const laudoAtual = () => { const ev = [...(os.eventos || [])].reverse().find(e => e.tipo === 'ista'); return (ev && ev.laudo) || null; };
    const istaKeyH = c => c.codigo || String(c.termo_peca || c.descricao || 'Peça do diagnóstico ISTA').slice(0, 90);
    function lancarCodigos(codes) {
      codes = (codes || []).filter(Boolean);
      if (!codes.length) return;
      const cfg = WERK.getConfig();
      const atual = (WERK.getOS && WERK.getOS(os.numero)) || os;
      const ja = new Set((atual.itens || []).filter(i => i.origem && i.origem.indexOf('ista:') === 0).map(i => i.origem.slice(5)));
      const add = [];
      codes.forEach(c => { const k = istaKeyH(c); if (ja.has(k)) return; ja.add(k); add.push(c); });
      if (!add.length) { toast('Nada a lançar', 'Essas peças já estavam no DVI.'); return; }
      WERK.updateOS(os.numero, o => { add.forEach(c => o.itens.push(WERK.itemDeIsta(o, c, cfg))); },
        { tipo: 'update', titulo: 'Peças lançadas do ISTA', desc: add.length + ' item(ns) adicionados ao DVI a partir do laudo.', ator: os.tecnico });
      toast(add.length + (add.length > 1 ? ' peças no DVI' : ' peça no DVI'), 'Revise peça, nível e preço antes de enviar ao cliente.');
      views.os(os.numero);
    }
    $$('[data-ista-add]').forEach(b => b.addEventListener('click', () => {
      const l = laudoAtual(); if (!l) return;
      lancarCodigos([(l.codigos || [])[+b.dataset.istaAdd]]);
    }));
    const istaAll = $('[data-ista-all]');
    if (istaAll) istaAll.addEventListener('click', () => {
      const l = laudoAtual(); if (!l) return;
      lancarCodigos((l.codigos || []).filter(c => c && (c.termo_peca || c.descricao || c.codigo)));
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
      `<button type="button" class="btn btn-primary wk-cta-checkin" onclick="location.hash='#/checkin'">${I('scan', 18)} Novo check-in</button>`) + `
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
      `<button type="button" class="btn btn-primary wk-cta-checkin" onclick="location.hash='#/checkin'">${I('scan', 18)} Novo check-in</button>`) + `
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
                <a class="quote-btn" target="_blank" rel="noopener" href="${WERK.waLink(c.telefone, `Olá, ${c.nome.split(' ')[0]}! Acompanhe seu veículo pelo app da ${bnome()}: ${WERK.conviteUrl(c)}`)}">WhatsApp</a>
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
     VIEW · AGENDA — fila de agendamentos (site + manuais):
     calendário do mês + cronograma do dia. Confirmar / cancelar /
     converter em check-in. Dados via WERK.getAgendamentos() —
     mesma interface no modo demo (localStorage) e nuvem (Supabase).
     ============================================================ */
  let agSel = null;                 // dia selecionado (YYYY-MM-DD)
  let agMes = null;                 // mês exibido no calendário { y, m } (m 0-based)
  const agIso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const AG_ST = {
    novo:       { rotulo: 'novo',       cls: 'pendente' },
    confirmado: { rotulo: 'confirmado', cls: 'aprovado' },
    cancelado:  { rotulo: 'cancelado',  cls: 'recusado' },
    convertido: { rotulo: 'na oficina', cls: 'aprovado' },
  };
  const AG_CSS = `<style>
    .ag-wrap{display:grid;grid-template-columns:340px 1fr;gap:14px;align-items:start}
    @media (max-width:980px){.ag-wrap{grid-template-columns:1fr}}
    .ag-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
    .ag-nav b{font-family:var(--font-display);font-size:13px;font-weight:800;text-transform:capitalize}
    .ag-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
    .ag-dow{font-family:var(--font-display);font-size:9px;font-weight:800;letter-spacing:.1em;color:var(--txt-3);text-align:center;padding:4px 0}
    .ag-cell{position:relative;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:0;font:inherit;background:var(--navy);border:1px solid var(--line);border-radius:9px;color:var(--txt-2);font-size:11.5px;cursor:pointer}
    .ag-cell.vazio{background:none;border:none;cursor:default}
    .ag-cell:not(.vazio):hover{border-color:var(--line-strong);color:var(--txt)}
    .ag-cell.hoje{border-color:var(--blue-light)}
    .ag-cell.sel{border-color:var(--red);background:var(--red-soft);color:var(--txt)}
    .ag-cell em{font-style:normal;font-family:var(--font-display);font-weight:800;font-size:8.5px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:var(--red);color:#fff;display:inline-flex;align-items:center;justify-content:center}
    .ag-row{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;padding:12px 0;border-bottom:1px dashed var(--line)}
    .ag-row:last-child{border-bottom:0}
    .ag-hora{font-family:var(--font-display);font-weight:800;font-size:13.5px;min-width:46px;color:var(--txt)}
    .ag-info{flex:1 1 160px;min-width:150px}
    .ag-info b{font-size:12.5px}
    .ag-info .sub{display:block;font-size:11px;color:var(--txt-3);margin-top:2px;overflow-wrap:anywhere}
    .ag-acts{flex:1 1 auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center}
  </style>`;

  views.agenda = () => {
    const hoje = agIso(new Date());
    if (!agSel) agSel = hoje;
    if (!agMes) agMes = { y: +agSel.slice(0, 4), m: +agSel.slice(5, 7) - 1 };
    const ags = WERK.getAgendamentos();
    const porDia = {};
    ags.forEach(a => { if (a.data && a.status !== 'cancelado') porDia[a.data] = (porDia[a.data] || 0) + 1; });

    /* grade do mês */
    const prim = new Date(agMes.y, agMes.m, 1);
    const nDias = new Date(agMes.y, agMes.m + 1, 0).getDate();
    let celulas = '';
    for (let i = 0; i < prim.getDay(); i++) celulas += '<span class="ag-cell vazio"></span>';
    for (let d = 1; d <= nDias; d++) {
      const iso = `${agMes.y}-${String(agMes.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const n = porDia[iso] || 0;
      celulas += `<button type="button" class="ag-cell ${iso === agSel ? 'sel' : ''} ${iso === hoje ? 'hoje' : ''}" data-ag-dia="${iso}"><span>${d}</span>${n ? `<em>${n}</em>` : ''}</button>`;
    }

    const doDia = ags.filter(a => a.data === agSel);
    const semData = ags.filter(a => !a.data && a.status !== 'cancelado');
    const novos = ags.filter(a => a.status === 'novo').length;
    const diaLabel = new Date(agSel + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

    const linha = (a) => {
      const st = AG_ST[a.status] || AG_ST.novo;
      const aberto = a.status === 'novo' || a.status === 'confirmado';
      const quando = a.data ? new Date(a.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) : 'data a combinar';
      const acts = [
        a.status === 'novo' ? `<button class="quote-btn" data-ag-conf="${escHtml(a.id)}">✓ confirmar</button>` : '',
        aberto ? `<button class="quote-btn" data-ag-ck="${escHtml(a.id)}">▶ check-in</button>` : '',
        aberto && a.telefone ? `<a class="quote-btn" target="_blank" rel="noopener" href="${WERK.waLink(a.telefone, `Olá, ${(a.nome || '').split(' ')[0]}! Confirmando seu horário na ${bnome()}: ${quando}${a.hora ? ' às ' + a.hora : ''} — ${a.servico_nome || 'serviço'}. Protocolo ${a.protocolo || ''}.`)}">WhatsApp</a>` : '',
        aberto ? `<button class="quote-btn" data-ag-canc="${escHtml(a.id)}">✕ cancelar</button>` : '',
        a.status === 'convertido' && a.os_numero ? `<button class="quote-btn" onclick="location.hash='#/os/${+a.os_numero}'">abrir OS #${+a.os_numero}</button>` : '',
      ].filter(Boolean).join('');
      return `
        <div class="ag-row">
          <span class="ag-hora">${escHtml(a.hora || '—')}</span>
          <div class="ag-info">
            <b>${escHtml(a.nome)}</b> <span class="ap-badge ${st.cls}">${st.rotulo}</span>
            <span class="sub">${[a.veiculo, a.placa, a.servico_nome || a.servico].filter(Boolean).map(escHtml).join(' · ') || '—'}${a.obs ? ` · <em style="font-style:normal;color:var(--txt-2)">${escHtml(a.obs)}</em>` : ''}</span>
            <span class="sub">${escHtml(a.protocolo || '')}${a.telefone ? ' · ' + escHtml(a.telefone) : ''}</span>
          </div>
          <div class="ag-acts">${acts}</div>
        </div>`;
    };

    main.innerHTML = head('Agenda', `Fila de agendamentos do site + manuais · ${novos} aguardando confirmação`,
      `<button class="btn btn-primary" id="agNovo">＋ Novo agendamento</button>`) + AG_CSS + `
      <div class="ag-wrap">
        <div class="wk-panel">
          <div class="ag-nav">
            <button type="button" class="quote-btn" id="agPrev" aria-label="Mês anterior">‹</button>
            <b>${prim.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</b>
            <span style="display:flex;gap:6px">
              <button type="button" class="quote-btn" id="agHoje">hoje</button>
              <button type="button" class="quote-btn" id="agNext" aria-label="Próximo mês">›</button>
            </span>
          </div>
          <div class="ag-grid">
            ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<span class="ag-dow">${d}</span>`).join('')}
            ${celulas}
          </div>
          <p style="font-size:10.5px;color:var(--txt-3);margin-top:10px">O contador de cada dia ignora cancelados. Agendamentos do site chegam como <b>novo</b> — confirme e converta em check-in na chegada.</p>
        </div>
        <div class="wk-panel">
          <h3>${I('calendar')} Cronograma · ${diaLabel} <span style="font-size:10px;color:var(--txt-3);font-weight:400">(${doDia.length} agendamento${doDia.length === 1 ? '' : 's'})</span></h3>
          ${doDia.map(linha).join('') || '<p style="font-size:12px;color:var(--txt-3)">Nenhum agendamento para este dia — use ＋ Novo agendamento ou aguarde a fila do site.</p>'}
          ${semData.length ? `<h3 style="margin-top:16px">${I('alert')} Sem data definida</h3>${semData.map(linha).join('')}` : ''}
        </div>
      </div>`;

    $$('[data-ag-dia]').forEach(b => b.addEventListener('click', () => { agSel = b.dataset.agDia; views.agenda(); }));
    $('#agPrev').addEventListener('click', () => { agMes = agMes.m === 0 ? { y: agMes.y - 1, m: 11 } : { y: agMes.y, m: agMes.m - 1 }; views.agenda(); });
    $('#agNext').addEventListener('click', () => { agMes = agMes.m === 11 ? { y: agMes.y + 1, m: 0 } : { y: agMes.y, m: agMes.m + 1 }; views.agenda(); });
    $('#agHoje').addEventListener('click', () => { agSel = hoje; agMes = null; views.agenda(); });
    $('#agNovo').addEventListener('click', modalNovoAgendamento);

    $$('[data-ag-conf]').forEach(b => b.addEventListener('click', async () => {
      const a = ags.find(x => x.id === b.dataset.agConf);
      await WERK.setAgendamentoStatus(b.dataset.agConf, 'confirmado');
      toast('Agendamento confirmado', a ? `${(a.nome || '').split(' ')[0]} · ${a.hora || 'sem hora'} — avise pelo WhatsApp.` : '');
      views.agenda();
    }));
    $$('[data-ag-canc]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Cancelar este agendamento?')) return;
      await WERK.setAgendamentoStatus(b.dataset.agCanc, 'cancelado');
      toast('Agendamento cancelado', 'A linha fica no dia, riscada, para histórico.');
      views.agenda();
    }));
    $$('[data-ag-ck]').forEach(b => b.addEventListener('click', () => {
      const a = ags.find(x => x.id === b.dataset.agCk);
      if (!a) return;
      const limpo = (s) => String(s || '').replace(/[<>"]/g, '').trim(); // dado do site não pode quebrar os inputs do wizard
      ck.vin = '';                                    // VIN é lido na recepção — nunca herdado de outro check-in
      ck.cliente = limpo(a.nome);
      ck.telefone = limpo(a.telefone);
      ck.placa = limpo(a.placa).toUpperCase();
      ck.sintoma = limpo(`Agendamento ${a.protocolo || 'do site'}: ${a.servico_nome || a.servico || 'serviço'}${a.veiculo ? ' — ' + a.veiculo : ''}${a.obs ? '. ' + a.obs : ''}`);
      Promise.resolve(WERK.setAgendamentoStatus(a.id, 'convertido')).catch(() => {}); // melhor esforço
      toast('Check-in iniciado', `Dados de ${limpo(a.nome).split(' ')[0] || 'cliente'} pré-preenchidos — confirme o VIN.`);
      location.hash = '#/checkin';
    }));
  };

  function modalNovoAgendamento() {
    const svcs = (typeof EVX !== 'undefined' && EVX.SERVICES) || [];
    const slots = (typeof EVX !== 'undefined' && EVX.SLOTS) || ['08:00', '09:00', '10:00', '11:00', '13:30', '14:30', '15:30', '16:30'];
    modal(`
      <h3>＋ Novo agendamento</h3>
      <p style="font-size:11.5px;color:var(--txt-3);margin-bottom:12px">Entrada manual (telefone/WhatsApp/balcão) — cai na mesma fila dos agendamentos do site.</p>
      <div class="wk-grid2">
        <div class="wfield"><label>Nome do cliente *</label><input id="ag-nome" placeholder="Nome completo"></div>
        <div class="wfield"><label>Telefone/WhatsApp</label><input id="ag-tel" placeholder="(27) 9…"></div>
      </div>
      <div class="wk-grid2" style="margin-top:10px">
        <div class="wfield"><label>Veículo</label><input id="ag-veic" placeholder="Ex.: BMW 320i M Sport (G20)"></div>
        <div class="wfield"><label>Placa</label><input id="ag-placa" maxlength="8" style="text-transform:uppercase" placeholder="ABC-1D23"></div>
      </div>
      <div class="wk-grid3" style="margin-top:10px">
        <div class="wfield"><label>Serviço</label><select id="ag-svc">${svcs.map(s => `<option value="${s.id}">${s.nome}</option>`).join('') || '<option value="">Serviço</option>'}</select></div>
        <div class="wfield"><label>Data</label><input id="ag-data" type="date" value="${agSel || ''}"></div>
        <div class="wfield"><label>Hora</label><select id="ag-hora">${slots.map(h => `<option>${h}</option>`).join('')}</select></div>
      </div>
      <div class="wfield" style="margin-top:10px"><label>Observação</label><textarea id="ag-obs" rows="2" placeholder="Sintoma relatado, pedido do cliente…"></textarea></div>
      <div class="wk-actions" style="justify-content:flex-end;margin-top:14px">
        <button class="btn btn-secondary" onclick="document.getElementById('wkModal').classList.remove('open')">Cancelar</button>
        <button class="btn btn-primary" id="agSalvar">Salvar agendamento</button>
      </div>`);
    $('#agSalvar').addEventListener('click', async () => {
      const nome = $('#ag-nome').value.trim();
      if (!nome) { $('#ag-nome').focus(); return; }
      const sv = svcs.find(s => s.id === $('#ag-svc').value);
      const btn = $('#agSalvar');
      btn.disabled = true; btn.textContent = 'Salvando…';
      const row = await WERK.addAgendamento({
        nome,
        telefone: $('#ag-tel').value.trim(),
        veiculo: $('#ag-veic').value.trim(),
        placa: $('#ag-placa').value.trim().toUpperCase(),
        servico: sv ? sv.id : '',
        servico_nome: sv ? sv.nome : '',
        data: $('#ag-data').value || null,
        hora: $('#ag-hora').value,
        obs: $('#ag-obs').value.trim(),
      });
      if (!row) { // nuvem sem conexão/tabela: não fecha o formulário
        btn.disabled = false; btn.textContent = 'Salvar agendamento';
        toast('Não foi possível salvar', 'Confira a conexão e tente de novo.');
        return;
      }
      closeModal();
      if (row.data) { agSel = row.data; agMes = { y: +row.data.slice(0, 4), m: +row.data.slice(5, 7) - 1 }; }
      toast('Agendamento criado', `${nome.split(' ')[0]} · ${row.hora || 'sem hora'} · protocolo ${row.protocolo}`);
      views.agenda();
    });
  }

  /* ============================================================
     VIEW · EQUIPE (nuvem): colaboradores sem SQL — o login nasce
     no próprio painel e as regras de papel valem no SERVIDOR
     (RPCs staff_*): admin gerencia todos; gestor cria/edita só
     mecânicos e consultores; os demais visualizam.
     ============================================================ */
  const PAPEIS = { mecanico: '🔧 Mecânico', consultor: '🎧 Consultor', gestor: '📋 Gestor', admin: '👑 Admin' };
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  views.equipe = async () => {
    if (!WERK.cloud) {
      main.innerHTML = head('Equipe', 'Acessos do WERK OS por papel: mecânico, consultor, gestor e admin.') + `
        <div class="wk-panel" style="max-width:620px">
          <h3>${I('user')} Disponível no modo nuvem</h3>
          <p style="font-size:12.5px;color:var(--txt-2);line-height:1.6">Em produção, o admin cria, edita e remove os acessos
          da equipe direto por aqui — sem SQL e sem abrir o Supabase. Nesta demonstração local não há login de equipe
          para gerenciar; os nomes de técnico/consultor das OS vêm das Configurações.</p>
        </div>`;
      return;
    }
    const eu = WERK.authUser() || {};
    const perfil = WERK.staffPerfil() || {};
    const souAdmin = perfil.papel === 'admin';
    const gerencio = souAdmin || perfil.papel === 'gestor';
    const opcoes = souAdmin ? ['mecanico', 'consultor', 'gestor', 'admin'] : ['mecanico', 'consultor'];

    main.innerHTML = head('Equipe', 'Acessos do WERK OS — sem SQL, sem dashboard.') +
      '<div class="wk-panel"><p style="color:var(--txt-3)">Carregando a equipe…</p></div>';
    const r = await WERK.staffListar();
    if (!r.ok) {
      // dica do upgrade SÓ quando as RPCs staff_* não existem — não em acesso negado/rede
      const dica = r.faltaMigracao
        ? `<br><span style="color:var(--txt-3)">A página 👥 Equipe precisa do último passo no banco: cole <b>supabase/EQUIPE-UPGRADE.sql</b> no SQL Editor do projeto (uma única vez) e recarregue.</span>`
        : '';
      main.innerHTML = head('Equipe', 'Acessos do WERK OS — sem SQL, sem dashboard.') + `
        <div class="wk-panel"><p class="hintline err" style="display:block">${escHtml(r.erro)}${dica}</p></div>`;
      return;
    }

    const linhas = r.lista.map(m => {
      const souEu = m.auth_user === eu.id;
      const alvoAlto = m.papel === 'gestor' || m.papel === 'admin';
      const posso = souAdmin || (gerencio && !alvoAlto);
      const sel = posso
        ? `<select data-eq-papel="${m.auth_user}" data-eq-email="${escHtml(m.email || '')}">
            ${opcoes.map(p => `<option value="${p}" ${p === m.papel ? 'selected' : ''}>${PAPEIS[p]}</option>`).join('')}
            ${opcoes.includes(m.papel) ? '' : `<option value="${escHtml(m.papel)}" selected>${PAPEIS[m.papel] || escHtml(m.papel)}</option>`}
          </select>`
        : `<span class="ap-badge ${alvoAlto ? 'aprovado' : 'pendente'}">${PAPEIS[m.papel] || escHtml(m.papel)}</span>`;
      return `
        <tr>
          <td><b>${escHtml(m.nome)}</b>${souEu ? ' <span style="color:var(--txt-3);font-size:10.5px">(você)</span>' : ''}</td>
          <td style="font-size:12px">${escHtml(m.email || '—')}</td>
          <td>${sel}</td>
          <td style="font-size:11px;color:var(--txt-3)">${m.criado_em ? WERK.fd(m.criado_em) : '—'}</td>
          <td style="white-space:nowrap">${posso && !souEu ? `<button class="quote-btn" data-eq-remover="${m.auth_user}" data-eq-nome="${escHtml(m.nome)}">remover</button>` : ''}</td>
        </tr>`;
    }).join('');

    main.innerHTML = head('Equipe', gerencio
      ? 'Crie o acesso e entregue e-mail + senha provisória — a pessoa já entra no WERK OS.'
      : 'Sua conta visualiza a equipe; criar e editar é papel do gestor/admin.') + `
      <div class="wk-panel">
        <h3>${I('user')} Colaboradores (${r.lista.length})</h3>
        <table class="wk-table">
          <tr><th>Nome</th><th>E-mail (login)</th><th>Papel</th><th>Desde</th><th></th></tr>
          ${linhas || '<tr><td colspan="5" style="color:var(--txt-3)">Ninguém ainda.</td></tr>'}
        </table>
        <p style="font-size:10.5px;color:var(--txt-3);margin-top:10px">Papéis: <b>admin</b> gerencia todo mundo · <b>gestor</b> cria e edita mecânicos e consultores · mudar o papel no seletor salva na hora. As regras valem no servidor — não é só visual.</p>
      </div>
      ${gerencio ? `
      <div class="wk-panel">
        <h3>＋ Novo colaborador</h3>
        <div class="wk-grid2">
          <div class="wfield"><label>Nome completo</label><input id="eq-nome" placeholder="Ex.: Paulo Ferreira"></div>
          <div class="wfield"><label>E-mail (será o login)</label><input id="eq-email" type="email" placeholder="paulo@eurovix.com.br" autocomplete="off"></div>
        </div>
        <div class="wk-grid2" style="margin-top:12px">
          <div class="wfield"><label>Senha provisória (mín. 6)</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input id="eq-senha" type="password" autocomplete="new-password" placeholder="a pessoa troca depois em Configurações" style="flex:1">
              <button type="button" class="quote-btn" id="eq-senha-ver" aria-label="Mostrar ou ocultar a senha">👁 ver</button>
            </div>
          </div>
          <div class="wfield"><label>Papel</label><select id="eq-papel">${opcoes.map(p => `<option value="${p}">${PAPEIS[p]}</option>`).join('')}</select></div>
        </div>
        <div class="wk-actions"><button class="btn btn-primary" id="eq-criar">Criar acesso</button></div>
        <p style="font-size:10.5px;color:var(--txt-3)">O login nasce aqui mesmo — nada de Supabase. ${souAdmin ? '' : 'Gestor cria mecânicos e consultores; gestores e admins, só o admin.'}</p>
      </div>` : ''}`;

    $$('[data-eq-papel]').forEach(s => s.addEventListener('change', async () => {
      const linha = r.lista.find(m => m.auth_user === s.dataset.eqPapel);
      const res = await WERK.staffEditar({ email: s.dataset.eqEmail, nome: (linha && linha.nome) || '?', papel: s.value });
      if (res.ok) toast('Papel atualizado', `${(linha && linha.nome) || 'Colaborador'} agora é ${PAPEIS[s.value] || s.value}.`);
      else toast('Não foi possível', res.erro);
      views.equipe(); // re-render devolve a verdade do servidor (sucesso OU rollback visual)
    }));
    $$('[data-eq-remover]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Remover ${b.dataset.eqNome} da equipe? O login continua existindo, mas o WERK OS fecha para essa pessoa.`)) return;
      const res = await WERK.staffRemover(b.dataset.eqRemover);
      if (res.ok) toast('Removido da equipe', `${b.dataset.eqNome} não acessa mais o painel.`);
      else toast('Não foi possível', res.erro);
      views.equipe();
    }));
    const verSenha = $('#eq-senha-ver');
    if (verSenha) verSenha.addEventListener('click', () => {
      const inp = $('#eq-senha');
      const mostrando = inp.type === 'text';
      inp.type = mostrando ? 'password' : 'text';
      verSenha.textContent = mostrando ? '👁 ver' : '🙈 ocultar';
    });
    const criar = $('#eq-criar');
    if (criar) criar.addEventListener('click', async () => {
      const nome = $('#eq-nome').value.trim(), email = $('#eq-email').value.trim();
      const senha = $('#eq-senha').value, papel = $('#eq-papel').value;
      if (!nome || !/.+@.+\..+/.test(email)) { toast('Confira os campos', 'Nome e um e-mail válido são obrigatórios.'); return; }
      if ((senha || '').length < 6) { toast('Senha curta', 'A senha provisória precisa de pelo menos 6 caracteres.'); return; }
      criar.disabled = true; criar.textContent = 'Criando…';
      const res = await WERK.staffCriar({ nome, email, senha, papel });
      if (res.ok) {
        toast('Acesso criado', res.jaExistia
          ? `${nome} já tinha um login — a senha antiga foi mantida e o papel, ajustado.`
          : `Entregue a ${nome.split(' ')[0]}: ${email} + a senha provisória escolhida.`);
        views.equipe();
      } else { toast('Não foi possível criar', res.erro); criar.disabled = false; criar.textContent = 'Criar acesso'; }
    });
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
        <h3>${I('home')} Identidade da oficina <span style="font-size:10px;color:var(--txt-3)">— aparece no painel, no app do cliente e nos documentos</span></h3>
        <div class="wk-idbrand">
          <div class="wk-idlogo">
            <label class="wk-idlabel">Logo — fundo escuro (painel / app)</label>
            <label class="wk-logo-slot" id="cf-logo-slot">
              <img id="cf-logo-prev" alt="logo"${c.oficina.logo ? ` src="${c.oficina.logo}"` : ' hidden'}>
              <span id="cf-logo-ph"${c.oficina.logo ? ' hidden' : ''}>＋ enviar logo<br><small>PNG, SVG ou WEBP</small></span>
              <input id="cf-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>
            </label>
            <button type="button" class="wk-logo-rm" id="cf-logo-rm"${c.oficina.logo ? '' : ' hidden'}>remover</button>
          </div>
          <div class="wk-idlogo">
            <label class="wk-idlabel">Logo — fundo claro (documentos)</label>
            <label class="wk-logo-slot light" id="cf-logodoc-slot">
              <img id="cf-logodoc-prev" alt="logo documentos"${c.oficina.logoDoc ? ` src="${c.oficina.logoDoc}"` : ' hidden'}>
              <span id="cf-logodoc-ph"${c.oficina.logoDoc ? ' hidden' : ''}>＋ enviar logo escuro<br><small>usado no PDF branco</small></span>
              <input id="cf-logodoc" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>
            </label>
            <button type="button" class="wk-logo-rm" id="cf-logodoc-rm"${c.oficina.logoDoc ? '' : ' hidden'}>remover</button>
          </div>
          <div class="wk-idlogo">
            <label class="wk-idlabel">Ícone do app (quadrado)</label>
            <label class="wk-logo-slot square" id="cf-icon-slot">
              <img id="cf-icon-prev" alt="ícone"${c.oficina.icon ? ` src="${c.oficina.icon}"` : ' hidden'}>
              <span id="cf-icon-ph"${c.oficina.icon ? ' hidden' : ''}>＋ ícone<br><small>app instalado</small></span>
              <input id="cf-icon" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>
            </label>
            <button type="button" class="wk-logo-rm" id="cf-icon-rm"${c.oficina.icon ? '' : ' hidden'}>remover</button>
          </div>
        </div>
        <p style="font-size:10.5px;color:var(--txt-3);margin:8px 0 0">📲 Logo e ícone viram a marca do <b>app instalável</b> (mobile e desktop). Sem ícone quadrado, o app usa o logo ou as iniciais da oficina.</p>
        <div class="wk-grid2" style="margin-top:14px">
          <div class="wfield"><label>Nome da oficina (razão social)</label><input id="cf-nome" value="${esc(c.oficina.nome)}" placeholder="Ex.: Sua Oficina Automotiva LTDA"></div>
          <div class="wfield"><label>CNPJ</label><input id="cf-cnpj" value="${esc(c.oficina.cnpj)}" placeholder="00.000.000/0001-00"></div>
        </div>
        <div class="wk-grid2" style="margin-top:12px">
          <div class="wfield"><label>Endereço completo</label><input id="cf-endereco" value="${esc(c.oficina.endereco)}" placeholder="Rua, nº — bairro, Cidade/UF · CEP"></div>
          <div class="wfield"><label>Cidade/UF</label><input id="cf-cidade" value="${esc(c.oficina.cidade)}" placeholder="Cidade/UF"></div>
        </div>
        <div class="wk-grid3" style="margin-top:12px">
          <div class="wfield"><label>WhatsApp / telefone</label><input id="cf-fone" value="${esc(c.oficina.fone)}" placeholder="(00) 90000-0000"></div>
          <div class="wfield"><label>E-mail</label><input id="cf-email" value="${esc(c.oficina.email)}" placeholder="contato@suaoficina.com.br"></div>
          <div class="wfield"><label>Horário de funcionamento</label><input id="cf-horario" value="${esc(c.oficina.horario)}" placeholder="Seg–Sex 8h–18h · Sáb 8h–12h"></div>
        </div>
        <div class="wk-grid2" style="margin-top:12px">
          <div class="wfield"><label>Chave Pix (recebimento)</label><input id="cf-pix" value="${esc(c.oficina.pixChave)}" placeholder="sua-chave@pix"></div>
          <div class="wfield"><label>Site / domínio</label><input id="cf-site" value="${esc(c.oficina.site)}" placeholder="suaoficina.com.br"></div>
        </div>
      </div>
      ${WERK.cloud ? `
      <div class="wk-panel">
        <h3>${I('user')} Sessão da equipe (nuvem)</h3>
        <p style="font-size:12px;color:var(--txt-2);margin-bottom:10px">Conectado como <b>${(WERK.authUser() || {}).email || '—'}</b>${(WERK.staffPerfil() || {}).papel ? ` · papel <b>${(WERK.staffPerfil() || {}).papel}</b>` : ''} · dados servidos pelo Supabase com RLS.</p>
        <div class="wk-grid2" style="max-width:520px;margin-bottom:12px">
          <div class="wfield"><label>Nova senha (mín. 6)</label><input id="cf-senha-nova" type="password" autocomplete="new-password"></div>
          <div style="display:flex;align-items:flex-end"><button class="btn btn-secondary" id="cf-senha-trocar">🔑 Trocar minha senha</button></div>
        </div>
        <button class="btn btn-secondary" id="cf-sair">Sair do WERK OS</button>
      </div>` : ''}
      <div class="wk-panel">
        <h3>📕 Dicionário de códigos <span style="font-size:10px;color:var(--txt-3)">— aprende a cada laudo lido pela IA para baratear as próximas leituras</span></h3>
        <p style="font-size:12px;color:var(--txt-2);margin-bottom:6px" id="cf-dic-stats">Carregando…</p>
        <p style="font-size:11px;color:var(--txt-3);margin-bottom:10px">Vem semeado com o banco OBD-II mundial (SAE J2012 — códigos genéricos P/motor e U/rede que qualquer scanner emite). Códigos genéricos C/B e os proprietários (hex BMW etc.) entram sozinhos conforme a IA lê os laudos reais da oficina. Códigos já conhecidos são decodificados localmente, sem custo de IA.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-secondary" id="cf-dic-ver" style="font-size:12px">Ver códigos aprendidos</button>
          <button type="button" class="btn btn-secondary" id="cf-dic-limpar" style="font-size:12px">Limpar aprendidos</button>
        </div>
      </div>
      <div class="wk-actions" style="justify-content:space-between">
        <button class="btn btn-secondary" id="cf-seed15">🚗 Carga de teste: +15 OS</button>\n        <button class="btn btn-secondary" id="cf-reset">${WERK.cloud ? '↺ Limpar cache local' : '↺ Resetar demo (limpa localStorage)'}</button>
        <button class="btn btn-primary" id="cf-save">Salvar configurações</button>
      </div>`;
    // Dicionário de códigos: estatísticas + visualizador dos aprendidos.
    (function wireDic() {
      const alvo = $('#cf-dic-stats'); if (!alvo || !WERK.dicStats) { if (alvo) alvo.textContent = ''; return; }
      const pinta = () => {
        const s = WERK.dicStats();
        const banco = s.banco >= 1000 ? (s.banco / 1000).toFixed(1).replace('.0', '') + ' mil' : s.banco;
        alvo.innerHTML = `<b>${s.aprendidos}</b> código(s) aprendido(s) da sua oficina · <b>${banco || '—'}</b> no banco OBD-II mundial`;
      };
      pinta();
      if (WERK.carregarSeedObd) WERK.carregarSeedObd().then(pinta).catch(() => {}); // atualiza quando o banco chega
      const ver = $('#cf-dic-ver');
      if (ver) ver.addEventListener('click', () => {
        const dic = (WERK.dicDump && WERK.dicDump()) || {};
        const chaves = Object.keys(dic).sort();
        const linhas = chaves.length ? chaves.map(k => {
          const d = dic[k] || {};
          return `<div style="border-bottom:1px solid var(--line);padding:7px 0;font-size:12px"><code style="color:var(--warn);font-weight:700">${esc(k)}</code> <span style="color:var(--txt-3);font-size:10px">${esc(d.sistema || '')}${d.vezes > 1 ? ' · ×' + d.vezes : ''}</span><div style="color:var(--txt-2);font-size:11px;margin-top:2px">${esc(d.descricao || '')}</div></div>`;
        }).join('') : '<p style="font-size:12px;color:var(--txt-3)">Nenhum código aprendido ainda. Assim que a IA ler um laudo, os códigos entram aqui e as próximas leituras deles saem sem custo.</p>';
        modal(`<h3 style="margin-bottom:10px">📕 Códigos aprendidos (${chaves.length})</h3><div style="max-height:60vh;overflow:auto">${linhas}</div><div class="wk-actions" style="margin-top:14px"><button class="btn btn-secondary" onclick="document.getElementById('wkModal').classList.remove('open')">Fechar</button></div>`);
      });
      const limpar = $('#cf-dic-limpar');
      if (limpar) limpar.addEventListener('click', () => {
        if (!confirm('Limpar os códigos aprendidos? O banco OBD-II mundial continua. A IA volta a aprender do zero os códigos proprietários.')) return;
        if (WERK.dicLimpar) WERK.dicLimpar();
        pinta(); toast('Dicionário aprendido limpo', 'O banco mundial segue ativo; os proprietários serão reaprendidos.');
      });
    })();
    // Uploads de logo (guardados em buffer até salvar).
    let logoBuf = c.oficina.logo || null, logoDocBuf = c.oficina.logoDoc || null, iconBuf = c.oficina.icon || null;
    const wireLogo = (inputId, prevId, phId, rmId, set) => {
      const input = $('#' + inputId), prev = $('#' + prevId), ph = $('#' + phId), rm = $('#' + rmId);
      if (input) input.addEventListener('change', () => {
        const f = input.files[0]; if (!f) return;
        if (f.size > 2.5 * 1024 * 1024) { toast('Logo grande demais', 'Use um arquivo até ~2,5 MB.'); input.value = ''; return; }
        logoToDataURL(f, url => { set(url); if (prev) { prev.src = url; prev.hidden = false; } if (ph) ph.hidden = true; if (rm) rm.hidden = false; });
      });
      if (rm) rm.addEventListener('click', () => { set(null); if (prev) { prev.removeAttribute('src'); prev.hidden = true; } if (ph) ph.hidden = false; rm.hidden = true; if (input) input.value = ''; });
    };
    wireLogo('cf-logo', 'cf-logo-prev', 'cf-logo-ph', 'cf-logo-rm', v => { logoBuf = v; });
    wireLogo('cf-logodoc', 'cf-logodoc-prev', 'cf-logodoc-ph', 'cf-logodoc-rm', v => { logoDocBuf = v; });
    wireLogo('cf-icon', 'cf-icon-prev', 'cf-icon-ph', 'cf-icon-rm', v => { iconBuf = v; });

    $('#cf-save').addEventListener('click', () => {
      const c2 = WERK.getConfig();
      c2.valorHora = +$('#cf-hora').value || 380;
      c2.margens = { original: +$('#cf-mo').value, oem: +$('#cf-me').value, aftermarket: +$('#cf-ma').value };
      c2.garantiaMeses = { peca: +$('#cf-gp').value, mo: +$('#cf-gm').value };
      const o = c2.oficina;
      o.nome = $('#cf-nome').value.trim();
      o.cnpj = $('#cf-cnpj').value.trim();
      o.endereco = $('#cf-endereco').value.trim();
      o.cidade = $('#cf-cidade').value.trim();
      o.fone = $('#cf-fone').value.trim();
      o.email = $('#cf-email').value.trim();
      o.horario = $('#cf-horario').value.trim();
      o.pixChave = $('#cf-pix').value.trim();
      o.site = $('#cf-site').value.trim();
      o.logo = logoBuf; o.logoDoc = logoDocBuf; o.icon = iconBuf;
      WERK.saveConfig(c2);
      renderBrand();
      toast('Identidade salva', 'Sua marca já vale no painel, no app do cliente e nos documentos.');
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
    const trocar = $('#cf-senha-trocar');
    if (trocar) trocar.addEventListener('click', async () => {
      const nova = $('#cf-senha-nova').value;
      if ((nova || '').length < 6) { toast('Senha curta', 'Use pelo menos 6 caracteres.'); return; }
      const res = await WERK.mudarMinhaSenha(nova);
      if (res.ok) { $('#cf-senha-nova').value = ''; toast('Senha trocada', 'Use a nova senha no próximo login.'); }
      else toast('Não foi possível', res.erro);
    });
  };

  /* Marca white-label: logo/nome da oficina logada no topo + banner de first-run.
     LexOS é a marca do fornecedor (sub-rótulo discreto). */
  function renderBrand() {
    const m = (WERK.marca && WERK.marca()) || {};
    const el = $('#wkBrand');
    if (el) {
      const sub = '<small style="font-family:var(--font-display);font-size:8px;font-weight:700;letter-spacing:.26em;color:var(--red);text-transform:uppercase">LexOS · Painel da Oficina</small>';
      const primary = m.temLogo
        ? `<img src="${m.logo}" alt="${esc(m.displayNome)}" style="max-width:172px;max-height:54px;width:auto;height:auto">`
        : `<span class="wk-brand-name" style="font-family:var(--font-display);font-weight:800;font-size:20px;letter-spacing:.02em;color:var(--txt)">${esc(m.displayNome)}</span>`;
      el.innerHTML = primary + sub;
    }
    const banner = $('#wkSetupBanner');
    if (banner) banner.hidden = WERK.isDemo || !!m.configurada; // na demo nao pede configuracao
    // Chip de conta: quem está logado + oficina + sair (só na nuvem, com staff).
    const acc = $('#wkAccount');
    if (acc) {
      const u = (WERK.cloud || WERK.isDemo) ? WERK.authUser() : null;
      const perfil = WERK.staffPerfil && WERK.staffPerfil();
      if (u && perfil) {
        const em = u.email || '';
        const av = ((m.displayNome || em || '?').trim()[0] || '?').toUpperCase();
        const rot = WERK.isDemo ? '🧪 demonstração · ' + esc(perfil.papel || '') : esc(em) + (perfil.papel ? ' · ' + esc(perfil.papel) : '');
        acc.innerHTML = `<span class="av">${esc(av)}</span><span class="who"><b>${esc(m.displayNome)}</b><small>${rot}</small></span><button class="out" id="wkSair" title="${WERK.isDemo ? 'Sair da demonstração' : 'Sair da conta'}" aria-label="Sair">⎋</button>`;
        acc.hidden = false;
        const out = $('#wkSair');
        if (out) out.addEventListener('click', async () => {
          if (WERK.isDemo) { try { sessionStorage.removeItem('evx.demo'); sessionStorage.removeItem('evx.demo.papel'); } catch (_) {} location.href = 'demo.html'; return; }
          if (confirm('Sair desta conta?')) { await WERK.logoutAuth(); location.reload(); }
        });
      } else { acc.hidden = true; acc.innerHTML = ''; }
    }
    // Demonstração: exibe a separação por papel — o mecânico vê só o operacional
    // (check-in, quadro, veículos, peças); gestão/equipe/clientes ficam com gestor/admin.
    // Produção segue inalterada; RBAC real por papel é um próximo passo opcional.
    if (WERK.isDemo) {
      const papel = (WERK.staffPerfil() || {}).papel || 'gestor';
      $$('#wkNav button[data-roles]').forEach(b => {
        b.style.display = b.dataset.roles.split(',').includes(papel) ? '' : 'none';
      });
    }
  }

  /* Tempo real entre abas: aprovações/mudanças feitas no app
     do cliente redesenham a view atual do painel na hora. */
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('evx.') && !$('#wkModal').classList.contains('open')) { renderBrand(); route(); }
  });
  window.addEventListener('evx:sync', () => { // realtime da nuvem
    if (!$('#wkModal').classList.contains('open')) { renderBrand(); route(); }
  });

  WERK.ready.then(() => { renderBrand(); route(); });
})();
