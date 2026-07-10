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

  const DEMO_CLIENTE = 'Ricardo Almeida';

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
    if (!/^\S+@\S+\.\S+$/.test(email) || senha.length < 4) { err.classList.add('show'); return; }
    err.classList.remove('show');
    const isDemo = email.toLowerCase() === EVX.DEMO_USER.email;
    const nome = isDemo ? EVX.DEMO_USER.nome
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
      EVX.pushNotification({ titulo: 'Bem-vindo ao app EUROVIX!', texto: 'Acompanhe seu BMW, aprove orçamentos item a item e fale com seu consultor por aqui.', quando: Date.now(), tipo: 'ok' });
      EVX.pushNotification({ titulo: 'OS #1258 aguarda sua aprovação', texto: 'O orçamento da revisão + bieletas está pronto — aprove pelo app.', quando: Date.now(), tipo: 'os' });
    }
    renderAll();
  }

  function logout() { EVX.clearSession(); location.reload(); }

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
  const vehicle = () => EVX.VEHICLES[state.vehicleIdx];

  /* OS do cliente logado (demo enxerga o dataset do Ricardo) */
  function myOS() {
    const nomes = [state.user.nome];
    if (state.user.email === EVX.DEMO_USER.email) nomes.push(DEMO_CLIENTE);
    return WERK.getAllOS().filter(o => nomes.includes(o.cliente));
  }
  const osAtivas = () => myOS().filter(o => o.status !== 'entregue');
  const osConcluidas = () => myOS().filter(o => o.status === 'entregue');

  function osStateCls(o) {
    if (o.status === 'entregue' || o.status === 'pronto') return 'done';
    if (o.status === 'aprovacao' && o.itens.some(i => i.aprovacao === 'pendente')) return 'approve';
    return 'live';
  }
  function osBadge(o) {
    const st = WERK.STATUS[WERK.statusIdx(o.status)];
    if (o.status === 'entregue') return '<span class="os-badge done">Concluída</span>';
    const cls = osStateCls(o);
    if (cls === 'approve') return '<span class="os-badge approve">Aprovar orçamento</span>';
    return `<span class="os-badge ${cls === 'done' ? 'done' : 'live'}">${st ? st.cliente : o.status}</span>`;
  }
  function osCardHTML(o) {
    return `
      <div class="os-card" data-os="${o.numero}" role="button" tabindex="0">
        <span class="os-dot ${osStateCls(o)}"></span>
        <div class="os-info">
          <b>OS #${o.numero} · ${o.itens[0] ? o.itens[0].titulo.slice(0, 34) : o.sintoma.slice(0, 34)}</b>
          <span>${o.veiculo} · ${o.placa}</span>
        </div>
        ${osBadge(o)}
      </div>`;
  }

  /* ============================================================
     Início
     ============================================================ */
  function renderInicio() {
    const v = vehicle();
    const pct = Math.min(100, Math.round((v.km / v.proxRevisao.km) * 100));
    const live = osAtivas();
    const pend = WERK.pendencias(state.user.email === EVX.DEMO_USER.email ? DEMO_CLIENTE : state.user.nome);
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
          </div>`).join('')}
      </div>

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

    $('#vcSwitch').addEventListener('click', () => {
      state.vehicleIdx = (state.vehicleIdx + 1) % EVX.VEHICLES.length;
      renderInicio();
      toast('Veículo alterado', `Mostrando ${vehicle().modelo} (${vehicle().placa}).`, 'ok');
    });
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
      ${osBadge(o)}

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
      WERK.chatSend(o.numero, o.cliente, t);
      renderOSDetail(view);
    });
    bindAprovacao(o, view);
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
        <button class="btn btn-primary" style="width:100%;margin-top:12px;padding:14px" id="apConfirm">Aprovar selecionados ✓</button>
      </div>`;
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
      let aprovadosN = 0, recusadosN = 0;
      WERK.updateOS(o.numero, os => {
        os.itens.forEach(i => {
          if (i.severidade === 'ok') return;
          const cb = $(`.ap-check[data-id="${i.id}"]`, box);
          const nv = ($(`input[name="nv-${i.id}"]:checked`, box) || {}).value || 'original';
          i.nivelEscolhido = nv;
          i.aprovacao = cb && cb.checked ? 'aprovado' : 'recusado';
          i.aprovacao === 'aprovado' ? aprovadosN++ : recusadosN++;
        });
        const hash = (s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); })(JSON.stringify(os.itens.map(i => [i.id, i.aprovacao, i.nivelEscolhido])));
        os.aceite = { assinatura: true, ip: '187.36.170.42 (app)', hash: `${hash}…${os.numero}`, ts: new Date().toISOString() };
        os.aprovadoEm = os.aceite.ts;
      }, { tipo: 'aceite', titulo: 'Orçamento aprovado pelo app', desc: `${aprovadosN} aprovado(s), ${recusadosN} adiado(s) — assinatura digital registrada.`, ator: o.cliente });
      WERK.setStatus(o.numero, 'execucao', 'Sistema', 'Itens aprovados liberados para o box.');
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
      WERK.updateOS(o.numero, os => { os.nps = +b.dataset.n; }, { tipo: 'update', titulo: `NPS ${b.dataset.n}/10`, desc: 'Avaliação do cliente registrada.', ator: o.cliente });
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

  /* ============================================================
     Perfil (garantias, cofre, veículos, sair)
     ============================================================ */
  function renderPerfil() {
    const u = state.user;
    const initials = u.nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
    const garantias = myOS().flatMap(o => o.itens.filter(i => i.garantia).map(i => ({ os: o.numero, item: i })));
    const cofres = WERK.getVehicles().filter(v => v.cliente === (u.email === EVX.DEMO_USER.email ? DEMO_CLIENTE : u.nome));

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

      <div class="sec-label">Meus veículos</div>
      <div class="plist">
        ${EVX.VEHICLES.map((v, i) => `
          <button class="prow" data-vehicle="${i}">
            ${EVX.icon('car', 20)}
            <div><b>${v.modelo} · ${v.ano}</b><span>${v.placa} · ${v.km.toLocaleString('pt-BR')} km</span></div>
            ${i === state.vehicleIdx ? '<span class="os-badge done" style="margin-left:auto">ativo</span>' : '<span class="chev">›</span>'}
          </button>`).join('')}
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

  function renderTab(tab) {
    if (tab === 'inicio') renderInicio();
    else if (tab === 'servicos') renderServicos();
    else if (tab === 'os') renderOS();
    else if (tab === 'agenda') renderAgenda();
    else if (tab === 'perfil') renderPerfil();
  }

  function renderAll() {
    if (!state.user) return;
    renderTab(state.tab);
    renderNotifs();
    $('#osPip').classList.toggle('show', osAtivas().some(o => osStateCls(o) === 'approve'));
  }

  /* ============================================================
     Tempo real entre abas: painel WERK OS ⇄ app
     (storage event dispara quando a oficina atualiza a OS)
     ============================================================ */
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('evx.')) renderAll();
  });

  /* Demonstração viva: micro-update do box a cada 40s na OS em execução */
  let beats = 0;
  setInterval(() => {
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
