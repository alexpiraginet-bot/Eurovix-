/* ============================================================
   EUROVIX · WERK CLOUD — adaptador Supabase da camada de dados
   ------------------------------------------------------------
   Carregado DEPOIS de assets/js/env.js, assets/js/werk-data.js
   e do UMD assets/vendor/supabase.js. Com EVX_ENV preenchido,
   substitui o global WERK por um adaptador com A MESMA interface
   do módulo local:
   · leituras síncronas sobre um espelho em memória hidratado do
     Postgres (ordens, veiculos, clientes, config);
   · escritas otimistas: espelho primeiro (retorno síncrono igual
     ao local) + push assíncrono com guarda de versão — conflito
     ⇒ refetch + reaplicação do mutator 1x;
   · realtime (postgres_changes, UM canal) mantém o espelho vivo;
   · o espelho é persistido nas MESMAS chaves localStorage do modo
     demo (WERK.KEYS) e cada mudança dispara o evento 'evx:sync';
   · helpers puros (VIN, peças, Pix, formatos, telefone/placa…)
     são DELEGADOS ao módulo local — nunca reimplementados.
   Sem EVX_ENV ⇒ este arquivo não faz nada (modo demonstração).
   ============================================================ */
(() => {
  'use strict';

  /* ---------- 0 · Pré-condições ---------- */
  const ENV = (typeof window !== 'undefined' && window.EVX_ENV) || {};
  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_ANON_KEY) return; // modo demo intocado

  if (typeof WERK === 'undefined' || !WERK || !WERK.KEYS) {
    console.warn('[EVX cloud] werk-data.js não carregou antes de werk-cloud.js — adaptador desativado.');
    return;
  }
  if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
    console.warn('[EVX cloud] assets/vendor/supabase.js ausente — seguindo em modo demo.');
    return;
  }

  const local = WERK;   // módulo local: fonte única dos helpers puros
  const K = local.KEYS;
  const sb = supabase.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY); // sessão auth persistente (padrão)

  /* ============================================================
     1 · Utilitários
     ============================================================ */
  const warn = (ctx, e) => console.warn(`[EVX cloud] ${ctx}`, (e && e.message) || e || '');
  const clone = (x) => (x == null ? x : (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x))));
  const read = (k, fb) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch (e) { return fb; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { warn('cache localStorage', e); } };

  /* Erro de REDE (offline/timeout) ≠ erro de dados (RLS, validação, conflito) */
  const isNetErr = (e) => {
    if (!e) return false;
    if (e.name === 'AuthRetryableFetchError') return true;
    if (e.code) return false; // PostgREST respondeu → a rede está viva
    return /fetch|network|failed|timeout|abort|conex/i.test(String(e.message || e));
  };

  /* evx:sync coalescido num timeout — evita re-render reentrante na UI */
  let online = true;
  let pingAgendado = false;
  const ping = () => {
    if (pingAgendado) return;
    pingAgendado = true;
    setTimeout(() => {
      pingAgendado = false;
      try { window.dispatchEvent(new CustomEvent('evx:sync')); } catch (e) { /* noop */ }
    }, 0);
  };
  const setOnline = (v) => { if (online !== v) { online = v; ping(); } };
  const falha = (ctx, e) => { warn(ctx, e); if (isNetErr(e)) setOnline(false); };

  /* Fila de push serializada por chave (uma OS, um cliente…) —
     garante que retries de guarda de versão nunca corram em paralelo */
  const filas = Object.create(null);
  const enqueue = (chave, job) => {
    const prox = (filas[chave] || Promise.resolve()).then(job).catch((e) => falha(`fila ${chave}`, e));
    filas[chave] = prox;
    return prox;
  };

  /* ============================================================
     2 · Espelho em memória + cache (mesmas chaves do modo demo)
     ============================================================ */
  const mirror = {
    os: read(K.os, []),
    vehicles: read(K.vehicles, []),
    clients: read(K.clients, []),
    config: read(K.config, null),
  };
  let user = null;        // usuário Supabase Auth atual (síncrono p/ a UI)
  let isStaff = false;    // detectado na hidratação (linhas visíveis em `staff`)
  let meuPapel = null;    // papel do usuário atual na equipe (admin/gestor/…)
  let conviteBuf = null;  // resposta de convite_info p/ garagemDe na tela de cadastro

  const sortOS = () => mirror.os.sort((a, b) => new Date(b.criada) - new Date(a.criada)); // paridade com unshift local

  const persist = () => {
    write(K.os, mirror.os);
    write(K.vehicles, mirror.vehicles);
    write(K.clients, mirror.clients);
    if (mirror.config && typeof mirror.config === 'object') write(K.config, mirror.config);
  };
  const emit = () => { persist(); ping(); }; // após CADA mudança do espelho

  /* ============================================================
     3 · Mapeamento linha Postgres ⇄ shape do módulo local
     ============================================================ */
  const fromDbOrdem = (r) => ({
    numero: r.numero,
    criada: r.criada,
    status: r.status,
    vin: r.vin || '',
    veiculo: r.veiculo || '',
    placa: r.placa || '',
    cliente: r.cliente || '',
    telefone: r.telefone_norm || '',   // o banco guarda só o normalizado; normTel() aceita ambos
    sintoma: r.sintoma || '',
    tecnico: r.tecnico || '',
    consultor: r.consultor || '',
    checkin: r.checkin || null,
    dtcs: r.dtcs || [],
    itens: r.itens || [],
    qc: r.qc || null,
    pagamento: r.pagamento || null,
    nf: r.nf || null,
    nps: r.nps == null ? null : r.nps,
    aceite: r.aceite || null,
    aprovadoEm: r.aprovado_em || null,
    chat: r.chat || [],
    eventos: r.eventos || [],
    versao: r.versao || 0,             // guarda de concorrência (trigger incrementa)
  });
  const toDbUpdate = (os) => ({
    status: os.status,
    vin: os.vin || null,
    veiculo: os.veiculo || null,
    placa: os.placa || '',
    cliente: os.cliente || '',
    telefone_norm: local.normTel(os.telefone) || null,
    sintoma: os.sintoma || '',
    tecnico: os.tecnico || '',
    consultor: os.consultor || '',
    checkin: os.checkin == null ? null : os.checkin,
    dtcs: os.dtcs || [],
    itens: os.itens || [],
    qc: os.qc == null ? null : os.qc,
    pagamento: os.pagamento == null ? null : os.pagamento,
    nf: os.nf == null ? null : os.nf,
    nps: os.nps == null ? null : os.nps,
    aceite: os.aceite == null ? null : os.aceite,
    aprovado_em: os.aprovadoEm == null ? null : os.aprovadoEm,
    chat: os.chat || [],
    eventos: os.eventos || [],
  });
  const toDbInsert = (os) => ({ numero: os.numero, criada: os.criada, ...toDbUpdate(os) });

  const fromDbVeiculo = (r) => ({
    ...(r.dados || {}),                 // modelo, motor, cambio, familia, anoModelo, planta, sa, cor…
    vin: r.vin,
    placa: r.placa || '',
    km: r.km || 0,
    cliente: r.cliente || '',
    telefone: r.telefone_norm || '',
    cofre: r.cofre || [],
  });
  const toDbVeiculo = (v) => {
    const { vin, placa, km, cliente, telefone, cofre, ...dados } = v || {};
    return {
      vin,
      dados,
      placa: placa || null,
      placa_norm: local.normPlaca(placa || '') || null,
      km: +km || 0,
      cliente: cliente || null,
      telefone_norm: local.normTel(telefone) || null,
      cofre: cofre || [],
    };
  };

  const fromDbCliente = (r) => ({
    id: r.id,
    nome: r.nome,
    telefone: r.telefone || r.telefone_norm || '',
    senha: r.ativado_em ? '✓' : null,   // marcador de "acesso ativo": a senha real vive no Supabase Auth
    convite: r.convite,
    desde: r.desde || null,
    criadoEm: r.criado_em || null,
    ativadoEm: r.ativado_em || null,
  });

  /* token de convite p/ clientes criados no balcão — ALTA entropia (o token é
     a credencial de ativação da conta); unicidade final pelo UNIQUE do banco */
  const novoToken = () => {
    try {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); // 128 bits
    } catch (e) {
      let t = '';
      while (t.length < 32) t += Math.random().toString(36).slice(2);
      return t.slice(0, 32);
    }
  };

  /* ============================================================
     4 · Espelho de ordens: helpers de acesso e refetch
     ============================================================ */
  const findOS = (numero) => mirror.os.find((o) => o.numero === +numero);
  const replaceOS = (os) => {
    const i = mirror.os.findIndex((o) => o.numero === os.numero);
    if (i >= 0) mirror.os[i] = os; else { mirror.os.push(os); sortOS(); }
  };
  const fetchOS = async (numero) => {
    try {
      const { data, error } = await sb.from('ordens').select('*').eq('numero', +numero).maybeSingle();
      if (error) { falha(`refetch OS ${numero}`, error); return null; }
      setOnline(true);
      return data ? fromDbOrdem(data) : null;
    } catch (e) { falha(`refetch OS ${numero}`, e); return null; }
  };

  /* ============================================================
     5 · Hidratação (WERK.ready) — tolerante a erro e a RLS vazio
     ============================================================ */
  const sel = async (tabela, mod) => {
    try {
      let q = sb.from(tabela).select('*');
      if (mod) q = mod(q);
      const { data, error } = await q;
      if (error) { falha(`hidratação ${tabela}`, error); return null; } // null = mantém o que o espelho já tem
      setOnline(true);
      return data || [];                                                // [] = RLS não entregou nada (cliente/anon) — válido
    } catch (e) { falha(`hidratação ${tabela}`, e); return null; }
  };

  let hydEpoch = 0; // logout invalida hidratações em curso (nada de dado alheio reaparecer)
  const doHydrate = async () => {
    const epoch = hydEpoch;
    const [ordens, veiculos, clientes, cfg, staff] = await Promise.all([
      sel('ordens', (q) => q.order('criada', { ascending: false })),
      sel('veiculos'),
      sel('clientes'),   // cliente comum: RLS entrega só a própria linha; anon: nada
      sel('config'),     // staff-only: cliente/anon recebem vazio — tolerado
      sel('staff'),      // detecção de papel: staff enxerga a própria tabela, cliente não
    ]);
    if (epoch !== hydEpoch) return; // logout aconteceu no meio: descarta este resultado
    if (ordens) mirror.os = ordens.map(fromDbOrdem);
    if (veiculos) mirror.vehicles = veiculos.map(fromDbVeiculo);
    if (clientes) mirror.clients = clientes.map(fromDbCliente);
    if (staff !== null) {
      isStaff = staff.length > 0;
      const propria = user ? staff.find((r) => r.auth_user === user.id) : null;
      meuPapel = propria ? propria.papel || 'consultor' : null;
    }
    if (cfg && cfg.length && cfg[0].data) mirror.config = cfg[0].data;
    else if (cfg && !cfg.length && isStaff) {
      // staff com tabela config ainda vazia: cache de demo NÃO pode virar config de produção (ex.: pixChave demo)
      mirror.config = null;
      try { localStorage.removeItem(K.config); } catch (e) { /* noop */ }
    }
    sortOS();
    emit();
  };

  /* single-flight com fila: quem chama durante uma hidratação em curso
     recebe UMA nova hidratação agendada para depois dela (dados pós-login) */
  let hydTail = Promise.resolve();
  let hydQueued = null;
  const hydrate = () => {
    if (hydQueued) return hydQueued;
    const p = hydTail
      .then(() => { if (hydQueued === p) hydQueued = null; return doHydrate(); })
      .catch((e) => falha('hidratação', e));
    hydQueued = p;
    hydTail = p;
    return p;
  };

  /* ============================================================
     6 · Realtime — UM canal postgres_changes p/ as 4 tabelas
     ============================================================ */
  const canal = sb
    .channel('evx-espelho')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ordens' }, (p) => {
      if (p.eventType === 'DELETE') {
        const n = p.old && p.old.numero;
        if (n != null) mirror.os = mirror.os.filter((o) => o.numero !== n);
      } else if (p.new) {
        const os = fromDbOrdem(p.new);
        const cur = findOS(os.numero);
        // eco do nosso próprio push (ou evento atrasado): não regride mutações otimistas
        if (cur && (cur.versao || 0) >= (os.versao || 0)) return;
        replaceOS(os);
        sortOS();
      }
      emit();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'veiculos' }, (p) => {
      if (p.eventType === 'DELETE') {
        const vin = p.old && p.old.vin;
        if (vin) mirror.vehicles = mirror.vehicles.filter((v) => v.vin !== vin);
      } else if (p.new) {
        const v = fromDbVeiculo(p.new);
        const i = mirror.vehicles.findIndex((x) => x.vin === v.vin);
        if (i >= 0) mirror.vehicles[i] = v; else mirror.vehicles.push(v);
      }
      emit();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, (p) => {
      if (p.eventType === 'DELETE') {
        const id = p.old && p.old.id;
        if (id) mirror.clients = mirror.clients.filter((c) => c.id !== id);
      } else if (p.new) {
        const c = fromDbCliente(p.new);
        const i = mirror.clients.findIndex((x) => (x.id && x.id === c.id) ||
          local.normTel(x.telefone) === local.normTel(c.telefone));
        if (i >= 0) mirror.clients[i] = c; else mirror.clients.push(c);
      }
      emit();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, (p) => {
      if (p.eventType !== 'DELETE' && p.new && p.new.data) mirror.config = p.new.data;
      emit();
    });

  /* ============================================================
     7 · Leituras síncronas (sempre do espelho; cópias, como o local)
     ============================================================ */
  const getAllOS = () => clone(mirror.os);
  const getOS = (num) => { const o = findOS(num); return o ? clone(o) : undefined; };
  const getVehicles = () => clone(mirror.vehicles);
  const getClientes = () => clone(mirror.clients);
  const getConfig = () => local.getConfig(); // lê o cache (que espelhamos) + defaults/margens do módulo local

  const clientePorTelefone = (tel) => {
    const t = local.normTel(tel);
    const c = t && mirror.clients.find((x) => local.normTel(x.telefone) === t);
    return c ? clone(c) : null;
  };

  const garagemDe = (telefone) => {
    const t = local.normTel(telefone);
    if (!t) return [];
    const out = mirror.vehicles.filter((v) => local.normTel(v.telefone) === t).map(clone);
    // tela de cadastro por convite (anon): veículos vindos de convite_info
    if (conviteBuf && local.normTel(conviteBuf.telefone) === t) {
      conviteBuf.veiculos.forEach((cv) => {
        const p = local.normPlaca(cv.placa || '');
        if (p && out.some((v) => local.normPlaca(v.placa || '') === p)) return;
        out.push({ modelo: cv.modelo, placa: cv.placa || '', cor: cv.cor || '', telefone: conviteBuf.telefone });
      });
    }
    return out;
  };

  const pendencias = (telefone) => {
    const t = local.normTel(telefone);
    const out = [];
    mirror.os.forEach((o) => {
      if (t && local.normTel(o.telefone) !== t) return;
      (o.itens || []).forEach((i) => {
        if (i.aprovacao === 'recusado') out.push({ os: o.numero, veiculo: o.veiculo, placa: o.placa, item: clone(i) });
      });
    });
    return out;
  };

  /* ============================================================
     8 · Escritas otimistas + push com guarda de versão
     ============================================================ */
  /* Push de uma OS: payload FOTOGRAFADO no momento da mutação (não relê o
     espelho — realtime pode tê-lo sobrescrito). Conflito de versão ⇒
     refetch + reaplica o mutator UMA vez ⇒ push; falhou de novo ⇒ espelho
     realinhado à verdade do servidor + console.warn. */
  const pushOS = (numero, mut, stamped, payload, versao) => enqueue(`os:${numero}`, async () => {
    const envia = async (body, guarda) => {
      const { data, error } = await sb.from('ordens').update(body).eq('numero', +numero).eq('versao', guarda).select();
      if (error) {
        falha(`push OS ${numero}`, error);
        if (!isNetErr(error)) {            // erro de DADOS (RLS/trigger/validação): otimismo é mentira → realinha
          const verdade = await fetchOS(numero);
          if (verdade) { replaceOS(verdade); emit(); }
        }
        return null;                       // erro de REDE: espelho segue otimista até a rede voltar
      }
      setOnline(true);
      return (data && data.length) ? data[0] : false;                    // false = guarda de versão não casou
    };
    const merge = (row) => {
      const cur = findOS(numero);
      if (cur) { cur.versao = Math.max(cur.versao || 0, row.versao || 0); persist(); }
    };
    let r = await envia(payload, versao);
    if (r === null) return;
    if (r) { merge(r); return; }
    // conflito: alguém escreveu antes — refetch + reaplicar mutator 1x
    const fresh = await fetchOS(numero);
    if (!fresh) { warn(`push OS ${numero}: conflito de versão e linha indisponível no refetch`); return; }
    try {
      mut(fresh);
      if (stamped) fresh.eventos.push(stamped);
    } catch (e) {
      replaceOS(fresh); emit();
      warn(`push OS ${numero}: mutator não pôde ser reaplicado — espelho realinhado`, e);
      return;
    }
    replaceOS(fresh); emit();
    r = await envia(clone(toDbUpdate(fresh)), fresh.versao || 0);
    if (r === null) return;
    if (r) { merge(r); return; }
    const verdade = await fetchOS(numero);
    if (verdade) { replaceOS(verdade); emit(); }
    warn(`push OS ${numero}: conflito persistente — espelho realinhado ao servidor`);
  });

  const updateOS = (numero, mut, evento) => {  // mesma semântica do local: mutator + evento carimbado
    const os = findOS(numero);
    if (!os) return null;
    const stamped = evento ? { ts: new Date().toISOString(), ...evento } : null;
    mut(os);
    if (stamped) os.eventos.push(stamped);
    emit();
    pushOS(+numero, mut, stamped, clone(toDbUpdate(os)), os.versao || 0);
    return clone(os); // cópia: mutar o retorno não pode corromper o espelho sem push
  };

  const setStatus = (numero, statusId, ator, extra) => {  // local + push de notificação EVX
    const st = local.STATUS.find((s) => s.id === statusId) || { nome: statusId, cliente: '' };
    const os = updateOS(numero, (o) => { o.status = statusId; },
      { tipo: 'status', titulo: st.nome, desc: extra || st.cliente, ator: ator || 'Sistema' });
    if (os && typeof EVX !== 'undefined') {
      EVX.pushNotification({
        titulo: `OS #${numero} — ${st.cliente}`,
        texto: extra || `Status atualizado: ${st.nome}.`,
        quando: Date.now(),
        tipo: statusId === 'pronto' ? 'ok' : 'os',
      });
    }
    return os;
  };

  const chatSend = (numero, de, texto) => {
    if (user && !isStaff) { chatCliente(numero, texto); const cur = findOS(numero); return cur ? clone(cur) : null; } // cliente nunca escreve direto
    return updateOS(numero, (o) => o.chat.push({ ts: new Date().toISOString(), de, texto }),
      { tipo: 'chat', titulo: `Mensagem de ${de}`, desc: texto.slice(0, 80), ator: de });
  };

  const upsertVehicle = (v) => {
    const i = mirror.vehicles.findIndex((x) => x.vin === v.vin);
    const merged = i >= 0 ? { ...mirror.vehicles[i], ...v } : v;
    if (i >= 0) mirror.vehicles[i] = merged; else mirror.vehicles.push(merged);
    emit();
    const corpo = toDbVeiculo(merged);
    enqueue(`veiculo:${v.vin}`, async () => {
      const { error } = await sb.from('veiculos').upsert(corpo, { onConflict: 'vin' });
      if (error) return falha(`upsertVehicle ${v.vin}`, error);
      setOnline(true);
    });
    return v;
  };

  const upsertCliente = (dados) => {  // otimista; preserva convite/auth já existentes no banco
    const tel = local.normTel(dados && dados.telefone);
    if (!tel) return null;
    let c = mirror.clients.find((x) => local.normTel(x.telefone) === tel);
    if (c) {
      if (dados.nome) c.nome = dados.nome;
      c.telefone = dados.telefone;
    } else {
      c = {
        nome: dados.nome || 'Cliente EUROVIX', telefone: dados.telefone,
        senha: null, convite: dados.convite || novoToken(),
        desde: dados.desde || new Date().getFullYear(),
        criadoEm: new Date().toISOString(), ativadoEm: null,
      };
      mirror.clients.push(c);
    }
    emit();
    enqueue(`cliente:${tel}`, async () => {
      const { data: rows, error } = await sb.from('clientes').select('*').eq('telefone_norm', tel).limit(1);
      if (error) return falha(`upsertCliente ${tel}: busca`, error);
      setOnline(true);
      const cur = mirror.clients.find((x) => local.normTel(x.telefone) === tel) || c;
      if (rows && rows.length) {
        // já existe: atualiza só nome/telefone (convite e auth_user do banco são preservados)
        const { data: up, error: e2 } = await sb.from('clientes')
          .update({ nome: cur.nome, telefone: cur.telefone }).eq('id', rows[0].id).select();
        if (e2) return falha(`upsertCliente ${tel}: update`, e2);
        Object.assign(cur, fromDbCliente((up && up[0]) || rows[0]));
        emit();
      } else {
        const { data: nrow, error: e3 } = await sb.from('clientes')
          .insert({ telefone_norm: tel, telefone: cur.telefone, nome: cur.nome, desde: cur.desde || new Date().getFullYear(), convite: cur.convite })
          .select().single();
        if (e3) {
          if (e3.code === '23505') { // corrida: outro check-in inseriu primeiro — adota a linha do banco
            const { data: r2 } = await sb.from('clientes').select('*').eq('telefone_norm', tel).limit(1);
            if (r2 && r2.length) { Object.assign(cur, fromDbCliente(r2[0])); emit(); }
            return;
          }
          return falha(`upsertCliente ${tel}: insert`, e3);
        }
        if (nrow) { Object.assign(cur, fromDbCliente(nrow)); emit(); }
      }
    });
    return c;
  };

  const saveConfig = (cfg) => {
    mirror.config = cfg;
    emit();
    enqueue('config', async () => {
      const { error } = await sb.from('config').upsert({ id: 1, data: cfg });
      if (error) return falha('saveConfig', error);
      setOnline(true);
    });
  };

  const saveAllOS = (lista) => {  // paridade de interface: substitui o espelho e sobe só o que mudou
    const antes = new Map(mirror.os.map((o) => [o.numero, JSON.stringify(o)]));
    mirror.os = clone(lista || []);
    sortOS();
    emit();
    mirror.os.forEach((os) => {
      if (antes.get(os.numero) === JSON.stringify(os)) return; // linha idêntica: não sobe
      const corpo = clone(toDbInsert(os));
      enqueue(`os:${os.numero}`, async () => {
        const { data, error } = await sb.from('ordens').upsert(corpo, { onConflict: 'numero' }).select();
        if (error) return falha(`saveAllOS #${os.numero}`, error);
        setOnline(true);
        const cur = findOS(os.numero);
        if (cur && data && data.length) { cur.versao = Math.max(cur.versao || 0, data[0].versao || 0); persist(); }
      });
    });
    // OSes removidas da lista NÃO são apagadas do banco (log de auditoria manda; nenhuma tela remove OS hoje)
  };

  /* ============================================================
     9 · novaOS — await-ável: numero real da sequence + insert
     ============================================================ */
  const novaOS = async (dados) => {
    try {
      const { data: numero, error } = await sb.rpc('nova_os_numero');
      if (error) { falha('novaOS: rpc nova_os_numero', error); return null; }
      const os = {  // MESMO shape do módulo local
        numero: +numero,
        criada: new Date().toISOString(),
        status: 'fila',
        vin: dados.vin,
        veiculo: dados.veiculo,
        placa: dados.placa || '',
        cliente: dados.cliente || 'Cliente EUROVIX',
        telefone: dados.telefone || '',
        sintoma: dados.sintoma || '',
        tecnico: dados.tecnico || '',
        consultor: 'Paulo Victor de Almeida',
        checkin: dados.checkin || null,
        dtcs: [],
        itens: [],
        qc: null,
        pagamento: null,
        nf: null,
        nps: null,
        chat: [],
        eventos: [{ ts: new Date().toISOString(), tipo: 'abertura', titulo: 'OS aberta', desc: 'Check-in digital concluído', ator: dados.ator || 'Recepção' }],
        versao: 0,
      };
      const { data: row, error: e2 } = await sb.from('ordens').insert(toDbInsert(os)).select().single();
      if (e2) { falha(`novaOS: insert #${os.numero}`, e2); return null; }
      setOnline(true);
      os.versao = (row && row.versao) || 0;
      replaceOS(os);
      sortOS();
      emit();
      return clone(os);
    } catch (e) { falha('novaOS', e); return null; }
  };

  /* ============================================================
     10 · Funções do app do cliente — otimistas + RPC (única via
          de escrita permitida ao cliente pelo RLS)
     ============================================================ */
  const applyOS = (numero, mut, evento) => {  // só espelho (o push é a RPC)
    const os = findOS(numero);
    if (!os) return null;
    mut(os);
    if (evento) os.eventos.push({ ts: new Date().toISOString(), ...evento });
    emit();
    return os;
  };
  const mergeOsResposta = (data) => {  // RPCs que devolvem a OS atualizada realinham o espelho
    const row = Array.isArray(data) ? data[0] : data;
    if (row && typeof row === 'object' && row.numero != null && row.status) {
      replaceOS(fromDbOrdem(row));
      sortOS();
      emit();
      return true;
    }
    return false;
  };
  const rpcOS = (nome, args, numero) => enqueue(`os:${numero}`, async () => {
    try {
      const { data, error } = await sb.rpc(nome, args);
      if (error) {
        falha(`rpc ${nome} (OS ${numero})`, error);
        const verdade = await fetchOS(numero);           // reverte o otimismo à verdade do servidor
        if (verdade) { replaceOS(verdade); emit(); }
        return null;
      }
      setOnline(true);
      mergeOsResposta(data);                             // sem retorno de linha → realtime confirma
      const cur = findOS(numero);
      return cur ? clone(cur) : null;
    } catch (e) { falha(`rpc ${nome} (OS ${numero})`, e); return null; }
  });
  const nomeCliente = () => {
    const me = (!isStaff && mirror.clients.length) ? mirror.clients[0] : null; // RLS: cliente só enxerga a si
    return (me && me.nome) || 'Cliente';
  };

  /* decisoes: `{ [itemId]: { aprovado: bool, nivel } }` (shape do app.js) —
     tolera também array de `{ id, aprovacao, nivelEscolhido }` */
  const aprovarOrcamento = (numero, decisoes, aceite) => {
    const mapa = {};
    if (Array.isArray(decisoes)) decisoes.forEach((d) => { if (d && d.id != null) mapa[d.id] = d; });
    else if (decisoes && typeof decisoes === 'object') Object.keys(decisoes).forEach((id) => { mapa[id] = decisoes[id]; });
    const decidir = (d) => (d.aprovado !== undefined ? !!d.aprovado : d.aprovacao === 'aprovado');
    const os = findOS(numero);
    let aprovados = 0, avaliados = 0;
    if (os) {
      os.itens.forEach((i) => {
        const d = mapa[i.id];
        if (!d) return;
        avaliados++;
        const ok = decidir(d);
        i.aprovacao = ok ? 'aprovado' : 'recusado';
        i.nivelEscolhido = d.nivel || d.nivelEscolhido || i.nivelEscolhido || 'original';
        if (ok) aprovados++;
      });
      os.aceite = aceite || os.aceite || null;
      os.aprovadoEm = (aceite && aceite.ts) || new Date().toISOString();
      os.eventos.push({ ts: os.aprovadoEm, tipo: 'aceite', titulo: 'Orçamento aprovado pelo app', desc: `${aprovados} aprovado(s), ${avaliados - aprovados} adiado(s) — assinatura digital registrada.`, ator: os.cliente || nomeCliente() });
      if (aprovados > 0 && os.status === 'aprovacao') {
        os.status = 'execucao';
        os.eventos.push({ ts: os.aprovadoEm, tipo: 'status', titulo: 'Em execução', desc: 'Itens aprovados liberados para o box.', ator: 'Sistema' });
        if (typeof EVX !== 'undefined') EVX.pushNotification({ titulo: `OS #${numero} — Em execução no box`, texto: 'Itens aprovados liberados para o box.', quando: Date.now(), tipo: 'os' });
      }
      emit();
    }
    // payload CANÔNICO da RPC: array de {id, aprovacao, nivelEscolhido} (a RPC rejeita objeto/mapa)
    const p_decisoes = Object.keys(mapa).map((id) => {
      const d = mapa[id] || {};
      const ok = decidir(d);
      return { id, aprovacao: ok ? 'aprovado' : 'recusado', nivelEscolhido: d.nivel || d.nivelEscolhido || 'original' };
    });
    return rpcOS('aprovar_orcamento', { p_numero: +numero, p_decisoes, p_aceite: aceite || null }, +numero);
  };

  const chatCliente = (numero, texto) => {
    const t = String(texto || '').slice(0, 500);  // mesmo limite da RPC
    const de = nomeCliente();
    applyOS(numero, (o) => o.chat.push({ ts: new Date().toISOString(), de, texto: t }),
      { tipo: 'chat', titulo: `Mensagem de ${de}`, desc: t.slice(0, 80), ator: de });
    return rpcOS('chat_cliente', { p_numero: +numero, p_texto: t }, +numero);
  };

  const avaliarNps = (numero, nota) => {
    const n = Math.max(0, Math.min(10, +nota || 0));
    applyOS(numero, (o) => { if (o.nps == null) o.nps = n; },
      { tipo: 'nps', titulo: 'Avaliação do cliente', desc: `NPS ${n}/10`, ator: nomeCliente() });
    return rpcOS('avaliar_nps', { p_numero: +numero, p_nota: n }, +numero);
  };

  /* ============================================================
     11 · Auth + convite (e-mail sintético c<telefone>@clientes…)
     ============================================================ */
  const emailCliente = (tel) => `c${local.normTel(tel)}@clientes.eurovix.app`;

  /* Espelho/buffer respondem na hora (staff e tela de cadastro);
     sem cache → Promise via RPC convite_info. `await` funciona nos dois. */
  const clientePorConvite = (tok) => {
    if (!tok) return null;
    const hit = mirror.clients.find((c) => c.convite === tok);
    if (hit) return clone(hit);
    if (conviteBuf && conviteBuf.token === String(tok)) {
      return { nome: conviteBuf.nome, telefone: conviteBuf.telefone, senha: conviteBuf.ativo ? '✓' : null, convite: String(tok) };
    }
    return (async () => {
      try {
        const { data, error } = await sb.rpc('convite_info', { p_token: String(tok) });
        if (error) { falha('clientePorConvite', error); return null; }
        setOnline(true);
        const info = Array.isArray(data) ? data[0] : data;
        if (!info || !info.telefone) return null;
        conviteBuf = {
          token: String(tok), nome: info.nome, telefone: info.telefone, ativo: !!info.ativo,
          veiculos: Array.isArray(info.veiculos) ? info.veiculos : [],
        };
        ping(); // garagemDe já enxerga os veículos do convite
        return { nome: info.nome, telefone: info.telefone, senha: info.ativo ? '✓' : null, convite: String(tok) };
      } catch (e) { falha('clientePorConvite', e); return null; }
    })();
  };

  const loginCliente = async (telefone, senha) => {
    const t = local.normTel(telefone);
    if (!t || !senha) return null;
    try {
      const { error } = await sb.auth.signInWithPassword({ email: emailCliente(t), password: senha });
      if (error) {
        if (isNetErr(error)) falha('loginCliente', error); // credencial inválida = null silencioso (paridade local)
        return null;
      }
      setOnline(true);
      await hydrate();
      let c = mirror.clients.find((x) => local.normTel(x.telefone) === t) || null;
      if (!c) { // hidratação correu antes do RLS enxergar? busca direta da própria linha
        const { data: rows } = await sb.from('clientes').select('*').eq('telefone_norm', t).limit(1);
        if (rows && rows.length) { c = fromDbCliente(rows[0]); mirror.clients.push(c); emit(); }
      }
      if (!c) warn(`loginCliente: autenticado mas sem linha em clientes p/ ${t}`);
      return c ? clone(c) : null;
    } catch (e) { falha('loginCliente', e); return null; }
  };

  const ativarCliente = async (tok, senha) => {
    try {
      // 1 · telefone do convite (buffer da tela de cadastro ou RPC)
      let info = (conviteBuf && conviteBuf.token === String(tok)) ? conviteBuf : null;
      if (!info) {
        const r = await clientePorConvite(tok);
        if (!r) return null;
        info = (conviteBuf && conviteBuf.token === String(tok)) ? conviteBuf : r;
      }
      const t = local.normTel(info.telefone);
      if (!t) return null;
      // 2 · signUp; se já registrado, signInWithPassword
      const s1 = await sb.auth.signUp({ email: emailCliente(t), password: senha });
      const jaExiste = (s1.error && /already/i.test(s1.error.message || '')) ||
        (s1.data && s1.data.user && Array.isArray(s1.data.user.identities) && s1.data.user.identities.length === 0);
      if (s1.error && !jaExiste) { falha('ativarCliente: signUp', s1.error); return null; }
      let sess = s1.data && s1.data.session;
      if (!sess) {
        const s2 = await sb.auth.signInWithPassword({ email: emailCliente(t), password: senha });
        if (s2.error) {
          falha('ativarCliente: sem sessão — confira "Confirm email: OFF" (SETUP-NUVEM.md, passo 3) ou a senha', s2.error);
          return null;
        }
        sess = s2.data && s2.data.session;
      }
      if (!sess) { warn('ativarCliente: signUp/signIn não devolveu sessão'); return null; }
      // 3 · vincula o auth ao cliente do convite (idempotente p/ o mesmo uid)
      const { data: rowJ, error: e3 } = await sb.rpc('ativar_convite', { p_token: String(tok) });
      if (e3) { falha('ativarCliente: rpc ativar_convite', e3); return null; }
      setOnline(true);
      // 4 · re-hidrata (agora o RLS entrega OS/veículos/cliente do usuário)
      await hydrate();
      const linha = Array.isArray(rowJ) ? rowJ[0] : rowJ;
      const c = mirror.clients.find((x) => local.normTel(x.telefone) === t) ||
        (linha && linha.telefone_norm ? fromDbCliente(linha) : null);
      return c ? clone(c) : { nome: info.nome, telefone: info.telefone, senha: '✓', convite: String(tok) };
    } catch (e) { falha('ativarCliente', e); return null; }
  };

  const loginStaff = async (email, senha) => {
    if (!email || !senha) return null;
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: String(email).trim(), password: senha });
      if (error) {
        if (isNetErr(error)) falha('loginStaff', error);
        return null;
      }
      setOnline(true);
      await hydrate();
      if (!isStaff) { // autenticou, mas não está na tabela staff → sem WERK OS
        warn(`loginStaff: ${email} autenticado mas fora da tabela staff (SETUP-NUVEM.md, passo 4)`);
        try { await sb.auth.signOut(); } catch (e) { /* noop */ }
        return null;
      }
      return (data && data.user) || null;
    } catch (e) { falha('loginStaff', e); return null; }
  };

  const logoutAuth = async () => {
    hydEpoch++; // hidratações em curso (com o token antigo) são descartadas ao resolver
    try { await sb.auth.signOut(); } catch (e) { warn('logoutAuth', e); }
    mirror.os = []; mirror.vehicles = []; mirror.clients = []; mirror.config = null;
    isStaff = false; meuPapel = null;
    try { [K.os, K.vehicles, K.clients, K.config].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* noop */ }
    ping(); // nada de dado alheio fica no aparelho após sair
  };

  /* ============================================================
     11b · Equipe — colaboradores gerenciados pelo próprio painel
     (view 👥 Equipe). As regras de papel moram nas RPCs staff_*
     do servidor; aqui só transportamos e traduzimos erros p/ UI.
     ============================================================ */
  const staffMsg = (e) => (e && (e.message || e.error_description || e.msg)) || 'Falha de conexão — tente de novo.';
  /* erro que indica que as RPCs staff_* ainda não existem no banco (falta rodar
     o EQUIPE-UPGRADE.sql) — distinto de "acesso negado" (é staff mas sem papel) */
  const faltaMigracaoEquipe = (e) => {
    if (!e) return false;
    if (e.code === 'PGRST202') return true; // PostgREST: função não encontrada
    return /could not find the function|function [^ ]*staff_[^ ]* .*does not exist|permission denied for function/i.test(String(e.message || e.hint || ''));
  };

  const staffListar = async () => {
    try {
      const { data, error } = await sb.rpc('staff_listar');
      if (error) { falha('staff_listar', error); return { ok: false, erro: staffMsg(error), faltaMigracao: faltaMigracaoEquipe(error), lista: [] }; }
      setOnline(true);
      return { ok: true, lista: data || [] };
    } catch (e) { falha('staff_listar', e); return { ok: false, erro: staffMsg(e), faltaMigracao: faltaMigracaoEquipe(e), lista: [] }; }
  };

  const staffEditar = async ({ email, nome, papel }) => {
    try {
      const { data, error } = await sb.rpc('staff_upsert', { p_email: String(email || '').trim(), p_nome: nome, p_papel: papel });
      if (error) { if (isNetErr(error)) falha('staff_upsert', error); return { ok: false, erro: staffMsg(error) }; }
      setOnline(true);
      await hydrate(); // meu próprio papel pode ter mudado (ex.: admin se rebaixou)
      return { ok: true, registro: data };
    } catch (e) { falha('staff_upsert', e); return { ok: false, erro: staffMsg(e) }; }
  };

  /* Cria o LOGIN num cliente supabase PARALELO (persistSession:false → não
     derruba a sessão de quem está operando) e vincula papel via RPC. E-mail
     que já tem login não é erro: seguimos e só ajustamos o vínculo/papel. */
  const staffCriar = async ({ nome, email, senha, papel }) => {
    try {
      const tmp = supabase.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await tmp.auth.signUp({ email: String(email || '').trim(), password: senha });
      let jaExistia = false;
      if (error) {
        if (/already|registered|exists|cadastr/i.test(staffMsg(error))) jaExistia = true;
        else { if (isNetErr(error)) falha('staffCriar signUp', error); return { ok: false, erro: staffMsg(error) }; }
      } else if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        jaExistia = true; // resposta anti-enumeração do Supabase p/ e-mail já confirmado
      }
      try { await tmp.auth.signOut(); } catch (e2) { /* sessão temporária é descartável */ }
      const up = await staffEditar({ email, nome, papel });
      if (!up.ok) return up;
      return { ok: true, jaExistia };
    } catch (e) { falha('staffCriar', e); return { ok: false, erro: staffMsg(e) }; }
  };

  const staffRemover = async (authUserId) => {
    try {
      const { error } = await sb.rpc('staff_remover', { p_usuario: authUserId });
      if (error) { if (isNetErr(error)) falha('staff_remover', error); return { ok: false, erro: staffMsg(error) }; }
      setOnline(true);
      return { ok: true };
    } catch (e) { falha('staff_remover', e); return { ok: false, erro: staffMsg(e) }; }
  };

  const mudarMinhaSenha = async (nova) => {
    try {
      const { error } = await sb.auth.updateUser({ password: nova });
      if (error) return { ok: false, erro: staffMsg(error) };
      return { ok: true };
    } catch (e) { falha('mudarMinhaSenha', e); return { ok: false, erro: staffMsg(e) }; }
  };

  // Pagamento no modo nuvem: escrita otimista via updateOS do adaptador (espelho
  // + push async, igual ao checkout do painel antes) reusando local.aplicarPagamento
  // (a regra de NF/garantia, que muta a OS) — mesma lógica do modo local, sem divergir.
  const registrarPagamento = (numero, opts) => {
    opts = opts || {};
    const alvo = getOS(numero);
    if (!alvo || alvo.pagamento) return alvo || null;
    const cfgG = getConfig().garantiaMeses;
    const agora = new Date();
    const valor = opts.valor != null ? opts.valor : local.totalOS(alvo, true);
    updateOS(numero, (o) => local.aplicarPagamento(o, { metodo: opts.metodo, valor, retirada: opts.retirada }, agora, cfgG),
      { tipo: 'entrega', titulo: 'Pagamento confirmado', desc: opts.desc || `Pix ${local.brl(valor)} · NF emitida · garantia ativada`, ator: opts.ator || 'Sistema' });
    return getOS(numero);
  };

  /* ============================================================
     12 · Montagem do adaptador + boot
     ============================================================ */
  const adapter = {
    /* — helpers puros: DELEGADOS ao módulo local (nunca reimplementados) — */
    KEYS: local.KEYS, STATUS: local.STATUS, statusIdx: local.statusIdx,
    CATEGORIAS: local.CATEGORIAS, ETK: local.ETK, SUPPLIERS: local.SUPPLIERS, AW_TABLE: local.AW_TABLE,
    validateVIN: local.validateVIN, decodeVIN: local.decodeVIN, fixVIN: local.fixVIN, checkRecalls: local.checkRecalls,
    motorDePecas: local.motorDePecas, itemPreco: local.itemPreco, totalOS: local.totalOS, custoOS: local.custoOS,
    novoItem: local.novoItem, pixPayload: local.pixPayload,
    brl: local.brl, fdt: local.fdt, fd: local.fd,
    normTel: local.normTel, normPlaca: local.normPlaca,
    conviteUrl: local.conviteUrl, waLink: local.waLink,
    /* — leituras síncronas do espelho — */
    getAllOS, getOS, getVehicles, getClientes, getConfig,
    clientePorTelefone, garagemDe, pendencias,
    /* — escritas otimistas (espelho + push assíncrono) — */
    updateOS, setStatus, chatSend, upsertVehicle, upsertCliente, saveConfig, saveAllOS, registrarPagamento,
    /* — await-áveis — */
    novaOS, loginCliente, ativarCliente, clientePorConvite, loginStaff, logoutAuth,
    /* — app do cliente (RPCs com validação server-side) — */
    aprovarOrcamento, chatCliente, avaliarNps,
    /* — equipe (view 👥 Equipe; regras de papel no servidor) — */
    staffPerfil: () => (isStaff ? { papel: meuPapel || 'consultor' } : null),
    staffListar, staffCriar, staffEditar, staffRemover, mudarMinhaSenha,
    /* — estado — */
    authUser: () => user,
    cloud: true,
    get online() { return online; },
  };

  const init = async () => {
    try { // sessão persistida ANTES da 1ª hidratação (senão o RLS devolve vazio)
      const { data } = await sb.auth.getSession();
      user = (data && data.session && data.session.user) || null;
    } catch (e) { falha('auth getSession', e); }
    sb.auth.onAuthStateChange((_evt, session) => {
      const u = (session && session.user) || null;
      const trocou = ((u && u.id) || null) !== ((user && user.id) || null);
      user = u;
      if (trocou) hydrate(); // login/logout → espelho re-hidratado com o novo escopo RLS
    });
    await hydrate();
    try {
      canal.subscribe((st) => {
        if (st === 'SUBSCRIBED') { setOnline(true); hydrate(); } // cobre a janela select→subscribe E reconexões
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { warn(`realtime ${st}`); setOnline(false); }
      });
    } catch (e) { warn('realtime subscribe', e); }
  };

  sortOS();
  adapter.ready = init().catch((e) => warn('init', e)); // ready SEMPRE resolve — hidratação é tolerante a erro
  window.WERK = adapter; // substitui o módulo local (werk-data.js declara `var WERK`)
})();
