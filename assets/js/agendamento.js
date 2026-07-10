/* ============================================================
   EUROVIX · Agendamento online — fluxo em 4 passos
   Veículo → Serviço → Data & Hora → Confirmação
   Persiste em localStorage (EVX) e gera link de WhatsApp.
   ============================================================ */

(function () {
  'use strict';

  const state = {
    step: 1,
    veiculo: { modelo: '', ano: '', placa: '', km: '' },
    servicoId: null,
    obs: '',
    data: null,        // { iso, label, dow }
    hora: null,
    contato: { nome: '', tel: '', email: '' },
  };

  const $ = (sel) => document.querySelector(sel);
  const steps = [...document.querySelectorAll('.bstep')];
  const psteps = [...document.querySelectorAll('.pstep')];
  const btnBack = $('#btnBack');
  const btnNext = $('#btnNext');

  /* ---------- Passo 1: anos ---------- */
  const anoSel = $('#f-ano');
  const nowYear = 2026;
  for (let y = nowYear; y >= 1998; y--) {
    const o = document.createElement('option');
    o.value = o.textContent = y;
    anoSel.appendChild(o);
  }

  /* ---------- Passo 2: serviços ---------- */
  const svcWrap = $('#svcOptions');
  svcWrap.innerHTML = EVX.SERVICES.map(s => `
    <div class="svc-option" data-id="${s.id}" role="button" tabindex="0" aria-pressed="false">
      <div class="ico-wrap">${EVX.icon(s.icon, 20)}</div>
      <div><b>${s.nome}</b><span>${s.tag}</span></div>
    </div>
  `).join('');
  function selectService(id) {
    state.servicoId = id;
    svcWrap.querySelectorAll('.svc-option').forEach(el => {
      const sel = el.dataset.id === id;
      el.classList.toggle('sel', sel);
      el.setAttribute('aria-pressed', String(sel));
    });
  }
  svcWrap.addEventListener('click', e => {
    const opt = e.target.closest('.svc-option');
    if (opt) selectService(opt.dataset.id);
  });
  svcWrap.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const opt = e.target.closest('.svc-option');
      if (opt) { e.preventDefault(); selectService(opt.dataset.id); }
    }
  });
  // pré-seleção via ?servico=id (links dos cards do site)
  const preSvc = new URLSearchParams(location.search).get('servico');
  if (preSvc && EVX.SERVICES.some(s => s.id === preSvc)) selectService(preSvc);

  /* ---------- Passo 3: datas (próximos 10 dias úteis + sábados) ---------- */
  const DOW = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const dateGrid = $('#dateGrid');
  const slotGrid = $('#slotGrid');

  const days = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  while (days.length < 10) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow === 0) continue; // domingo fechado
    days.push({
      iso: cursor.toISOString().slice(0, 10),
      day: cursor.getDate(),
      dow,
      dowLabel: DOW[dow],
      label: `${String(cursor.getDate()).padStart(2, '0')}/${MON[cursor.getMonth()]}`,
    });
  }
  dateGrid.innerHTML = days.map((d, i) => `
    <div class="date-cell" data-i="${i}" role="button" tabindex="0">
      <div class="dow">${d.dowLabel}</div>
      <div class="day">${String(d.day).padStart(2, '0')}</div>
      <div class="mon">${d.label.split('/')[1]}</div>
    </div>
  `).join('');

  function renderSlots() {
    if (!state.data) {
      slotGrid.innerHTML = `<p style="grid-column:1/-1;color:var(--txt-3);font-size:13px">Escolha primeiro uma data.</p>`;
      return;
    }
    // sábado: só manhã; alguns horários "ocupados" determinísticos p/ realismo
    const isSat = state.data.dow === 6;
    const busy = (state.data.day % 3 === 0) ? ['09:00', '14:30'] : (state.data.day % 2 === 0) ? ['10:00'] : ['08:00', '15:30'];
    slotGrid.innerHTML = EVX.SLOTS.map(h => {
      const off = (isSat && h >= '12:00') || busy.includes(h);
      return `<div class="slot ${off ? 'off' : ''} ${state.hora === h ? 'sel' : ''}" data-h="${h}" ${off ? '' : 'role="button" tabindex="0"'}>${h}</div>`;
    }).join('');
  }
  dateGrid.addEventListener('click', e => {
    const cell = e.target.closest('.date-cell');
    if (!cell) return;
    state.data = days[+cell.dataset.i];
    state.hora = null;
    dateGrid.querySelectorAll('.date-cell').forEach(c => c.classList.toggle('sel', c === cell));
    renderSlots();
  });
  slotGrid.addEventListener('click', e => {
    const slot = e.target.closest('.slot');
    if (!slot || slot.classList.contains('off')) return;
    state.hora = slot.dataset.h;
    slotGrid.querySelectorAll('.slot').forEach(s => s.classList.toggle('sel', s === slot));
  });
  [dateGrid, slotGrid].forEach(grid => grid.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); }
  }));
  renderSlots();

  /* ---------- Máscaras leves ---------- */
  $('#f-km').addEventListener('input', e => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 7);
    e.target.value = digits ? Number(digits).toLocaleString('pt-BR') : '';
  });
  $('#f-tel').addEventListener('input', e => {
    let d = e.target.value.replace(/\D/g, '').slice(0, 11);
    if (d.length > 6) e.target.value = `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    else if (d.length > 2) e.target.value = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    else e.target.value = d;
  });

  /* ---------- Validação por passo ---------- */
  function setInvalid(input, invalid, msg) {
    const field = input.closest('.field');
    field.classList.toggle('invalid', invalid);
    if (msg) field.querySelector('.err').textContent = msg;
    return !invalid;
  }
  function validateStep() {
    if (state.step === 1) {
      const okModelo = setInvalid($('#f-modelo'), !$('#f-modelo').value.trim());
      const okAno = setInvalid($('#f-ano'), !$('#f-ano').value);
      return okModelo && okAno;
    }
    if (state.step === 2) {
      if (!state.servicoId) {
        svcWrap.style.outline = '2px solid var(--red)';
        svcWrap.style.outlineOffset = '6px';
        setTimeout(() => { svcWrap.style.outline = ''; }, 1600);
        return false;
      }
      return true;
    }
    if (state.step === 3) {
      if (!state.data || !state.hora) {
        (state.data ? slotGrid : dateGrid).style.outline = '2px solid var(--red)';
        setTimeout(() => { dateGrid.style.outline = ''; slotGrid.style.outline = ''; }, 1600);
        return false;
      }
      return true;
    }
    if (state.step === 4) {
      const nome = $('#f-nome'), tel = $('#f-tel'), email = $('#f-email');
      const okNome = setInvalid(nome, nome.value.trim().length < 3);
      const okTel = setInvalid(tel, tel.value.replace(/\D/g, '').length < 10);
      const okEmail = setInvalid(email, !!email.value && !/^\S+@\S+\.\S+$/.test(email.value));
      return okNome && okTel && okEmail;
    }
    return true;
  }

  /* ---------- Resumo (passo 4) ---------- */
  function renderSummary() {
    const svc = EVX.SERVICES.find(s => s.id === state.servicoId);
    state.veiculo = {
      modelo: $('#f-modelo').value.trim(),
      ano: $('#f-ano').value,
      placa: $('#f-placa').value.trim().toUpperCase(),
      km: $('#f-km').value,
    };
    state.obs = $('#f-obs').value.trim();
    $('#summary').innerHTML = `
      <div class="row"><span class="k">Veículo</span><span class="v">BMW ${state.veiculo.modelo} · ${state.veiculo.ano}${state.veiculo.placa ? ' · ' + state.veiculo.placa : ''}</span></div>
      <div class="row"><span class="k">Serviço</span><span class="v">${svc.nome} — ${svc.tag}</span></div>
      ${state.obs ? `<div class="row"><span class="k">Observação</span><span class="v">${state.obs.slice(0, 140)}</span></div>` : ''}
      <div class="row"><span class="k">Data</span><span class="v">${state.data.dowLabel} · ${state.data.label} às ${state.hora}</span></div>
      <div class="row"><span class="k">Duração típica</span><span class="v">${svc.duracao}</span></div>
      <div class="row"><span class="k">Local</span><span class="v">${EVX.CONTACT.endereco}</span></div>
    `;
  }

  /* ---------- Navegação entre passos ---------- */
  function show(step) {
    state.step = step;
    steps.forEach(s => { s.hidden = +s.dataset.step !== step; });
    psteps.forEach((p, i) => {
      p.classList.toggle('on', i + 1 === step);
      p.classList.toggle('done', i + 1 < step);
    });
    btnBack.disabled = step === 1;
    btnNext.textContent = step === 4 ? 'Confirmar agendamento ✓' : 'Continuar →';
    document.getElementById('bookingNav').style.display = step === 5 ? 'none' : 'flex';
    document.getElementById('progress').style.display = step === 5 ? 'none' : 'grid';
    if (step === 4) renderSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function confirm() {
    const svc = EVX.SERVICES.find(s => s.id === state.servicoId);
    state.contato = {
      nome: $('#f-nome').value.trim(),
      tel: $('#f-tel').value,
      email: $('#f-email').value.trim(),
    };
    const appt = {
      protocolo: EVX.protocolo(),
      criado: new Date().toISOString(),
      status: 'confirmado',
      servicoId: svc.id,
      servicoNome: svc.nome,
      veiculo: `BMW ${state.veiculo.modelo} ${state.veiculo.ano}`,
      placa: state.veiculo.placa,
      km: state.veiculo.km,
      obs: state.obs,
      dataISO: state.data.iso,
      dataLabel: `${state.data.dowLabel} ${state.data.label}`,
      hora: state.hora,
      contato: state.contato,
    };
    EVX.saveAppointment(appt);

    $('#protoBox').textContent = appt.protocolo;
    // DM do Instagram não aceita texto pré-preenchido — o protocolo fica visível p/ copiar
    $('#whatsLink').href = EVX.CONTACT.dm;
    show(5);
  }

  btnNext.addEventListener('click', () => {
    if (!validateStep()) return;
    if (state.step === 4) confirm();
    else show(state.step + 1);
  });
  btnBack.addEventListener('click', () => show(Math.max(1, state.step - 1)));

  show(1);
})();
