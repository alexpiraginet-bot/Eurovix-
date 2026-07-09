/* ============================================================
   EUROVIX · App do Cliente — SPA
   Splash → Login → Shell com 5 abas.
   A OS em andamento evolui em tempo real (simulação local):
   Diagnóstico → Aguardando aprovação → Execução → Testes → Pronto.
   ============================================================ */

(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];

  const state = {
    user: null,
    vehicleIdx: 0,
    orders: EVX.getOrders(),
    tab: 'inicio',
    osOpen: null,          // id da OS aberta em detalhe
    liveTimer: null,
  };

  const LIVE_OS_ID = 1257;
  const TICK_MS = 20000;   // avanço da OS ao vivo a cada 20s

  /* ============================================================
     Boot: splash → sessão → login/app
     ============================================================ */
  const splash = $('#splash');
  const loginView = $('#loginView');

  setTimeout(() => {
    splash.classList.add('hide');
    const session = EVX.getSession();
    if (session) enter(session);
    else loginView.classList.remove('hide');
  }, 1400);

  /* ============================================================
     Login
     ============================================================ */
  $('#demoBtn').addEventListener('click', () => {
    $('#l-email').value = EVX.DEMO_USER.email;
    $('#l-senha').value = 'bmw2026';
    doLogin(EVX.DEMO_USER.email, 'bmw2026');
  });

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin($('#l-email').value.trim(), $('#l-senha').value);
  });

  $('#forgotLink').addEventListener('click', (e) => {
    e.preventDefault();
    toast('Recuperação de senha', 'No app final, você recebe um link por e-mail. Na demo, use a conta demo. 😉', 'ok');
  });

  function doLogin(email, senha) {
    const err = $('#loginErr');
    const validEmail = /^\S+@\S+\.\S+$/.test(email);
    if (!validEmail || senha.length < 4) {
      err.classList.add('show');
      return;
    }
    err.classList.remove('show');
    const isDemo = email.toLowerCase() === EVX.DEMO_USER.email;
    const nome = isDemo
      ? EVX.DEMO_USER.nome
      : email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const session = { nome, email, desde: isDemo ? EVX.DEMO_USER.cliente_desde : 2026 };
    if ($('#l-lembrar').checked) EVX.setSession(session);
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
      EVX.pushNotification({
        titulo: 'Bem-vindo ao app EUROVIX!',
        texto: 'Acompanhe seu BMW, aprove orçamentos e agende serviços por aqui.',
        quando: Date.now(), tipo: 'ok',
      });
      EVX.pushNotification({
        titulo: 'OS #1257 em andamento',
        texto: 'Sua Revisão Preventiva está na etapa de diagnóstico.',
        quando: Date.now(), tipo: 'os',
      });
    }
    renderAll();
    startLive();
  }

  function logout() {
    EVX.clearSession();
    location.reload();
  }

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
    const diff = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (diff < 60) return `há ${diff} min`;
    const h = Math.round(diff / 60);
    if (h < 24) return `há ${h} h`;
    return `há ${Math.round(h / 24)} d`;
  }

  function fmtData(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function vehicle() { return EVX.VEHICLES[state.vehicleIdx]; }

  function saveOrders() { EVX.saveOrders(state.orders); }

  function liveOrder() { return state.orders.find(o => o.id === LIVE_OS_ID); }

  function osState(o) {
    if (o.status === 'concluida') return 'done';
    return EVX.OS_STAGES[o.etapa].id === 'orcamento' && !o.aprovado ? 'approve' : 'live';
  }
  function osBadge(o) {
    const st = osState(o);
    if (st === 'done') return '<span class="os-badge done">Concluída</span>';
    if (st === 'approve') return '<span class="os-badge approve">Aprovar orçamento</span>';
    return `<span class="os-badge live">${EVX.OS_STAGES[o.etapa].nome}</span>`;
  }

  /* ============================================================
     Render — Início
     ============================================================ */
  function renderInicio() {
    const v = vehicle();
    const pct = Math.min(100, Math.round((v.km / v.proxRevisao.km) * 100));
    const live = state.orders.filter(o => o.status !== 'concluida');
    const healthClass = (n) => n >= 75 ? 'g' : n >= 50 ? 'w' : 'd';
    const healthLabel = { oleo: 'Óleo', freios: 'Freios', pneus: 'Pneus', bateria: 'Bateria' };

    $('[data-view="inicio"]').innerHTML = `
      <div class="vehicle-card">
        <div class="vc-top">
          <div>
            <div class="mod">${v.modelo}</div>
            <div class="sub">${v.ano} · ${v.cor} · ${v.placa}</div>
          </div>
          <button class="vc-switch" id="vcSwitch">Trocar ⇄</button>
        </div>
        <div class="vc-km"><span class="v">${v.km.toLocaleString('pt-BR')} km</span><span class="k">odômetro</span></div>
        <div class="vc-bar"><i style="width:${pct}%"></i></div>
        <div class="vc-next">Próxima manutenção em <b>${v.proxRevisao.restante.toLocaleString('pt-BR')} km</b> — ${v.proxRevisao.titulo}</div>
        <div class="vc-cta">
          <a class="btn btn-primary" href="agendamento.html">Agendar</a>
          <button class="btn btn-secondary" data-goto="os">Minhas OS</button>
        </div>
      </div>

      <div class="sec-label">Saúde do veículo</div>
      <div class="health-grid">
        ${Object.entries(v.saude).map(([k, n]) => `
          <div class="hcard ${healthClass(n)}">
            <div class="hk"><span>${healthLabel[k]}</span><b>${n}%</b></div>
            <div class="hbar"><i style="width:${n}%"></i></div>
          </div>
        `).join('')}
      </div>

      <div class="sec-label">Ações rápidas</div>
      <div class="quick-grid">
        <a class="qbtn" href="agendamento.html">${EVX.icon('calendar', 19)}Agendar</a>
        <button class="qbtn" data-goto="servicos">${EVX.icon('scan', 19)}Serviços</button>
        <button class="qbtn" data-goto="os">${EVX.icon('doc', 19)}Histórico</button>
        <a class="qbtn" href="https://wa.me/${EVX.CONTACT.whatsapp}?text=${encodeURIComponent('Olá! Estou no app EUROVIX e preciso de ajuda.')}" target="_blank" rel="noopener">${EVX.icon('whats', 19)}Suporte</a>
      </div>

      ${live.length ? `<div class="sec-label">Em andamento <a data-goto="os">ver tudo</a></div>` : ''}
      ${live.map(o => osCardHTML(o)).join('')}
    `;

    $('#vcSwitch').addEventListener('click', () => {
      state.vehicleIdx = (state.vehicleIdx + 1) % EVX.VEHICLES.length;
      renderInicio();
      toast('Veículo alterado', `Mostrando ${vehicle().modelo} (${vehicle().placa}).`, 'ok');
    });
    bindCommon($('[data-view="inicio"]'));
  }

  /* ============================================================
     Render — Serviços
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
          </a>
        `).join('')}
      </div>
      <div class="acard" style="margin-top:16px;display:flex;gap:13px;align-items:center">
        ${EVX.icon('shield', 26)}
        <div style="flex:1">
          <b style="font-family:var(--font-display);font-size:13px">Garantia EUROVIX</b>
          <p style="font-size:11.5px;color:var(--txt-2);margin-top:2px">12 meses em peças e mão de obra, registrada automaticamente na sua conta.</p>
        </div>
      </div>
    `;
  }

  /* ============================================================
     Render — OS (lista + detalhe)
     ============================================================ */
  function osCardHTML(o) {
    const st = osState(o);
    return `
      <div class="os-card" data-os="${o.id}" role="button" tabindex="0">
        <span class="os-dot ${st}"></span>
        <div class="os-info">
          <b>OS #${o.id} · ${o.servico}</b>
          <span>${o.veiculo}</span>
        </div>
        ${osBadge(o)}
      </div>
    `;
  }

  function renderOS() {
    const view = $('[data-view="os"]');
    if (state.osOpen != null) { renderOSDetail(view); return; }
    const ativas = state.orders.filter(o => o.status !== 'concluida');
    const antigas = state.orders.filter(o => o.status === 'concluida');
    view.innerHTML = `
      <h2 class="vtitle">Ordens de Serviço</h2>
      <p class="vsub">Acompanhe cada etapa em tempo real.</p>
      ${ativas.length ? `<div class="sec-label">Em andamento</div>${ativas.map(osCardHTML).join('')}` : ''}
      ${antigas.length ? `<div class="sec-label">Concluídas</div>${antigas.map(osCardHTML).join('')}` : ''}
      ${!state.orders.length ? emptyHTML('doc', 'Nenhuma ordem de serviço ainda.', 'Agendar um serviço', 'agendamento.html') : ''}
    `;
    bindCommon(view);
  }

  function renderOSDetail(view) {
    const o = state.orders.find(x => x.id === state.osOpen);
    if (!o) { state.osOpen = null; renderOS(); return; }
    const stages = EVX.OS_STAGES;
    const needsApproval = o.status !== 'concluida' && stages[o.etapa].id === 'orcamento' && !o.aprovado;

    view.innerHTML = `
      <div class="os-detail-head">
        <button class="back-btn" id="osBack" aria-label="Voltar">${EVX.icon('back', 16)}</button>
        <div>
          <b>OS #${o.id} · ${o.servico}</b>
          <span>${o.veiculo} · aberta em ${fmtData(o.abertura)}</span>
        </div>
      </div>

      ${osBadge(o)}

      <div class="sec-label" style="margin-top:18px">Linha do tempo</div>
      <div class="acard">
        <div class="timeline">
          ${stages.map((s, i) => {
            const cls = i < o.etapa || o.status === 'concluida' ? 'done'
                      : i === o.etapa ? (needsApproval ? 'approve' : 'now') : '';
            return `
              <div class="tl-item ${cls}">
                <span class="tl-dot">${cls === 'done' ? '✓' : ''}</span>
                <b>${s.nome}</b>
                <p>${s.desc}</p>
                ${cls === 'now' || cls === 'approve' ? '<span class="tl-time">agora</span>' : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="sec-label">Orçamento</div>
      <div class="acard budget">
        ${o.orcamento.itens.map(i => `<div class="b-item"><span>${i.nome}</span><span>${EVX.brl(i.valor)}</span></div>`).join('')}
        <div class="b-total"><span>Total</span><span>${EVX.brl(o.orcamento.total)}</span></div>
        ${o.aprovado || o.status === 'concluida'
          ? `<p style="font-size:11.5px;color:var(--ok);margin-top:10px">✓ Orçamento aprovado${o.aprovadoEm ? ' em ' + fmtData(o.aprovadoEm) : ''} — nada é cobrado além disso.</p>`
          : ''}
      </div>

      ${needsApproval ? `
        <div class="approve-box">
          <b style="font-family:var(--font-display)">Seu OK para continuar.</b><br>
          O serviço só entra no box depois da sua aprovação. Recuse itens pelo WhatsApp se preferir ajustar.
          <button class="btn btn-primary" id="approveBtn">Aprovar orçamento · ${EVX.brl(o.orcamento.total)}</button>
        </div>` : ''}

      <div class="acard" style="margin-top:12px;display:flex;gap:12px;align-items:center">
        ${EVX.icon('user', 22)}
        <div style="flex:1">
          <b style="font-family:var(--font-display);font-size:12.5px">${o.consultor}</b>
          <p style="font-size:11px;color:var(--txt-2)">Dúvidas sobre esta OS? Fale direto com seu consultor.</p>
        </div>
        <a class="hbtn" href="https://wa.me/${EVX.CONTACT.whatsapp}?text=${encodeURIComponent('Olá! Tenho uma dúvida sobre a OS #' + o.id + '.')}" target="_blank" rel="noopener" aria-label="WhatsApp">${EVX.icon('whats', 17)}</a>
      </div>
      ${o.entrega ? `<p style="font-size:11px;color:var(--txt-3);text-align:center;margin-top:8px">Entregue em ${fmtData(o.entrega)} · Garantia até ${fmtData(new Date(new Date(o.entrega).setFullYear(new Date(o.entrega).getFullYear() + 1)).toISOString())}</p>` : ''}
    `;

    $('#osBack').addEventListener('click', () => { state.osOpen = null; renderOS(); });
    const ap = $('#approveBtn');
    if (ap) ap.addEventListener('click', () => approveOrder(o.id));
  }

  function approveOrder(id) {
    const o = state.orders.find(x => x.id === id);
    if (!o) return;
    o.aprovado = true;
    o.aprovadoEm = new Date().toISOString();
    o.etapa = Math.min(o.etapa + 1, EVX.OS_STAGES.length - 1);
    saveOrders();
    EVX.pushNotification({
      titulo: `OS #${o.id} — orçamento aprovado`,
      texto: `Serviço liberado para execução. Total: ${EVX.brl(o.orcamento.total)}.`,
      quando: Date.now(), tipo: 'ok',
    });
    toast('Orçamento aprovado ✓', 'Seu BMW já está entrando no box.', 'ok');
    renderAll();
  }

  /* ============================================================
     Render — Agenda
     ============================================================ */
  function renderAgenda() {
    const appts = EVX.getAppointments();
    const view = $('[data-view="agenda"]');
    view.innerHTML = `
      <h2 class="vtitle">Agenda</h2>
      <p class="vsub">Seus agendamentos na EUROVIX.</p>
      ${appts.length ? appts.map(a => `
        <div class="appt-card">
          <div class="appt-date"><b>${a.dataLabel.match(/\d+/) ? a.dataLabel.match(/\d+/)[0].padStart(2, '0') : '—'}</b><span>${(a.dataLabel.split(' ')[1] || '').split('/')[1] || a.dataLabel.split(' ')[0]}</span></div>
          <div class="appt-info">
            <b>${a.servicoNome}</b>
            <span>${a.veiculo}${a.placa ? ' · ' + a.placa : ''} · ${a.hora}</span>
            <span class="appt-proto">Protocolo ${a.protocolo}</span>
          </div>
          ${EVX.icon('check', 18, '')}
        </div>
      `).join('') : emptyHTML('calendar', 'Nenhum agendamento por aqui ainda.', 'Agendar meu primeiro serviço', 'agendamento.html')}
      <a class="btn btn-secondary" style="width:100%;margin-top:10px" href="agendamento.html">+ Novo agendamento</a>
    `;
  }

  function emptyHTML(icon, msg, cta, href) {
    return `
      <div class="empty-state">
        ${EVX.icon(icon, 40)}
        <p>${msg}</p>
        ${cta ? `<a class="btn btn-primary" href="${href}">${cta}</a>` : ''}
      </div>
    `;
  }

  /* ============================================================
     Render — Perfil
     ============================================================ */
  function renderPerfil() {
    const u = state.user;
    const initials = u.nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
    $('[data-view="perfil"]').innerHTML = `
      <h2 class="vtitle">Perfil</h2>
      <div class="profile-head">
        <span class="profile-avatar">${initials}</span>
        <div>
          <b>${u.nome}</b>
          <span>${u.email}</span><br>
          <span style="color:var(--red);font-family:var(--font-display);font-weight:700;font-size:10.5px;letter-spacing:.08em">CLIENTE DESDE ${u.desde}</span>
        </div>
      </div>

      <div class="sec-label">Meus veículos</div>
      <div class="plist">
        ${EVX.VEHICLES.map((v, i) => `
          <button class="prow" data-vehicle="${i}">
            ${EVX.icon('car', 20)}
            <div><b>${v.modelo} · ${v.ano}</b><span>${v.placa} · ${v.km.toLocaleString('pt-BR')} km</span></div>
            ${i === state.vehicleIdx ? '<span class="os-badge done" style="margin-left:auto">ativo</span>' : '<span class="chev">›</span>'}
          </button>
        `).join('')}
      </div>

      <div class="sec-label">Conta</div>
      <div class="plist">
        <button class="prow" data-action="dados">${EVX.icon('user', 20)}<div><b>Meus dados</b><span>${u.telefone || EVX.DEMO_USER.telefone} · atualizar contato</span></div><span class="chev">›</span></button>
        <button class="prow" data-action="garantias">${EVX.icon('shield', 20)}<div><b>Garantias ativas</b><span>Serviços cobertos por 12 meses</span></div><span class="chev">›</span></button>
        <a class="prow" href="index.html">${EVX.icon('home', 20)}<div><b>Site EUROVIX</b><span>Conhecer serviços e a oficina</span></div><span class="chev">›</span></a>
        <a class="prow" href="apresentacao.html">${EVX.icon('doc', 20)}<div><b>Apresentação da marca</b><span>Identidade & ecossistema digital</span></div><span class="chev">›</span></a>
      </div>

      <div class="plist">
        <button class="prow danger" id="logoutBtn">${EVX.icon('logout', 20)}<div><b>Sair da conta</b><span>Encerrar sessão neste aparelho</span></div></button>
      </div>
      <p style="text-align:center;font-size:10.5px;color:var(--txt-3);margin-top:6px">EUROVIX App · demo v1.0 · ${EVX.CONTACT.horario}</p>
    `;

    $('#logoutBtn').addEventListener('click', logout);
    $$('.prow[data-vehicle]').forEach(b => b.addEventListener('click', () => {
      state.vehicleIdx = +b.dataset.vehicle;
      toast('Veículo ativo', `${vehicle().modelo} agora é o veículo principal.`, 'ok');
      renderAll();
    }));
    $$('.prow[data-action]').forEach(b => b.addEventListener('click', () => {
      toast('Em breve', 'Esta área faz parte do MVP da Fase 3.', 'ok');
    }));
  }

  /* ============================================================
     Notificações
     ============================================================ */
  function renderNotifs() {
    const list = EVX.getNotifications();
    const unread = list.some(n => !n.lida);
    $('#notifPip').classList.toggle('show', unread);
    $('#notifList').innerHTML = list.length ? list.map(n => `
      <div class="notif ${n.tipo || ''} ${n.lida ? '' : 'unread'}">
        <span class="n-ico">${EVX.icon(n.tipo === 'ok' ? 'check' : n.tipo === 'agenda' ? 'calendar' : 'bell', 17)}</span>
        <div><b>${n.titulo}</b><p>${n.texto}</p><time>${timeAgo(n.quando)}</time></div>
      </div>
    `).join('') : `<p style="color:var(--txt-3);font-size:13px;text-align:center;padding:30px 0">Sem notificações.</p>`;
  }

  $('#notifBtn').addEventListener('click', () => {
    renderNotifs();
    $('#notifDrawer').classList.add('open');
    EVX.markNotificationsRead();
    setTimeout(() => $('#notifPip').classList.remove('show'), 400);
  });
  $('#notifClose').addEventListener('click', () => $('#notifDrawer').classList.remove('open'));
  $('#notifDrawer').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#notifDrawer').classList.remove('open');
  });

  /* ============================================================
     Navegação por abas
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

  function renderTab(tab) {
    if (tab === 'inicio') renderInicio();
    else if (tab === 'servicos') renderServicos();
    else if (tab === 'os') renderOS();
    else if (tab === 'agenda') renderAgenda();
    else if (tab === 'perfil') renderPerfil();
  }

  function renderAll() {
    renderTab(state.tab);
    renderNotifs();
    const live = liveOrder();
    $('#osPip').classList.toggle('show',
      !!live && live.status !== 'concluida' && EVX.OS_STAGES[live.etapa].id === 'orcamento' && !live.aprovado);
  }

  /* ============================================================
     Simulação ao vivo da OS #1257
     ============================================================ */
  function startLive() {
    if (state.liveTimer) clearInterval(state.liveTimer);
    state.liveTimer = setInterval(() => {
      const o = liveOrder();
      if (!o || o.status === 'concluida') { clearInterval(state.liveTimer); return; }
      const stage = EVX.OS_STAGES[o.etapa];

      // Trava na aprovação: só o cliente destrava
      if (stage.id === 'orcamento' && !o.aprovado) return;

      if (o.etapa < EVX.OS_STAGES.length - 1) {
        o.etapa += 1;
        const nova = EVX.OS_STAGES[o.etapa];
        const needsOk = nova.id === 'orcamento' && !o.aprovado;

        if (nova.id === 'pronto') {
          o.status = 'concluida';
          o.entrega = new Date().toISOString();
          EVX.pushNotification({
            titulo: `OS #${o.id} — veículo pronto! 🏁`,
            texto: 'Seu BMW está lavado e liberado para retirada.',
            quando: Date.now(), tipo: 'ok',
          });
          toast('Veículo pronto! 🏁', 'OS #' + o.id + ' concluída — pode vir buscar.', 'ok');
          clearInterval(state.liveTimer);
        } else {
          EVX.pushNotification({
            titulo: `OS #${o.id} — ${nova.nome}`,
            texto: nova.desc,
            quando: Date.now(), tipo: needsOk ? 'os' : 'os',
          });
          toast(needsOk ? 'Orçamento disponível' : 'Status atualizado', `OS #${o.id}: ${nova.nome}`, needsOk ? '' : 'ok');
        }
        saveOrders();
        renderAll();
      }
    }, TICK_MS);
  }
})();
