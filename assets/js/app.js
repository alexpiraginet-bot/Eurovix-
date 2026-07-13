/* ============================================================
   EUROVIX · App do Cliente — SPA
   Integrado ao WERK OS: as ordens de serviço, orçamentos,
   chat, garantias e pendências vêm do MESMO store que o
   painel da oficina (werkos.html). Abra os dois lado a lado:
   o que a oficina faz aparece aqui em tempo real.
   ============================================================ */

(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];

  const state = {
    user: null,
    vehicleIdx: 0,
    tab: 'inicio',
    osOpen: null,
  };

  /* ============================================================
     Boot: splash → sessão → login/app
     ============================================================ */
  const splash = $('#splash');
  const loginView = $('#loginView');
  const conviteView = $('#conviteView');
  const CONVITE = new URLSearchParams(location.search).get('convite');
  const PREVIEW = new URLSearchParams(location.search).has('preview');

  Promise.all([WERK.ready, new Promise(r => setTimeout(r, 1400))]).then(() => {
    splash.classList.add('hide');
    if (WERK.cloud) $('#loginForm .login-demo').style.display = 'none'; // produção: sem conta demo
    // ?preview=1 (com EVX_ENV zerado no app.html) entra direto na conta demo local,
    // para mostrar o app do cliente ao vivo mesmo em produção (dados fictícios).
    if (PREVIEW && !WERK.cloud) {
      doLogin(EVX.DEMO_USER.telefone, 'bmw2026').then(() =>
        toast('Modo demonstração', 'Dados fictícios — explore o app, o 3D e a garagem à vontade.', 'ok'));
      return;
    }
    if (CONVITE) { handleConvite(CONVITE); return; }
    const session = EVX.getSession();
    const autentico = !WERK.cloud || !!WERK.authUser(); // nuvem exige sessão auth válida
    if (session && session.telefone && autentico) enter(session);
    else {
      if (session) EVX.clearSession(); // sessão antiga/expirada → login por telefone
      loginView.classList.remove('hide');
    }
  });

  /* ============================================================
     Login por telefone + senha · convite do check-in
     ============================================================ */
  function loginInfo(msg) {
    const el = $('#loginInfo');
    el.textContent = msg;
    el.classList.add('show');
  }

  async function handleConvite(tok) {
    const c = await WERK.clientePorConvite(tok);
    if (!c) {
      loginView.classList.remove('hide');
      loginInfo('Convite não encontrado neste aparelho. Peça um novo link no balcão da EUROVIX ou entre com telefone e senha.');
      return;
    }
    if (c.senha) {
      $('#l-tel').value = c.telefone;
      loginView.classList.remove('hide');
      loginInfo('Seu acesso já está ativo — entre com sua senha.');
      return;
    }
    $('#convHello').textContent = `Bem-vindo(a), ${c.nome.split(' ')[0]}!`;
    const g = WERK.garagemDe(c.telefone);
    $('#convVeics').innerHTML = g.length
      ? g.map(v => `<div class="conv-veic">${EVX.icon('car', 20)}<div><b>${v.modelo}</b><br><span>${v.placa}${v.cor ? ' · ' + v.cor : ''}</span></div></div>`).join('')
      : `<div class="conv-veic">${EVX.icon('car', 20)}<span>Seus veículos aparecem aqui após o check-in.</span></div>`;
    $('#c-tel').value = c.telefone;
    conviteView.classList.remove('hide');
  }

  $('#demoBtn').addEventListener('click', () => {
    $('#l-tel').value = EVX.DEMO_USER.telefone;
    $('#l-senha').value = 'bmw2026';
    doLogin(EVX.DEMO_USER.telefone, 'bmw2026');
  });
  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin($('#l-tel').value.trim(), $('#l-senha').value);
  });
  $('#forgotLink').addEventListener('click', (e) => {
    e.preventDefault();
    toast('Recuperação de acesso', 'Peça um novo link de acesso no balcão ou pelo WhatsApp da EUROVIX — você cria a senha de novo na hora.', 'ok');
  });

  $('#conviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#convErr');
    const s1 = $('#c-senha').value, s2 = $('#c-senha2').value;
    if (s1.length < 4 || s1 !== s2) { err.classList.add('show'); return; }
    err.classList.remove('show');
    const c = await WERK.ativarCliente(CONVITE, s1);
    if (!c) { err.textContent = 'Convite inválido — peça um novo link no balcão.'; err.classList.add('show'); return; }
    const session = { nome: c.nome, telefone: c.telefone, desde: c.desde };
    EVX.setSession(session);
    history.replaceState(null, '', location.pathname);
    conviteView.classList.add('hide');
    toast('Acesso criado ✓', 'Seu login é o seu telefone. Bem-vindo(a) ao app EUROVIX!', 'ok');
    enter(session);
  });
  $('#convToLogin').addEventListener('click', async () => {
    const c = await WERK.clientePorConvite(CONVITE);
    if (c && c.telefone) $('#l-tel').value = c.telefone;
    conviteView.classList.add('hide');
    loginView.classList.remove('hide');
  });

  async function doLogin(tel, senha) {
    const err = $('#loginErr');
    const c = await WERK.loginCliente(tel, senha);
    if (!c) { err.classList.add('show'); return; }
    err.classList.remove('show');
    const session = { nome: c.nome, telefone: c.telefone, desde: c.desde };
    if ($('#l-lembrar').checked || WERK.cloud) EVX.setSession(session);
    enter(session);
  }

  function enter(session) {
    state.user = session;
    loginView.classList.add('hide');
    $('#appHeader').hidden = false;
    $('#views').hidden = false;
    $('#tabbar').hidden = false;
    $('#helloName').textContent = session.nome.split(' ')[0];

    if (!EVX.getNotifications().length) {
      EVX.pushNotification({ titulo: 'Bem-vindo ao app EUROVIX!', texto: 'Acompanhe seu BMW, aprove orçamentos item a item e fale com seu consultor por aqui.', quando: Date.now(), tipo: 'ok' });
      if (myOS().some(o => o.numero === 1258 && o.status === 'aprovacao')) {
        EVX.pushNotification({ titulo: 'OS #1258 aguarda sua aprovação', texto: 'O orçamento da revisão + bieletas está pronto — aprove pelo app.', quando: Date.now(), tipo: 'os' });
      }
    }
    renderAll();
  }

  async function logout() { await WERK.logoutAuth(); EVX.clearSession(); location.reload(); }

  /* ============================================================
     Helpers
     ============================================================ */
  function toast(titulo, texto, tipo) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (tipo || '');
    el.innerHTML = `${EVX.icon(tipo === 'ok' ? 'check' : 'bell', 18)}<div><b>${titulo}</b><span>${texto}</span></div>`;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 4200);
  }
  function timeAgo(ts) {
    const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
  }
  /* Garagem: veículos cujo ÚLTIMO check-in pertence a este telefone.
     EVX.VEHICLES vira só catálogo de saúde curada (match por placa). */
  const garagem = () => WERK.garagemDe(state.user ? state.user.telefone : '');
  const DEFAULT_SAUDE = { oleo: 82, freios: 76, pneus: 84, bateria: 90 };
  function vehicleView(v) {
    const st = EVX.VEHICLES.find(s => WERK.normPlaca(s.placa) === WERK.normPlaca(v.placa));
    const km = v.km || (st ? st.km : 0);
    const marco = (Math.floor(km / 10000) + 1) * 10000;
    return {
      vin: v.vin, modelo: v.modelo,
      ano: v.anoModelo || (st ? st.ano : ''), cor: v.cor || (st ? st.cor : '—'),
      placa: v.placa || '—', km,
      proxRevisao: st ? st.proxRevisao : { km: marco, titulo: `Revisão dos ${marco.toLocaleString('pt-BR')} km`, restante: Math.max(0, marco - km) },
      saude: st ? st.saude : DEFAULT_SAUDE,
    };
  }
  function vehicle() {
    const g = garagem();
    if (!g.length) return null;
    if (state.vehicleIdx >= g.length) state.vehicleIdx = 0;
    return vehicleView(g[state.vehicleIdx]);
  }

  /* OS do cliente logado — vínculo pelo telefone registrado no check-in */
  function myOS() {
    const t = WERK.normTel(state.user ? state.user.telefone : '');
    return t ? WERK.getAllOS().filter(o => WERK.normTel(o.telefone) === t) : [];
  }
  const osAtivas = () => myOS().filter(o => o.status !== 'entregue');
  const osConcluidas = () => myOS().filter(o => o.status === 'entregue');

  function osStateCls(o) {
    if (o.status === 'entregue' || o.status === 'pronto') return 'done';
    if (o.status === 'aprovacao' && (o.itens || []).some(i => i.aprovacao === 'pendente')) return 'approve';
    return 'live';
  }
  function osBadge(o) {
    const st = WERK.STATUS[WERK.statusIdx(o.status)];
    if (o.status === 'entregue') return '<span class="os-badge done">Concluída</span>';
    const cls = osStateCls(o);
    if (cls === 'approve') return '<span class="os-badge approve">Aprovar orçamento</span>';
    return `<span class="os-badge ${cls === 'done' ? 'done' : 'live'}">${st ? st.cliente : o.status}</span>`;
  }
  // pílula-imagem do status atual (arte 3D por etapa) — usada no detalhe da OS;
  // a lista segue com o badge de texto compacto. 'entregue' não tem arte própria.
  const STATUS_PILL = { fila: 'pill-fila', diagnostico: 'pill-diagnostico', aprovacao: 'pill-aprovacao', peca: 'pill-peca', execucao: 'pill-execucao', qc: 'pill-qc', lavagem: 'pill-lavagem', pronto: 'pill-pronto' };
  const STATUS_PILL_H = { 'pill-fila': 245, 'pill-diagnostico': 269, 'pill-aprovacao': 214, 'pill-peca': 239, 'pill-execucao': 243, 'pill-qc': 223, 'pill-lavagem': 227, 'pill-pronto': 206 };
  function statusPillImg(o) {
    const st = WERK.STATUS[WERK.statusIdx(o.status)];
    const key = STATUS_PILL[o.status];
    if (o.status !== 'entregue' && key && st)
      return `<div class="status-pill"><img src="assets/img/status/${key}.webp" alt="${st.cliente}" width="1000" height="${STATUS_PILL_H[key]}" loading="lazy"></div>`;
    return osBadge(o);
  }
  function osCardHTML(o) {
    return `
      <div class="os-card" data-os="${o.numero}" role="button" tabindex="0">
        <span class="os-dot ${osStateCls(o)}"></span>
        <div class="os-info">
          <b>OS #${o.numero} · ${(o.itens && o.itens[0] ? o.itens[0].titulo : (o.sintoma || 'Check-in')).slice(0, 34)}</b>
          <span>${o.veiculo || ''} · ${o.placa || ''}</span>
        </div>
        ${osBadge(o)}
      </div>`;
  }

  /* ============================================================
     Início
     ============================================================ */
  function renderInicio() {
    const g = garagem();
    const v = vehicle();
    const pct = v ? Math.min(100, Math.round((v.km / v.proxRevisao.km) * 100)) : 0;
    const live = osAtivas();
    const pend = WERK.pendencias(state.user.telefone);
    const healthClass = (n) => n >= 75 ? 'g' : n >= 50 ? 'w' : 'd';
    const healthLabel = { oleo: 'Óleo', freios: 'Freios', pneus: 'Pneus', bateria: 'Bateria' };

    $('[data-view="inicio"]').innerHTML = `
      ${v ? `
      <div class="vehicle-card">
        <div class="vc-top">
          <div>
            <div class="mod">${v.modelo}</div>
            <div class="sub">${v.ano} · ${v.cor} · ${v.placa}</div>
          </div>
          ${g.length > 1 ? '<button class="vc-switch" id="vcSwitch">Trocar ⇄</button>' : ''}
        </div>
        <div class="vc-km"><span class="v">${v.km.toLocaleString('pt-BR')} km</span><span class="k">odômetro</span></div>
        <div class="vc-bar"><i style="width:${pct}%"></i></div>
        <div class="vc-next">Próxima manutenção em <b>${v.proxRevisao.restante.toLocaleString('pt-BR')} km</b> — ${v.proxRevisao.titulo}</div>
        <div class="vc-cta">
          <a class="btn btn-primary" href="agendamento.html">Agendar</a>
          <button class="btn btn-secondary" data-goto="os">Minhas OS</button>
        </div>
      </div>

      <div class="sec-label">Seu BMW em 3D <a data-goto="os">minhas OS</a></div>
      <div class="d3-card">
        ${window.WERK3D && WERK3D.embedReal ? `<div class="d3-tabs">
          <button class="d3-tab on" data-d3="insp">Inspeção DVI</button>
          <button class="d3-tab" data-d3="real">Modelo real</button>
        </div>` : ''}
        <div class="d3-pane on" data-pane="insp">
          <div id="twin3d" style="height:236px"></div>
          <p class="d3-note">Arraste para girar · toque nos pontos para ver o status de cada item (DVI).</p>
        </div>
        ${window.WERK3D && WERK3D.embedReal ? `<div class="d3-pane" data-pane="real">
          <div id="twinReal" style="height:280px"></div>
          <p class="d3-note">Modelo 3D real do seu ${v.modelo} — arraste para girar e dê zoom (demonstração).</p>
        </div>` : ''}
      </div>

      <div class="sec-label">Saúde do veículo</div>
      <div class="health-grid">
        ${Object.entries(v.saude).map(([k, n]) => `
          <div class="hcard ${healthClass(n)}">
            <div class="hk"><span>${healthLabel[k]}</span><b>${n}%</b></div>
            <div class="hbar"><i style="width:${n}%"></i></div>
          </div>`).join('')}
      </div>
      ` : `
      <div class="vehicle-card">
        <div class="vc-top">
          <div>
            <div class="mod">Sua garagem</div>
            <div class="sub">Nenhum veículo vinculado no momento</div>
          </div>
        </div>
        <div class="vc-next">Seu BMW entra aqui automaticamente no check-in da EUROVIX — e a garagem segue sempre o dono atual de cada placa.</div>
        <div class="vc-cta">
          <a class="btn btn-primary" href="agendamento.html">Agendar visita</a>
          <button class="btn btn-secondary" data-goto="os">Minhas OS</button>
        </div>
      </div>
      `}

      <div class="sec-label">Ações rápidas</div>
      <div class="quick-grid">
        <a class="qbtn" href="agendamento.html">${EVX.icon('calendar', 19)}Agendar</a>
        <button class="qbtn" data-goto="servicos">${EVX.icon('scan', 19)}Serviços</button>
        <button class="qbtn" data-goto="os">${EVX.icon('doc', 19)}Histórico</button>
        <a class="qbtn" href="https://wa.me/${EVX.CONTACT.whatsapp}?text=${encodeURIComponent('Olá! Estou no app EUROVIX e preciso de ajuda.')}" target="_blank" rel="noopener">${EVX.icon('whats', 19)}Suporte</a>
      </div>

      ${live.length ? `<div class="sec-label">Em andamento <a data-goto="os">ver tudo</a></div>${live.map(osCardHTML).join('')}` : ''}

      ${pend.length ? `
        <div class="sec-label">Pendências futuras</div>
        ${pend.map(p => `
          <div class="acard" style="display:flex;gap:12px;align-items:center">
            ${EVX.icon('alert', 22)}
            <div style="flex:1">
              <b style="font-family:var(--font-display);font-size:12.5px">${p.item.titulo}</b>
              <p style="font-size:11px;color:var(--txt-2);margin-top:2px">Adiado na OS #${p.os} — recomendado nos próximos 3.000 km. Reagende quando quiser.</p>
            </div>
            <a class="btn btn-secondary" style="padding:9px 13px;font-size:11px" href="agendamento.html?servico=${p.item.categoria === 'freio_d' || p.item.categoria === 'disco_d' ? 'freios' : 'manutencao'}">Agendar</a>
          </div>`).join('')}` : ''}
    `;

    const sw = $('#vcSwitch');
    if (sw) sw.addEventListener('click', () => {
      state.vehicleIdx = (state.vehicleIdx + 1) % garagem().length;
      renderInicio();
      toast('Veículo alterado', `Mostrando ${vehicle().modelo} (${vehicle().placa}).`, 'ok');
    });
    // Efeitos colaterais pós-render: NUNCA podem derrubar a tela já montada
    // (um erro de WebGL/three.js aqui não pode virar tela de falha).
    try {
      if (v && window.EVXTwin) EVXTwin.mount('#twin3d', { saude: v.saude, modelo: v.modelo, compact: true });
    } catch (e) { console.error('EVXTwin.mount falhou (segue sem o twin)', e); }
    // Alternador 3D: monta o modelo BMW real só na 1ª vez que a aba é aberta (lazy — sem custo no load).
    try {
      if (v && window.WERK3D && WERK3D.embedReal) {
        const card = $('[data-view="inicio"]').querySelector('.d3-card');
        if (card) card.querySelectorAll('[data-d3]').forEach(btn => btn.addEventListener('click', () => {
          const which = btn.dataset.d3;
          card.querySelectorAll('.d3-tab').forEach(t => t.classList.toggle('on', t === btn));
          card.querySelectorAll('.d3-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === which));
          if (which === 'real') {
            const box = card.querySelector('#twinReal');
            if (box && !box.dataset.loaded) {
              try { WERK3D.embedReal(box, v.modelo); box.dataset.loaded = '1'; } catch (_) {}
            }
          }
        }));
      }
    } catch (e) { console.error('alternador 3D falhou (segue sem ele)', e); }
    bindCommon($('[data-view="inicio"]'));
  }

  /* ============================================================
     Serviços
     ============================================================ */
  function renderServicos() {
    $('[data-view="servicos"]').innerHTML = `
      <h2 class="vtitle">Serviços</h2>
      <p class="vsub">Todo o catálogo EUROVIX — toque para agendar.</p>
      <div class="svc-grid">
        ${EVX.SERVICES.map(s => `
          <a class="svc-tile" href="agendamento.html?servico=${s.id}">
            <div class="ico-wrap">${EVX.icon(s.icon, 20)}</div>
            <b>${s.nome}</b>
            <span>${s.tag}</span>
          </a>`).join('')}
      </div>
      <div class="acard" style="margin-top:16px;display:flex;gap:13px;align-items:center">
        ${EVX.icon('shield', 26)}
        <div style="flex:1">
          <b style="font-family:var(--font-display);font-size:13px">Garantia EUROVIX</b>
          <p style="font-size:11.5px;color:var(--txt-2);margin-top:2px">12 meses em peças e mão de obra, item a item, com contagem regressiva no seu perfil.</p>
        </div>
      </div>`;
  }

  /* ============================================================
     OS — lista + detalhe (consome o WERK OS)
     ============================================================ */
  function renderOS() {
    const view = $('[data-view="os"]');
    if (state.osOpen != null) { renderOSDetail(view); return; }
    const ativas = osAtivas(), antigas = osConcluidas();
    view.innerHTML = `
      <h2 class="vtitle">Ordens de Serviço</h2>
      <p class="vsub">Rastreamento ao vivo — como acompanhar uma encomenda.</p>
      ${ativas.length ? `<div class="sec-label">Em andamento</div>${ativas.map(osCardHTML).join('')}` : ''}
      ${antigas.length ? `<div class="sec-label">Concluídas</div>${antigas.map(osCardHTML).join('')}` : ''}
      ${!ativas.length && !antigas.length ? `
        <div class="empty-state">${EVX.icon('doc', 40)}<p>Nenhuma ordem de serviço ainda.</p>
        <a class="btn btn-primary" href="agendamento.html">Agendar um serviço</a></div>` : ''}
    `;
    bindCommon(view);
  }

  function renderOSDetail(view) {
    const o = WERK.getOS(state.osOpen);
    if (!o) { state.osOpen = null; renderOS(); return; }
    const idx = WERK.statusIdx(o.status);
    const aprovaveis = o.itens.filter(i => i.severidade !== 'ok');
    const precisaAprovar = o.status === 'aprovacao' && aprovaveis.some(i => i.aprovacao === 'pendente');

    view.innerHTML = `
      <div class="os-detail-head">
        <button class="back-btn" id="osBack" aria-label="Voltar">${EVX.icon('back', 16)}</button>
        <div>
          <b>OS #${o.numero}</b>
          <span>${o.veiculo} · ${o.placa} · aberta em ${WERK.fd(o.criada)}</span>
        </div>
      </div>
      ${statusPillImg(o)}

      <div class="sec-label" style="margin-top:16px">Rastreamento</div>
      <div class="acard">
        <div class="timeline">
          ${WERK.STATUS.map((s, i) => {
            const done = i < idx || o.status === 'entregue';
            const now = i === idx && o.status !== 'entregue';
            const approve = now && precisaAprovar;
            return `
              <div class="tl-item ${done ? 'done' : now ? (approve ? 'approve' : 'now') : ''}">
                <span class="tl-dot">${done ? '✓' : ''}</span>
                <b>${s.cliente}</b>
                ${now ? `<p>${approve ? 'Seu OK libera o serviço — aprove abaixo.' : 'Etapa atual.'}</p><span class="tl-time">agora</span>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="sec-label">Atualizações do box</div>
      <div class="acard">
        ${[...o.eventos].reverse().slice(0, 6).map(e => `
          <div style="padding:8px 0;border-bottom:1px dashed var(--line)">
            <b style="font-family:var(--font-display);font-size:12px">${e.titulo}</b>
            <p style="font-size:11.5px;color:var(--txt-2)">${e.desc || ''}</p>
            <span style="font-size:9.5px;color:var(--txt-3)">${WERK.fdt(e.ts)} · ${e.ator}</span>
          </div>`).join('')}
      </div>

      ${precisaAprovar ? aprovacaoHTML(o) : orcamentoHTML(o)}

      ${o.aceite && !o.pagamento && WERK.totalOS(o, true) > 0 ? pagamentoHTML(o) : ''}

      <div class="sec-label">Documentos</div>
      <div class="acard" style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-secondary" style="padding:9px 13px;font-size:11px" href="documento.html?tipo=termo&os=${o.numero}" target="_blank">📄 Termo de Entrada</a>
        <a class="btn btn-secondary" style="padding:9px 13px;font-size:11px" href="documento.html?tipo=dvi&os=${o.numero}" target="_blank">📄 Inspeção (DVI)</a>
        <a class="btn btn-secondary" style="padding:9px 13px;font-size:11px" href="documento.html?tipo=orcamento&os=${o.numero}" target="_blank">📄 Orçamento</a>
        ${o.pagamento ? `<a class="btn btn-secondary" style="padding:9px 13px;font-size:11px" href="documento.html?tipo=fatura&os=${o.numero}" target="_blank">📄 Fatura</a>` : ''}
        ${o.itens.some(i => i.garantia) ? `<a class="btn btn-secondary" style="padding:9px 13px;font-size:11px" href="documento.html?tipo=garantia&os=${o.numero}" target="_blank">📄 Garantia</a>` : ''}
      </div>

      <div class="sec-label">Chat com ${o.consultor.split(' ')[0]}</div>
      <div class="acard">
        <div class="chat-box" id="chatBox" style="display:grid;gap:8px;max-height:220px;overflow-y:auto;margin-bottom:10px">
          ${o.chat.map(m => `
            <div style="max-width:80%;padding:9px 12px;border-radius:12px;font-size:12px;line-height:1.5;${m.de === o.cliente
              ? 'background:var(--blue-soft);border:1px solid var(--blue-border);justify-self:end'
              : 'background:var(--navy);border:1px solid var(--line-strong);justify-self:start'}">
              ${m.texto}<span style="display:block;font-size:9px;color:var(--txt-3);margin-top:3px">${WERK.fdt(m.ts)} · ${m.de.split(' ')[0]}</span>
            </div>`).join('') || '<p style="font-size:11.5px;color:var(--txt-3)">Fale direto com seu consultor — sem WhatsApp desorganizado.</p>'}
        </div>
        <div style="display:flex;gap:8px">
          <input id="chatInput" placeholder="Mensagem…" style="flex:1;background:var(--navy);border:1px solid var(--line-strong);border-radius:10px;padding:11px 13px;font-size:13px;color:var(--txt)">
          <button class="btn btn-primary" style="padding:10px 16px" id="chatSend">➤</button>
        </div>
      </div>
      ${o.status === 'entregue' && o.nps == null ? npsHTML(o) : ''}
    `;

    $('#osBack').addEventListener('click', () => { state.osOpen = null; renderOS(); });
    const send = $('#chatSend');
    if (send) send.addEventListener('click', () => {
      const t = $('#chatInput').value.trim();
      if (!t) return;
      WERK.chatCliente(o.numero, t);
      renderOSDetail(view);
    });
    bindAprovacao(o, view);
    bindPagamento(o, view);
    bindNps(o, view);
    const cb = $('#chatBox'); if (cb) cb.scrollTop = cb.scrollHeight;
  }

  /* ---------- orçamento (somente leitura) ---------- */
  function orcamentoHTML(o) {
    const aprovaveis = o.itens.filter(i => i.severidade !== 'ok');
    if (!aprovaveis.length) return '';
    return `
      <div class="sec-label">Orçamento</div>
      <div class="acard budget">
        ${aprovaveis.map(i => {
          const nv = i.niveis[i.nivelEscolhido || 'original'];
          return `
            <div class="b-item">
              <span style="${i.aprovacao === 'recusado' ? 'text-decoration:line-through;opacity:.55' : ''}">${i.titulo}
                <em style="display:block;font-style:normal;font-size:10px;color:var(--txt-3)">${nv.rotulo} · ${nv.fabricante} · ${i.aw} AW</em></span>
              <span style="${i.aprovacao === 'recusado' ? 'text-decoration:line-through;opacity:.55' : ''}">${WERK.brl(WERK.itemPreco(i))}</span>
            </div>`;
        }).join('')}
        <div class="b-total"><span>Total ${o.aceite ? 'aprovado' : ''}</span><span>${WERK.brl(WERK.totalOS(o, !!o.aceite))}</span></div>
        ${o.aceite ? `<p style="font-size:10.5px;color:var(--ok);margin-top:8px">✓ Aceite digital em ${WERK.fdt(o.aceite.ts)} · IP ${o.aceite.ip} · hash <code>${o.aceite.hash}</code></p>` : ''}
      </div>`;
  }

  /* ---------- aprovação interativa item a item ---------- */
  function aprovacaoHTML(o) {
    const aprovaveis = o.itens.filter(i => i.severidade !== 'ok');
    const sevIco = { critico: '🔴', preventivo: '🟡' };
    return `
      <div class="sec-label">Aprovação — item a item</div>
      <div class="acard" id="aprovBox">
        <p style="font-size:11.5px;color:var(--txt-2);margin-bottom:12px">Marque o que aprovar e escolha o nível de peça de cada item. Nada é executado sem o seu OK — e o que você adiar vira lembrete, não pressão.</p>
        ${aprovaveis.map(i => `
          <div style="border:1px solid var(--line);border-radius:13px;padding:12px 13px;margin-bottom:10px" data-item="${i.id}">
            <label style="display:flex;gap:10px;align-items:start;cursor:pointer">
              <input type="checkbox" class="ap-check" data-id="${i.id}" checked style="accent-color:var(--ok);width:17px;height:17px;margin-top:2px">
              <span style="flex:1">
                <b style="font-family:var(--font-display);font-size:13px">${sevIco[i.severidade]} ${i.titulo}</b>
                <em style="display:block;font-style:normal;font-size:10.5px;color:var(--txt-2);margin-top:2px">${i.nota || ''}</em>
              </span>
            </label>
            <div style="display:grid;gap:6px;margin-top:10px">
              ${['original', 'oem', 'aftermarket'].map(nk => {
                const n = i.niveis[nk];
                return `
                  <label style="display:flex;gap:9px;align-items:center;background:var(--navy);border:1px solid var(--line-strong);border-radius:10px;padding:9px 11px;cursor:pointer;font-size:11.5px">
                    <input type="radio" name="nv-${i.id}" value="${nk}" ${nk === 'original' ? 'checked' : ''} style="accent-color:var(--red)">
                    <span style="flex:1"><b style="font-family:var(--font-display)">${n.rotulo}</b> · ${n.fabricante} <em style="font-style:normal;color:var(--txt-3)">(${n.prazo}d)</em></span>
                    <b style="font-family:var(--font-display)">${WERK.brl(n.preco + i.mo)}</b>
                  </label>`;
              }).join('')}
            </div>
          </div>`).join('')}
        <div class="b-total" style="display:flex;justify-content:space-between;font-family:var(--font-display);font-weight:800;padding:8px 2px">
          <span>Total selecionado</span><span style="color:var(--red)" id="apTotal"></span>
        </div>
        <p style="font-size:10px;color:var(--txt-3);margin:6px 0 8px">Assine para registrar o aceite (validade jurídica: assinatura + IP + timestamp + hash do documento).</p>
        <div class="sig-pad" style="background:#F5F6F8;border-radius:12px"><canvas id="apSig" style="width:100%;height:110px;touch-action:none;display:block;border-radius:12px"></canvas></div>
        <button class="btn-image" type="button" style="margin-top:12px" id="apConfirm"><img src="assets/img/ui/btn-aprovar-sel.webp" alt="Aprovar selecionados" width="1000" height="227"></button>
      </div>`;
  }

  // Pagamento Pix pelo próprio app — aparece quando o cliente já aprovou o
  // orçamento e ainda não pagou. QR real (payload EMV) + copia-e-cola + botão.
  function pagamentoHTML(o) {
    const total = WERK.totalOS(o, true);
    // Em nuvem, a config vem do cache local (RLS: o cliente não lê config) e a
    // pixChave NÃO é confiável — pode ser placeholder de demo ou resquício de um
    // login staff no mesmo device. Gerar QR/copia com ela levaria a pagar o
    // destino errado. Só o modo demo/local (ou, no futuro, uma chave provida
    // pelo servidor para a sessão) gera o Pix; na nuvem mostra total + orientação.
    if (WERK.cloud) {
      return `
        <div class="sec-label">Pagamento</div>
        <div class="acard pay-card">
          <div class="pay-head">
            <div><span>Total a pagar</span><b>${WERK.brl(total)}</b></div>
            <span class="pay-badge">Pix</span>
          </div>
          <p class="pay-hint" style="margin-bottom:2px">O Pix desta OS é liberado pela oficina. Assim que estiver pronto, o QR aparece aqui — ou finalize com seu consultor pelo chat ou no balcão.</p>
        </div>`;
    }
    return `
      <div class="sec-label">Pagamento</div>
      <div class="acard pay-card">
        <div class="pay-head">
          <div><span>Total a pagar</span><b>${WERK.brl(total)}</b></div>
          <span class="pay-badge">Pix · à vista</span>
        </div>
        <div class="pay-qr" id="payQr" role="img" aria-label="QR Code Pix para pagamento"></div>
        <p class="pay-hint" id="payHint">Abra o app do seu banco, escaneie o QR — ou copie o código Pix abaixo.</p>
        <div class="pay-code" id="payCode"></div>
        <button type="button" class="btn btn-secondary pay-copy-btn" id="payCopyBtn">Copiar código Pix</button>
        <button type="button" class="btn-image" id="payPix"><img src="assets/img/ui/btn-pix.webp" alt="Pagar com Pix" width="1000" height="228"></button>
        <p class="pay-note">Ao confirmar, a nota fiscal e a garantia de cada item são liberadas na hora.</p>
      </div>`;
  }
  function bindPagamento(o, view) {
    const qbox = $('#payQr', view);
    if (!qbox) return;
    const total = WERK.totalOS(o, true);
    const payload = WERK.pixPayload(total, 'EVX' + o.numero);
    // código Pix como texto puro — a chave é configurável, então nunca interpolar em HTML
    const codeEl = $('#payCode', view);
    if (codeEl) codeEl.textContent = payload;
    let qrOk = false;
    try {
      if (typeof qrcode === 'function') {
        const qr = qrcode(0, 'M'); qr.addData(payload); qr.make();
        const img = document.createElement('img'); // via DOM, sem innerHTML (mantém o padrão do resto do código)
        img.src = qr.createDataURL(4, 4);
        img.alt = ''; // decorativo: o container já tem role="img" + aria-label
        qbox.appendChild(img);
        qrOk = true;
      }
    } catch (e) { /* cai no fallback abaixo */ }
    if (!qrOk) { // sem lib ou erro: oculta o QR e ajusta o texto para não citar "escaneie"
      qbox.style.display = 'none';
      const hint = $('#payHint', view);
      if (hint) hint.textContent = 'Copie o código Pix abaixo e cole no app do seu banco para pagar.';
    }
    const copyBtn = $('#payCopyBtn', view);
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const ok = () => toast('Código Pix copiado', 'Cole no app do seu banco para pagar.');
      const falha = () => toast('Copie manualmente', 'Toque e segure o código acima para selecioná-lo.');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload).then(ok).catch(falha);
      } else { falha(); }
    });
    // O botão só existe no modo demo/local (na nuvem a seção é o card "liberado
    // pela oficina", sem QR nem botão) — aqui é sempre a confirmação demo.
    const pay = $('#payPix', view);
    if (pay) pay.addEventListener('click', () => {
      if (pay.disabled) return;
      pay.disabled = true; // bloqueia duplo clique antes do re-render
      // DEMO/local: confirma na hora (ilustrativo). Em produção o gateway
      // (Mercado Pago / Stone) confirma por webhook e dispara este mesmo efeito.
      const paga = WERK.registrarPagamento(o.numero, { valor: total, desc: `Pix ${WERK.brl(total)} · NF emitida · garantia ativada`, ator: 'Cliente (app)' });
      if (paga) toast('Pagamento confirmado ✓', 'Nota fiscal e garantia liberadas. Recibo em Documentos.');
      else toast('Esta OS já está paga', 'A nota fiscal e a garantia já foram liberadas.'); // UI stale
      renderOSDetail(view);
    });
  }

  function bindAprovacao(o, view) {
    const box = $('#aprovBox', view);
    if (!box) return;
    const recalc = () => {
      let t = 0;
      o.itens.filter(i => i.severidade !== 'ok').forEach(i => {
        const cb = $(`.ap-check[data-id="${i.id}"]`, box);
        const nv = ($(`input[name="nv-${i.id}"]:checked`, box) || {}).value || 'original';
        if (cb && cb.checked) t += i.niveis[nv].preco + i.mo;
      });
      $('#apTotal', box).textContent = WERK.brl(t);
    };
    box.addEventListener('change', recalc);
    recalc();

    // assinatura
    const canvas = $('#apSig', box);
    const ctx = canvas.getContext('2d');
    const r = () => { const b = canvas.getBoundingClientRect(); canvas.width = b.width * 2; canvas.height = b.height * 2; ctx.scale(2, 2); ctx.strokeStyle = '#14181F'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; };
    r();
    let draw = false, empty = true, px = 0, py = 0;
    const pos = e => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    canvas.addEventListener('pointerdown', e => { draw = true; [px, py] = pos(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!draw) return;
      const [x, y] = pos(e);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
      px = x; py = y; empty = false;
    });
    canvas.addEventListener('pointerup', () => draw = false);

    $('#apConfirm', box).addEventListener('click', () => {
      if (empty) { toast('Assine para confirmar', 'O aceite precisa da sua assinatura.'); return; }
      const decisoes = {};
      o.itens.filter(i => i.severidade !== 'ok').forEach(i => {
        const cb = $(`.ap-check[data-id="${i.id}"]`, box);
        const nv = ($(`input[name="nv-${i.id}"]:checked`, box) || {}).value || 'original';
        decisoes[i.id] = { aprovado: !!(cb && cb.checked), nivel: nv };
      });
      const lista = Object.values(decisoes);
      const aprovadosN = lista.filter(d => d.aprovado).length;
      const recusadosN = lista.length - aprovadosN;
      const hash = (s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); })(JSON.stringify(Object.entries(decisoes)));
      WERK.aprovarOrcamento(o.numero, decisoes, { assinatura: true, ip: '187.36.170.42 (app)', hash: `${hash}…${o.numero}`, ts: new Date().toISOString() });
      toast('Aceite registrado ✓', recusadosN ? `${aprovadosN} itens aprovados. Os adiados viraram pendências com lembrete.` : 'Todos os itens aprovados — seu BMW já entra no box.', 'ok');
      renderAll();
    });
  }

  /* ---------- NPS pós-entrega ---------- */
  function npsHTML(o) {
    return `
      <div class="sec-label">Avalie sua experiência</div>
      <div class="acard" id="npsBox">
        <p style="font-size:12px;color:var(--txt-2);margin-bottom:10px">De 0 a 10, o quanto você recomendaria a EUROVIX?</p>
        <div style="display:grid;grid-template-columns:repeat(11,1fr);gap:4px">
          ${Array.from({ length: 11 }, (_, n) => `<button class="nps-n" data-n="${n}" style="padding:9px 0;border-radius:8px;border:1px solid var(--line-strong);background:var(--navy);color:var(--txt-2);cursor:pointer;font-family:var(--font-display);font-weight:700;font-size:12px">${n}</button>`).join('')}
        </div>
      </div>`;
  }
  function bindNps(o, view) {
    const box = $('#npsBox', view);
    if (!box) return;
    $$('.nps-n', box).forEach(b => b.addEventListener('click', () => {
      WERK.avaliarNps(o.numero, +b.dataset.n);
      toast('Obrigado! 🏁', 'Sua avaliação ajuda a manter o padrão EUROVIX.', 'ok');
      renderOS();
    }));
  }

  /* ============================================================
     Agenda
     ============================================================ */
  function renderAgenda() {
    const appts = EVX.getAppointments();
    $('[data-view="agenda"]').innerHTML = `
      <h2 class="vtitle">Agenda</h2>
      <p class="vsub">Seus agendamentos na EUROVIX.</p>
      ${appts.length ? appts.map(a => `
        <div class="appt-card">
          <div class="appt-date"><b>${(a.dataLabel.match(/\d+/) || ['—'])[0].padStart(2, '0')}</b><span>${(a.dataLabel.split(' ')[1] || '').split('/')[1] || a.dataLabel.split(' ')[0]}</span></div>
          <div class="appt-info">
            <b>${a.servicoNome}</b>
            <span>${a.veiculo}${a.placa ? ' · ' + a.placa : ''} · ${a.hora}</span>
            <span class="appt-proto">Protocolo ${a.protocolo}</span>
          </div>
          ${EVX.icon('check', 18)}
        </div>`).join('') : `
        <div class="empty-state">${EVX.icon('calendar', 40)}<p>Nenhum agendamento por aqui ainda.</p>
        <a class="btn btn-primary" href="agendamento.html">Agendar meu primeiro serviço</a></div>`}
      <a class="btn btn-secondary" style="width:100%;margin-top:10px" href="agendamento.html">+ Novo agendamento</a>`;
  }

  /* Modal do modelo 3D real da BMW — abre por veículo na garagem.
     Lazy: monta o embed só ao abrir e remove ao fechar (1 iframe por vez). */
  function open3dModal(v) {
    if (!(window.WERK3D && WERK3D.embedReal) || !v) return;
    const shell = document.getElementById('shell') || document.body;
    const ov = document.createElement('div');
    ov.className = 'd3-modal';
    ov.innerHTML = `
      <div class="d3-modal-card">
        <div class="d3-modal-head">
          <div><b>${v.modelo}</b><span>${v.placa || ''} · modelo 3D real</span></div>
          <button class="d3-modal-x" type="button" aria-label="Fechar">✕</button>
        </div>
        <div class="d3-modal-stage"></div>
      </div>`;
    shell.appendChild(ov);
    try { WERK3D.embedReal(ov.querySelector('.d3-modal-stage'), v.modelo); } catch (_) {}
    const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.querySelector('.d3-modal-x').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
  }

  /* ============================================================
     Perfil (garantias, cofre, veículos, sair)
     ============================================================ */
  function renderPerfil() {
    const u = state.user;
    const initials = u.nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
    const garantias = myOS().flatMap(o => (o.itens || []).filter(i => i.garantia).map(i => ({ os: o.numero, item: i })));
    const cofres = garagem();

    $('[data-view="perfil"]').innerHTML = `
      <h2 class="vtitle">Perfil</h2>
      <div class="profile-head">
        <span class="profile-avatar">${initials}</span>
        <div>
          <b>${u.nome}</b>
          <span>${u.telefone} · seu login no app</span><br>
          <span style="color:var(--red);font-family:var(--font-display);font-weight:700;font-size:10.5px;letter-spacing:.08em">CLIENTE DESDE ${u.desde}</span>
        </div>
      </div>

      <div class="sec-label">Garantias ativas — contagem regressiva</div>
      ${garantias.length ? garantias.map(g => {
        const dias = Math.max(0, Math.round((new Date(g.item.garantia.fim) - Date.now()) / 864e5));
        return `
          <div class="acard" style="display:flex;gap:12px;align-items:center">
            ${EVX.icon('shield', 22)}
            <div style="flex:1">
              <b style="font-family:var(--font-display);font-size:12.5px">${g.item.titulo}</b>
              <p style="font-size:10.5px;color:var(--txt-2)">OS #${g.os} · peça + mão de obra · até ${WERK.fd(g.item.garantia.fim)}</p>
            </div>
            <b style="font-family:var(--font-display);color:${dias > 60 ? 'var(--ok)' : 'var(--warn)'};font-size:13px">${dias}d</b>
          </div>`;
      }).join('') : '<div class="acard" style="font-size:12px;color:var(--txt-3)">Nenhuma garantia ativa no momento.</div>'}

      <div class="sec-label">Cofre digital do veículo</div>
      <div class="plist">
        ${cofres.flatMap(v => (v.cofre || []).map(d => `
          <button class="prow" data-cofre="${d}">${EVX.icon('doc', 20)}<div><b>${d}</b><span>${v.modelo}</span></div><span class="chev">›</span></button>`)).join('')
          || '<div style="padding:14px 16px;font-size:12px;color:var(--txt-3)">Manual, nota da chave codificada e laudos aparecem aqui.</div>'}
      </div>

      <div class="sec-label">Minha garagem</div>
      <div class="plist">
        ${garagem().map((v, i) => `
          <button class="prow" data-vehicle="${i}">
            ${EVX.icon('car', 20)}
            <div><b>${v.modelo}${v.anoModelo ? ' · ' + v.anoModelo : ''}</b><span>${v.placa} · ${(v.km || 0).toLocaleString('pt-BR')} km</span></div>
            ${i === state.vehicleIdx ? '<span class="os-badge done" style="margin-left:auto">ativo</span>' : '<span class="chev">›</span>'}
          </button>`).join('') || '<div style="padding:14px 16px;font-size:12px;color:var(--txt-3)">Nenhum veículo vinculado — ele entra aqui no próximo check-in.</div>'}
      </div>

      ${window.WERK3D && WERK3D.embedReal && garagem().length ? `
      <div class="sec-label">Meu BMW em 3D</div>
      <div class="plist">
        ${garagem().map((v, i) => `
          <button class="prow" data-veic3d="${i}">
            ${EVX.icon('car', 20)}
            <div><b>${v.modelo}</b><span>${v.placa} · ver o modelo real em 3D</span></div>
            <span class="chev">›</span>
          </button>`).join('')}
      </div>` : ''}

      <div class="sec-label">Histórico do veículo — transferível</div>
      <div class="plist">
        ${garagem().map(v => `
          <a class="prow" href="documento.html?tipo=prontuario&vin=${v.vin}" target="_blank">
            ${EVX.icon('doc', 20)}
            <div><b>Prontuário completo · ${v.placa}</b><span>PDF por chassi — na venda, entregue ao comprador</span></div>
            <span class="chev">›</span>
          </a>`).join('') || '<div style="padding:14px 16px;font-size:12px;color:var(--txt-3)">O prontuário de cada veículo seu aparece aqui.</div>'}
      </div>

      <div class="sec-label">Conta</div>
      <div class="plist">
        <a class="prow" href="index.html">${EVX.icon('home', 20)}<div><b>Site EUROVIX</b><span>Serviços e contato</span></div><span class="chev">›</span></a>
        <a class="prow" href="werkos.html" target="_blank">${EVX.icon('tool', 20)}<div><b>WERK OS — painel da oficina</b><span>Abra lado a lado e veja o tempo real</span></div><span class="chev">›</span></a>
        <a class="prow" href="apresentacao.html">${EVX.icon('doc', 20)}<div><b>Apresentação da marca</b><span>Identidade & ecossistema</span></div><span class="chev">›</span></a>
      </div>
      <div class="plist">
        <button class="prow danger" id="logoutBtn">${EVX.icon('logout', 20)}<div><b>Sair da conta</b><span>Encerrar sessão neste aparelho</span></div></button>
      </div>
      <p style="text-align:center;font-size:10.5px;color:var(--txt-3);margin-top:6px">EUROVIX App · demo v2.0 (WERK OS) · ${EVX.CONTACT.horario}</p>`;

    $('#logoutBtn').addEventListener('click', logout);
    $$('.prow[data-vehicle]').forEach(b => b.addEventListener('click', () => {
      state.vehicleIdx = +b.dataset.vehicle;
      toast('Veículo ativo', `${vehicle().modelo} agora é o principal.`, 'ok');
      renderAll();
    }));
    $$('.prow[data-cofre]').forEach(b => b.addEventListener('click', () => {
      toast('Cofre digital', `"${b.dataset.cofre}" abre como PDF na versão integrada (storage por VIN).`, 'ok');
    }));
    $$('.prow[data-veic3d]').forEach(b => b.addEventListener('click', () => {
      open3dModal(garagem()[+b.dataset.veic3d]);
    }));
  }

  /* ============================================================
     Notificações
     ============================================================ */
  function renderNotifs() {
    const list = EVX.getNotifications();
    $('#notifPip').classList.toggle('show', list.some(n => !n.lida));
    $('#notifList').innerHTML = list.length ? list.map(n => `
      <div class="notif ${n.tipo || ''} ${n.lida ? '' : 'unread'}">
        <span class="n-ico">${EVX.icon(n.tipo === 'ok' ? 'check' : n.tipo === 'agenda' ? 'calendar' : 'bell', 17)}</span>
        <div><b>${n.titulo}</b><p>${n.texto}</p><time>${timeAgo(n.quando)}</time></div>
      </div>`).join('') : `<p style="color:var(--txt-3);font-size:13px;text-align:center;padding:30px 0">Sem notificações.</p>`;
  }
  $('#notifBtn').addEventListener('click', () => {
    renderNotifs();
    $('#notifDrawer').classList.add('open');
    EVX.markNotificationsRead();
    setTimeout(() => $('#notifPip').classList.remove('show'), 400);
  });
  $('#notifClose').addEventListener('click', () => $('#notifDrawer').classList.remove('open'));
  $('#notifDrawer').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('#notifDrawer').classList.remove('open'); });

  /* ============================================================
     Navegação
     ============================================================ */
  function switchTab(tab) {
    state.tab = tab;
    if (tab !== 'os') state.osOpen = null;
    $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === tab));
    renderTab(tab);
  }
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  function bindCommon(root) {
    $$('[data-goto]', root).forEach(el => el.addEventListener('click', () => switchTab(el.dataset.goto)));
    $$('.os-card', root).forEach(el => {
      const open = () => { state.osOpen = +el.dataset.os; switchTab('os'); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  // Rede de segurança: um erro de render NUNCA pode deixar a tela em branco.
  // Em vez de sumir tudo, mostramos um cartão de recuperação com Recarregar/Sair.
  function renderFalha(host, tab, err) {
    try { console.error('EUROVIX · falha ao renderizar a aba "' + tab + '":', err); } catch (_) {}
    const det = (err && (err.message || String(err))) || 'erro desconhecido';
    host.innerHTML = `
      <div class="empty-state">
        ${EVX.icon('alert', 40)}
        <p>Não foi possível carregar esta tela agora.<br>Tente recarregar — seus dados estão seguros.</p>
        <button class="btn btn-primary" id="recuperarBtn">Recarregar</button>
        <button class="btn btn-secondary" id="sairFalhaBtn" style="margin-top:10px">Sair da conta</button>
        <p style="margin-top:14px;font-size:10.5px;color:var(--ink-3);word-break:break-word">detalhe técnico: ${String(det).slice(0, 160).replace(/[<>]/g, '')}</p>
      </div>`;
    const rb = host.querySelector('#recuperarBtn'); if (rb) rb.addEventListener('click', () => location.reload());
    const sb = host.querySelector('#sairFalhaBtn'); if (sb) sb.addEventListener('click', logout);
  }
  function renderTab(tab) {
    const host = $(`[data-view="${tab}"]`);
    try {
      if (tab === 'inicio') renderInicio();
      else if (tab === 'servicos') renderServicos();
      else if (tab === 'os') renderOS();
      else if (tab === 'agenda') renderAgenda();
      else if (tab === 'perfil') renderPerfil();
    } catch (err) {
      if (host) renderFalha(host, tab, err);
    }
  }

  function renderAll() {
    if (!state.user) return;
    renderTab(state.tab); // já é à prova de erro (try/catch interno)
    try { renderNotifs(); } catch (e) { console.error('renderNotifs falhou', e); }
    try { $('#osPip').classList.toggle('show', osAtivas().some(o => osStateCls(o) === 'approve')); }
    catch (e) { console.error('osPip falhou', e); }
  }

  /* ============================================================
     Tempo real entre abas: painel WERK OS ⇄ app
     (storage event dispara quando a oficina atualiza a OS)
     ============================================================ */
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('evx.')) renderAll();
  });
  window.addEventListener('evx:sync', () => renderAll()); // realtime da nuvem

  /* Demonstração viva: micro-update do box a cada 40s na OS em execução (só no modo demo) */
  let beats = 0;
  setInterval(() => {
    if (WERK.cloud) return;
    if (!state.user || beats >= 2) return;
    const emExec = myOS().find(o => o.status === 'execucao');
    if (!emExec) return;
    beats++;
    const updates = [
      '📷 Comparativo postado: peça antiga vs. nova — confira nas fotos da OS.',
      '🎥 Vídeo de 15s do técnico explicando o serviço disponível na timeline.',
    ];
    WERK.updateOS(emExec.numero, () => {}, { tipo: 'update', titulo: 'Micro-update do técnico', desc: updates[beats - 1], ator: emExec.tecnico });
    EVX.pushNotification({ titulo: `OS #${emExec.numero} — update do box`, texto: updates[beats - 1], quando: Date.now(), tipo: 'os' });
    toast('Update do box 📷', updates[beats - 1], 'ok');
    renderAll();
  }, 40000);
})();
