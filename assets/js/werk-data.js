/* ============================================================
   EUROVIX · WERK OS — camada de dados
   Modelo operacional completo da oficina sobre localStorage.
   Em produção, cada bloco marcado [API] é substituído pela
   integração real (Supabase/Postgres, PartsLink24, TecDoc,
   Mercado Pago/Stone, NFS-e) mantendo esta mesma interface.
   ============================================================ */

var WERK = (() => { // var: o adaptador de nuvem (werk-cloud.js) substitui este global quando EVX_ENV está preenchido

  const CLOUD = typeof window !== 'undefined' && !!(window.EVX_ENV && window.EVX_ENV.SUPABASE_URL && window.EVX_ENV.SUPABASE_ANON_KEY);
  // Modo demonstração (assets/js/demo.js zerou EVX_ENV e marcou EVX_DEMO): roda
  // 100% local, mas em um NAMESPACE isolado (evx.demo.*) para nunca misturar com
  // o cache da nuvem da conta real. Sair da demo devolve o modo normal intacto.
  const DEMO = typeof window !== 'undefined' && !!window.EVX_DEMO;
  const KB = DEMO ? 'evx.demo.werk' : 'evx.werk';
  const demoPapel = () => (DEMO && window.EVX_DEMO && window.EVX_DEMO.papel) || 'gestor';
  // Equipe fictícia exibida na view "Equipe" durante a demonstração.
  const DEMO_TEAM = [
    { auth_user: 'demo-gestor',    email: 'gestor.demo@lexos.app',    nome: 'Ana Ribeiro',    papel: 'gestor' },
    { auth_user: 'demo-mecanico',  email: 'mecanico.demo@lexos.app',  nome: 'Bruno Tavares',  papel: 'mecanico' },
    { auth_user: 'demo-consultor', email: 'consultor.demo@lexos.app', nome: 'Carla Nunes',     papel: 'consultor' },
  ];

  const KEYS = {
    os: KB + '.os',
    vehicles: KB + '.vehicles',
    clients: KB + '.clients',
    config: KB + '.config',
    agendamentos: KB + '.agendamentos',
    seedv: KB + '.seed.v1',
    seedAgenda: KB + '.seed.agenda.v1',
    seq: KB + '.seq',
  };

  /* ============================================================
     1 · CICLO DE VIDA — kanban de 8 estados (Etapa 5 da spec)
     ============================================================ */
  const STATUS = [
    { id: 'fila',        nome: 'Fila',                  cliente: 'Veículo recebido',        icon: 'list',   cor: '#8E97A3' },
    { id: 'diagnostico', nome: 'Diagnóstico',           cliente: 'Em diagnóstico',          icon: 'scan',   cor: '#4A7FD4' },
    { id: 'aprovacao',   nome: 'Aguardando aprovação',  cliente: 'Orçamento aguardando seu OK', icon: 'doc', cor: '#E8B031' },
    { id: 'peca',        nome: 'Aguardando peça',       cliente: 'Aguardando peça',         icon: 'part',   cor: '#9B6DD6' },
    { id: 'execucao',    nome: 'Em execução',           cliente: 'Em execução no box',      icon: 'wrench', cor: '#1C8CD4' },
    { id: 'qc',          nome: 'Controle de qualidade', cliente: 'Controle de qualidade',   icon: 'shield', cor: '#2AA7A0' },
    { id: 'lavagem',     nome: 'Lavagem',               cliente: 'Lavagem e acabamento',    icon: 'car',    cor: '#56B4E9' },
    { id: 'pronto',      nome: 'Pronto',                cliente: 'Pronto para retirada 🏁', icon: 'check',  cor: '#35C46B' },
  ];
  const statusIdx = (id) => STATUS.findIndex(s => s.id === id);

  /* ============================================================
     2 · VIN — validação ISO 3779 + decodificação [API: ETK/VIN decoder]
     ============================================================ */
  const VIN_MAP = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8, J:1,K:2,L:3,M:4,N:5, P:7, R:9, S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
  const VIN_W = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];

  function vinValue(ch) {
    if (/[0-9]/.test(ch)) return +ch;
    return VIN_MAP[ch] ?? -1;
  }
  function vinCheckDigit(vin) {
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const v = vinValue(vin[i]);
      if (v < 0) return null;
      sum += v * VIN_W[i];
    }
    const r = sum % 11;
    return r === 10 ? 'X' : String(r);
  }
  function validateVIN(vin) {
    vin = (vin || '').toUpperCase().trim();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { ok: false, motivo: 'VIN deve ter 17 caracteres (sem I, O, Q).' };
    const dv = vinCheckDigit(vin);
    if (dv === null) return { ok: false, motivo: 'Caracteres inválidos no VIN.' };
    if (vin[8] !== dv) return { ok: false, motivo: `Dígito verificador não confere (esperado ${dv}, posição 9).` };
    return { ok: true, vin };
  }
  function fixVIN(vin) { // usado só para gerar seeds válidos
    vin = vin.toUpperCase();
    const dv = vinCheckDigit(vin);
    return vin.slice(0, 8) + dv + vin.slice(9);
  }

  // Decodificação demo por padrão do VIN [API: catálogo eletrônico real]
  const VIN_MODELS = [
    { re: /^WP0Z[A-Z0-9]/, modelo: 'Porsche 911 Carrera S (992)', motor: '3.0 biturbo 450cv', cambio: 'PDK 8', familia: '992', ano: 2022 },
    { re: /^WP1A[A-Z0-9]/, modelo: 'Porsche Macan S (95B)', motor: '2.9 V6 biturbo 380cv', cambio: 'PDK 7', familia: '95b', ano: 2021 },
    { re: /^WP1B[A-Z0-9]/, modelo: 'Porsche Cayenne E-Hybrid (9YA)', motor: '3.0 V6 + elétrico 462cv', cambio: 'Tiptronic S 8', familia: '9ya', ano: 2023 },
    { re: /^WAU[A-Z0-9]/,  modelo: 'Audi A4 45 TFSI quattro (B9)', motor: '2.0 TFSI 265cv', cambio: 'S tronic 7', familia: 'b9', ano: 2021 },
    { re: /^WA1[A-Z0-9]/,  modelo: 'Audi Q5 Sportback 55 TFSIe (FY)', motor: '2.0 TFSI + elétrico 367cv', cambio: 'S tronic 7', familia: 'fy', ano: 2023 },
    { re: /^TRU[A-Z0-9]/,  modelo: 'Audi RS3 Sportback (8Y)', motor: '2.5 TFSI 5 cil. 400cv', cambio: 'S tronic 7', familia: '8y', ano: 2023 },
  ];
  function decodeVIN(vin) {
    vin = (vin || '').toUpperCase();
    const hit = VIN_MODELS.find(m => m.re.test(vin));
    const planta = { A: 'Ingolstadt/DE', B: 'Neckarsulm/DE', C: 'Zuffenhausen/DE', L: 'Leipzig/DE', G: 'Gyor/HU', S: 'Bratislava/SK' }[vin[10]] || 'Zuffenhausen/DE';
    return {
      vin,
      modelo: hit ? hit.modelo : 'Veículo (decodificação completa pelo catálogo do fabricante na integração)',
      motor: hit ? hit.motor : '—',
      cambio: hit ? hit.cambio : '—',
      familia: hit ? hit.familia : 'b9',
      anoModelo: hit ? hit.ano : 2021,
      planta,
      sa: hit ? ['Pacote esportivo', 'Bancos aquecidos', 'Assistente de faixa'] : [],
    };
  }

  /* ============================================================
     3 · RECALLS por VIN [API: consulta de recall do fabricante]
     ============================================================ */
  const RECALLS = [
    { re: /^WP1A/, codigo: 'AH07', titulo: 'Recall bomba de combustível — inspeção e substituição', status: 'aberto' },
  ];
  const checkRecalls = (vin) => RECALLS.filter(r => r.re.test((vin || '').toUpperCase()));

  // Catálogo eletrônico aberto por MARCA (identificada pelo WMI, os 3 primeiros
  // caracteres do chassi). RealOEM é só BMW — apontar um Porsche para lá manda o
  // mecânico para um catálogo onde o chassi dele não existe. Sem catálogo conhecido,
  // devolve null e a interface só copia o VIN.
  const CATALOGOS = [
    { re: /^(WBA|WBS|WBX|WBY|4US|5UX)/, nome: 'RealOEM', url: 'https://www.realoem.com/bmw/enUS/select' },
    { re: /^(WP0|WP1)/,                 nome: 'catálogo Porsche', url: 'https://www.porsche.com/international/accessoriesandservice/classic/genuineparts/' },
    { re: /^(WAU|WA1|TRU|WUA)/,         nome: 'catálogo VAG', url: 'https://www.audi-genuine-parts.com/' },
  ];
  const catalogoDoVin = (vin) => CATALOGOS.find(c => c.re.test(String(vin || '').toUpperCase())) || null;

  /* ============================================================
     4 · MOTOR DE PEÇAS POR CHASSI
     Camada 1 ETK (VIN→part number) · Camada 2 preço original
     Camada 3 TecDoc cross-ref · Camada 4 cotação multi-fornecedor
     [API: PartsLink24 + TecDoc + cotação B2B]
     ============================================================ */
  const ETK = {
    oleo:       { '992': '996 107 225 52', '95b': '95B 115 562 A', '9ya': '95B 115 562 A', b9: '06L 115 562 B', fy: '06L 115 562 B', '8y': '06L 115 562 B', desc: 'Filtro de óleo + anel' },
    freio_d:    { '992': '992 698 151 A', '95b': '95B 698 151 F', '9ya': '9Y0 698 151 C', b9: '8W0 698 151 Q', fy: '80A 698 151 M', '8y': '8Y0 698 151 D', desc: 'Pastilhas dianteiras' },
    disco_d:    { '992': '992 615 301 B', '95b': '95B 615 301 K', '9ya': '9Y0 615 301 D', b9: '8W0 615 301 AK', fy: '80A 615 301 F', '8y': '8Y0 615 301 C', desc: 'Discos dianteiros (par)' },
    vela:       { '992': '999 170 217 90', '95b': '06K 905 601 R', '9ya': '06K 905 601 R', b9: '06K 905 601 R', fy: '06K 905 601 R', '8y': '06L 905 601 A', desc: 'Velas de ignição (jogo)' },
    amortecedor:{ '992': '992 343 031 A', '95b': '95B 413 031 AL', '9ya': '9Y0 413 031 M', b9: '8W0 413 031 CJ', fy: '80A 413 031 BM', '8y': '8Y0 413 031 J', desc: 'Amortecedores dianteiros (par)' },
    bieleta:    { '992': '992 411 065 A', '95b': '95B 411 317 C', '9ya': '9Y0 411 317 B', b9: '8W0 411 317 C', fy: '80A 411 317 B', '8y': '8Y0 411 317 A', desc: 'Bieletas da barra (par)' },
    bomba_agua: { '992': '9A7 106 011 00', '95b': '06L 121 111 H', '9ya': '06M 121 111 J', b9: '06L 121 111 H', fy: '06L 121 111 H', '8y': '07K 121 026 A', desc: 'Bomba d’água + termostato' },
    fluido_freio:{ '992': '000 043 203 76', '95b': '000 043 203 76', '9ya': '000 043 203 76', b9: 'G 004 700 M2', fy: 'G 004 700 M2', '8y': 'G 004 700 M2', desc: 'Fluido DOT4 LV (1L)' },
    correia:    { '992': '999 192 590 90', '95b': '06L 903 137 M', '9ya': '06M 903 137 D', b9: '06L 903 137 M', fy: '06L 903 137 M', '8y': '07K 903 137 C', desc: 'Correia + tensor' },
  };


  // Preço de referência da peça ORIGINAL por categoria (R$) [API: PartsLink24]
  const PRECO_BASE = {
    oleo: 420, freio_d: 1480, disco_d: 2380, vela: 980, amortecedor: 4680,
    bieleta: 620, bomba_agua: 2980, fluido_freio: 160, correia: 890, outro: 800,
  };

  // TecDoc cross-ref: fabricantes por nível e fator de preço [API: TecDoc]
  const CROSSREF = {
    original:    { rotulo: 'Original de fábrica', fator: 1.00, fabricantes: { default: 'Genuína' } },
    oem:         { rotulo: 'OEM',          fator: 0.72, fabricantes: {
      oleo: 'Mahle', freio_d: 'Textar', disco_d: 'Zimmermann', vela: 'NGK/Bosch',
      amortecedor: 'Sachs', bieleta: 'Lemförder', bomba_agua: 'Pierburg',
      fluido_freio: 'ATE', correia: 'Continental', outro: 'ZF Group',
    }},
    aftermarket: { rotulo: 'Aftermarket premium', fator: 0.55, fabricantes: {
      oleo: 'Mann Filter', freio_d: 'Brembo', disco_d: 'Brembo', vela: 'Denso',
      amortecedor: 'Bilstein B4', bieleta: 'Meyle HD', bomba_agua: 'Hepu',
      fluido_freio: 'Motul', correia: 'Gates', outro: 'Febi Bilstein',
    }},
  };

  // Fornecedores para cotação [API: conectores B2B]
  const SUPPLIERS = [
    { id: 'dealer',  nome: 'Concessionária local', prazo: 2,  fator: 1.00, niveis: ['original'] },
    { id: 'importbr',nome: 'Importador BR',      prazo: 5,  fator: 0.86, niveis: ['original', 'oem'] },
    { id: 'euroimp', nome: 'Euro Parts (DE)',     prazo: 10, fator: 0.74, niveis: ['original', 'oem', 'aftermarket'] },
    { id: 'fcp',     nome: 'FCP Euro (US)',      prazo: 12, fator: 0.70, niveis: ['oem', 'aftermarket'] },
    { id: 'autodoc', nome: 'AUTODOC (DE)',       prazo: 15, fator: 0.62, niveis: ['oem', 'aftermarket'] },
  ];

  // Tempos padrão de MO — AW (1h = 12 AW, tabela flat rate do fabricante) [API: tabela oficial]
  const AW_TABLE = {
    oleo: 6, freio_d: 10, disco_d: 14, vela: 8, amortecedor: 28,
    bieleta: 8, bomba_agua: 30, fluido_freio: 6, correia: 16, outro: 12,
    diagnostico: 10,
  };
  const CATEGORIAS = Object.keys(PRECO_BASE);

  function motorDePecas(categoria, familia, config) {
    const cat = ETK[categoria] ? categoria : 'outro';
    const part = ETK[cat] ? (ETK[cat][familia] || ETK[cat][Object.keys(ETK[cat])[0]]) : '—';
    const desc = ETK[cat] ? ETK[cat].desc : 'Peça avulsa';
    const base = PRECO_BASE[cat] || PRECO_BASE.outro;
    const margem = config.margens;
    const niveis = {};
    for (const nv of ['original', 'oem', 'aftermarket']) {
      const cr = CROSSREF[nv];
      const custo = Math.round(base * cr.fator);
      const cotacoes = SUPPLIERS.filter(s => s.niveis.includes(nv)).map(s => ({
        fornecedor: s.nome, id: s.id, prazo: s.prazo, custo: Math.round(custo * s.fator),
      })).sort((a, b) => a.custo - b.custo);
      const melhor = cotacoes[0];
      niveis[nv] = {
        rotulo: cr.rotulo,
        fabricante: cr.fabricantes[cat] || cr.fabricantes.default || 'Genuína',
        partNumber: nv === 'original' ? part : partCross(part, nv),
        custo: melhor.custo,
        preco: Math.round(melhor.custo * (1 + (margem[nv] || 25) / 100)),
        prazo: melhor.prazo,
        fornecedor: melhor.fornecedor,
        cotacoes,
      };
    }
    const aw = AW_TABLE[cat] || AW_TABLE.outro;
    return {
      categoria: cat, descricao: desc, partNumber: part, niveis,
      aw, mo: Math.round((aw / 12) * config.valorHora),
    };
  }
  function partCross(part, nivel) {
    if (part === '—') return '—';
    const digits = part.replace(/\D/g, '').slice(-6);
    return nivel === 'oem' ? `OE-${digits}` : `AM-${digits}`;
  }

  /* ============================================================
     5 · CONFIG da oficina
     ============================================================ */
  const DEFAULT_CONFIG = {
    valorHora: 380,                     // R$/h de MO
    margens: { original: 22, oem: 28, aftermarket: 35 },   // % por nível
    garantiaMeses: { peca: 12, mo: 12 },
    // Identidade da oficina — em BRANCO por padrão: cada oficina preenche a sua no
    // onboarding/Configurações. Nada de marca de outra empresa como default.
    oficina: {
      nome: '', cnpj: '', endereco: '', cidade: '',
      fone: '', email: '', pixChave: '', site: '',
      horario: 'Seg–Sex 8h–18h · Sáb 8h–12h',
      logo: null,      // fundo escuro (painel/app do cliente)
      logoDoc: null,   // fundo claro (documentos impressos)
      icon: null,      // símbolo quadrado — vira o ícone do app instalado (PWA)
    },
    tecnicos: [
      { id: 't1', nome: 'Régis Souza',  espec: 'Motor / Powertrain' },
      { id: 't2', nome: 'Paula Freitas', espec: 'Elétrica / Codificação' },
      { id: 't3', nome: 'Diego Ramos',  espec: 'Suspensão / Freios' },
    ],
    consultores: [{ id: 'c1', nome: 'Paulo Victor de Almeida' }],
  };

  /* ============================================================
     6 · Persistência + eventos (log imutável)
     ============================================================ */
  function read(k, fb) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch (e) { return fb; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('storage cheio', e); } }

  const getConfig = () => { const s = read(KEYS.config, {}) || {}; return { ...DEFAULT_CONFIG, ...s, margens: { ...DEFAULT_CONFIG.margens, ...(s.margens || {}) }, oficina: { ...DEFAULT_CONFIG.oficina, ...(s.oficina || {}) } }; };
  const saveConfig = (c) => write(KEYS.config, c);
  // Identidade resolvida da oficina — com flags de conveniência p/ o render white-label.
  function marca() {
    const o = getConfig().oficina || {};
    const nome = (o.nome || '').trim();
    return { ...o, nome, displayNome: nome || 'Sua oficina', temLogo: !!o.logo, temLogoDoc: !!o.logoDoc, temIcon: !!o.icon, configurada: !!(nome && o.logo) };
  }

  const getVehicles = () => read(KEYS.vehicles, []);
  const saveVehicles = (v) => write(KEYS.vehicles, v);
  function upsertVehicle(v) {
    const list = getVehicles();
    const i = list.findIndex(x => x.vin === v.vin);
    if (i >= 0) list[i] = { ...list[i], ...v }; else list.push(v);
    saveVehicles(list);
    return v;
  }

  /* ---------- Clientes & acesso ao app (convite → telefone + senha) ---------- */
  const normTel = (s) => String(s || '').replace(/\D/g, '');
  const normPlaca = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const enc = (s) => btoa(unescape(encodeURIComponent(s)));

  const getClientes = () => read(KEYS.clients, []);
  const saveClientes = (l) => write(KEYS.clients, l);
  function novoToken(lista) {
    let t;
    do { t = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10); } while (lista.some(c => c.convite === t));
    return t; // ~16 chars: paridade com o token de alta entropia gerado no servidor
  }
  function upsertCliente(dados) {
    const tel = normTel(dados.telefone);
    if (!tel) return null;
    const lista = getClientes();
    let c = lista.find(x => normTel(x.telefone) === tel);
    if (c) {
      if (dados.nome) c.nome = dados.nome;
      c.telefone = dados.telefone;
    } else {
      c = {
        nome: dados.nome || 'Cliente', telefone: dados.telefone,
        senha: null, convite: dados.convite || novoToken(lista),
        desde: dados.desde || new Date().getFullYear(),
        criadoEm: new Date().toISOString(), ativadoEm: null,
      };
      lista.push(c);
    }
    saveClientes(lista);
    return c;
  }
  const clientePorTelefone = (tel) => { const t = normTel(tel); return (t && getClientes().find(c => normTel(c.telefone) === t)) || null; };
  const clientePorConvite = (tok) => (tok && getClientes().find(c => c.convite === tok)) || null;
  function ativarCliente(tok, senha) {
    const lista = getClientes();
    const c = lista.find(x => x.convite === tok);
    if (!c) return null;
    c.senha = enc(senha);
    c.ativadoEm = new Date().toISOString();
    saveClientes(lista);
    return c;
  }
  function loginCliente(telefone, senha) {
    const c = clientePorTelefone(telefone);
    return (c && c.senha && senha && c.senha === enc(senha)) ? c : null;
  }
  function garagemDe(telefone) {
    const t = normTel(telefone);
    return t ? getVehicles().filter(v => normTel(v.telefone) === t) : [];
  }
  const conviteUrl = (c) => new URL('app.html?convite=' + c.convite, location.href).href;
  function waLink(telefone, texto) {
    const d = normTel(telefone);
    return `https://wa.me/${d.length > 11 ? d : '55' + d}?text=${encodeURIComponent(texto || '')}`;
  }

  /* ---------- Agenda: fila de agendamentos (site + manuais) ----------
     Mesma interface nos dois modos (o adaptador de nuvem sobrescreve):
     linha = { id, protocolo, nome, telefone, veiculo, placa, servico,
               servico_nome, data (YYYY-MM-DD), hora, obs,
               status novo|confirmado|cancelado|convertido, os_numero, criado_em } */
  const agSort = (l) => [...l].sort((a, b) =>
    ((a.data || '9999-99-99') + ' ' + (a.hora || '99:99')).localeCompare((b.data || '9999-99-99') + ' ' + (b.hora || '99:99')) ||
    String(a.criado_em || '').localeCompare(String(b.criado_em || '')));
  const agProtocolo = () => 'AG-' + (Math.random().toString(16).slice(2, 8) + '000000').slice(0, 6).toUpperCase();

  const getAgendamentos = () => agSort(read(KEYS.agendamentos, []));

  async function addAgendamento(dados) { // entrada manual da recepção (telefone/balcão)
    dados = dados || {};
    const lista = read(KEYS.agendamentos, []);
    const row = {
      id: 'ag-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      protocolo: dados.protocolo || agProtocolo(),
      nome: dados.nome || 'Cliente',
      telefone: dados.telefone || '',
      veiculo: dados.veiculo || '',
      placa: String(dados.placa || '').toUpperCase(),
      servico: dados.servico || '',
      servico_nome: dados.servico_nome || '',
      data: (typeof dados.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dados.data)) ? dados.data : null,
      hora: dados.hora || '',
      obs: dados.obs || '',
      status: dados.status || 'novo',
      os_numero: null,
      criado_em: new Date().toISOString(),
    };
    lista.push(row);
    write(KEYS.agendamentos, lista);
    return { ...row };
  }

  async function setAgendamentoStatus(id, status, osNumero) {
    const lista = read(KEYS.agendamentos, []);
    const a = lista.find(x => x.id === id);
    if (!a) return null;
    a.status = status;
    if (osNumero != null) a.os_numero = osNumero;
    write(KEYS.agendamentos, lista);
    return { ...a };
  }

  // caminho PÚBLICO (site/agendamento.html) — mesma resposta da RPC agendar_publico
  async function agendarPublico(dados) {
    const row = await addAgendamento({ ...(dados || {}), status: 'novo' });
    return { ok: true, protocolo: row.protocolo, id: row.id };
  }

  const getAllOS = () => read(KEYS.os, []);
  const saveAllOS = (l) => write(KEYS.os, l);
  const getOS = (num) => getAllOS().find(o => o.numero === +num);
  function nextSeq() {
    const n = read(KEYS.seq, 1257) + 1;
    write(KEYS.seq, n);
    return n;
  }

  function updateOS(numero, mut, evento) {
    const list = getAllOS();
    const os = list.find(o => o.numero === +numero);
    if (!os) return null;
    mut(os);
    if (evento) {
      os.eventos.push({ ts: new Date().toISOString(), ...evento });
    }
    saveAllOS(list);
    return os;
  }

  function setStatus(numero, statusId, ator, extra) {
    const st = STATUS.find(s => s.id === statusId);
    const os = updateOS(numero, o => { o.status = statusId; },
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
  }

  function novaOS(dados) {
    const numero = nextSeq();
    const os = {
      numero,
      criada: new Date().toISOString(),
      status: 'fila',
      vin: dados.vin,
      veiculo: dados.veiculo,
      placa: dados.placa || '',
      cliente: dados.cliente || 'Cliente',
      telefone: dados.telefone || '',
      sintoma: dados.sintoma || '',
      tecnico: dados.tecnico || '',
      consultor: 'Paulo Victor de Almeida',
      checkin: dados.checkin || null,      // termo de entrada
      dtcs: [],
      itens: [],                            // itens de diagnóstico (com orçamento embutido)
      qc: null,
      pagamento: null,
      nf: null,
      nps: null,
      chat: [],
      eventos: [{ ts: new Date().toISOString(), tipo: 'abertura', titulo: 'OS aberta', desc: 'Check-in digital concluído', ator: dados.ator || 'Recepção' }],
    };
    const list = getAllOS();
    list.unshift(os);
    saveAllOS(list);
    return os;
  }

  /* ---------- Itens de diagnóstico + orçamento ---------- */
  let itemSeq = 0;
  function novoItem(os, dados, config) {
    const engine = motorDePecas(dados.categoria, (decodeVIN(os.vin).familia), config);
    return {
      id: `${os.numero}-${++itemSeq}-${Date.now() % 10000}`,
      titulo: dados.titulo,
      severidade: dados.severidade,          // 'critico' | 'preventivo' | 'ok'
      nota: dados.nota || '',
      midia: dados.midia || null,            // dataURL thumb (obrigatória p/ crítico/preventivo)
      categoria: engine.categoria,
      pecaDescricao: engine.descricao,
      aw: engine.aw,
      mo: engine.mo,
      niveis: engine.niveis,
      nivelEscolhido: null,                  // definido pelo cliente na aprovação
      aprovacao: dados.severidade === 'ok' ? null : 'pendente',  // pendente|aprovado|recusado
      garantia: null,
    };
  }

  // ISTA → DVI: converte um código do laudo em item de orçamento (o mecânico revisa depois).
  function istaCategoria(cod) {
    const t = ((cod.termo_peca || '') + ' ' + (cod.descricao || '') + ' ' + (cod.sistema || '')).toLowerCase();
    if (/bomba.*[áa]gua|termostat|arrefec|water\s?pump/.test(t)) return 'bomba_agua';
    if (/pastilha|freio\s*diant/.test(t)) return 'freio_d';
    if (/disco/.test(t)) return 'disco_d';
    if (/vela|bobina|igni/.test(t)) return 'vela';
    if (/[óo]leo|filtro de [óo]leo/.test(t)) return 'oleo';
    if (/amortec/.test(t)) return 'amortecedor';
    if (/bieleta|barra estabiliz/.test(t)) return 'bieleta';
    if (/correia|tensor/.test(t)) return 'correia';
    if (/fluido|dot\s?4|sangria/.test(t)) return 'fluido_freio';
    return 'outro';
  }
  function istaTitulo(cod) {
    return String(cod.termo_peca || cod.descricao || cod.codigo || 'Peça do diagnóstico ISTA').slice(0, 90);
  }
  function itemDeIsta(os, cod, config) {
    cod = cod || {};
    config = config || getConfig();
    const titulo = istaTitulo(cod);
    const severidade = cod.critico_seguranca ? 'critico'
      : (cod.severidade === 'critica' || cod.severidade === 'alta') ? 'critico' : 'preventivo';
    const partes = [];
    if (cod.codigo) partes.push('ISTA ' + cod.codigo + (cod.modulo ? ' (' + cod.modulo + ')' : ''));
    if (cod.descricao && cod.descricao !== titulo) partes.push(cod.descricao);
    if (cod.causa_provavel) partes.push('Causa provável: ' + cod.causa_provavel);
    if (cod.exige_medicao && cod.medicao) partes.push('Medir antes: ' + cod.medicao);
    if (cod.acao) partes.push('Ação: ' + cod.acao);
    partes.push('Lançado do laudo ISTA — revise peça, nível e preço antes de enviar ao cliente.');
    const it = novoItem(os, { titulo, severidade, nota: partes.join(' · '), midia: 'ista', categoria: istaCategoria(cod) }, config);
    it.origem = 'ista:' + (cod.codigo || titulo);
    return it;
  }

  /* ---------- Totais ---------- */
  function itemPreco(item, nivel) {
    const nv = item.niveis[nivel || item.nivelEscolhido || 'original'];
    return (nv ? nv.preco : 0) + item.mo;
  }
  function totalOS(os, apenasAprovados) {
    return os.itens
      .filter(i => i.severidade !== 'ok')
      .filter(i => !apenasAprovados || i.aprovacao === 'aprovado')
      .reduce((s, i) => s + itemPreco(i), 0);
  }
  function custoOS(os) {
    return os.itens.filter(i => i.aprovacao === 'aprovado').reduce((s, i) => {
      const nv = i.niveis[i.nivelEscolhido || 'original'];
      return s + (nv ? nv.custo : 0);
    }, 0);
  }

  /* ============================================================
     7 · Pix — BR Code EMV com CRC16 real (QR simulado no UI)
     ============================================================ */
  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  const emv = (id, v) => id + String(v.length).padStart(2, '0') + v;
  // Campos 59 (nome do recebedor) e 60 (cidade) do EMV: precisam ser da OFICINA que
  // está cobrando. Estavam fixos com a marca do cliente-piloto — num sistema
  // white-label isso faz a cobrança de toda oficina sair com o nome de outra.
  // ASCII maiúsculo, sem acento, dentro dos limites do padrão (25 e 15).
  function emvTexto(s, max, padrao) {
    const t = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim();
    return (t || padrao).slice(0, max).trim();
  }
  function pixPayload(valor, txid) {
    const cfg = getConfig();
    const of = cfg.oficina || {};
    const mai = emv('00', 'br.gov.bcb.pix') + emv('01', of.pixChave);
    const nome = emvTexto(of.nome, 25, 'OFICINA');
    const cidade = emvTexto((of.cidade || '').split('/')[0], 15, 'BRASIL');
    let p = emv('00', '01') + emv('26', mai) + emv('52', '0000') + emv('53', '986') +
      emv('54', valor.toFixed(2)) + emv('58', 'BR') + emv('59', nome) +
      emv('60', cidade) + emv('62', emv('05', (txid || 'LEXOS').slice(0, 20)));
    p += '6304';
    return p + crc16(p);
  }

  /* ============================================================
     8 · Seeds de demonstração
     ============================================================ */
  function seed() {
    if (read(KEYS.seedv, false)) return;
    const cfg = getConfig();

    const vins = {
      macan: fixVIN('WP1AB2A50' + 'ML140277'),
      a4:   fixVIN('WAUZZZF40' + 'MA061933'),
      q5:   fixVIN('WA1CBAFY7' + 'P2060481'),
    };
    upsertVehicle({ vin: vins.macan, ...decodeVIN(vins.macan), placa: 'RQV-2D47', cor: 'Cinza Vulcano',  km: 48500, cliente: 'Ricardo Almeida', telefone: '(27) 99900-0000', cofre: ['Manual do proprietário.pdf', 'Nota da chave codificada.pdf', 'Laudo cautelar 2024.pdf'] });
    upsertVehicle({ vin: vins.a4,  ...decodeVIN(vins.a4),  placa: 'SBX-9F31', cor: 'Branco Ibis', km: 61200, cliente: 'Marcelo Costa',  telefone: '(27) 98811-2233', cofre: ['Manual do proprietário.pdf'] });
    upsertVehicle({ vin: vins.q5,   ...decodeVIN(vins.q5),   placa: 'RWK-7B12', cor: 'Branco Ibis', km: 21300, cliente: 'Ricardo Almeida', telefone: '(27) 99900-0000', cofre: [] });

    itemSeq = 0;

    /* OS 1258 — do Ricardo (usuário demo do app): aguardando aprovação */
    const os1 = novaOS({
      vin: vins.macan, veiculo: 'Porsche Macan S (95B)', placa: 'RQV-2D47',
      cliente: 'Ricardo Almeida', telefone: '(27) 99900-0000',
      sintoma: 'Revisão dos 50.000 km + barulho seco na dianteira ao passar em lombadas.',
      tecnico: 'Diego Ramos',
      checkin: {
        ts: new Date(Date.now() - 26 * 3600e3).toISOString(),
        odometro: 48500, combustivel: 60,
        itens: { documento: true, chaveReserva: false, triangulo: true, macaco: true, estepe: true },
        luzes: ['Service em 1.500 km'],
        danos: [{ x: 22, y: 58, nota: 'Risco leve para-choque diant. esq.' }, { x: 70, y: 42, nota: 'Amassado porta tras. dir. (~2cm)' }],
        fotos: 8, assinatura: true,
      },
      ator: 'Paulo Victor de Almeida',
    });
    updateOS(os1.numero, o => {
      o.dtcs = ['480A2A — Chassis: bieleta/estabilizadora', 'CC-ID 281 — Service próximo'];
      o.itens = [
        novoItem(o, { titulo: 'Bieletas da barra estabilizadora com folga', severidade: 'critico', nota: 'Folga audível confirmada no elevador — origem do barulho relatado.', midia: 'demo', categoria: 'bieleta' }, cfg),
        novoItem(o, { titulo: 'Revisão 50.000 km — óleo e filtros', severidade: 'preventivo', nota: 'Plano CBS: óleo 5W-30 + filtro. Inspeção 60 itens inclusa.', midia: 'demo', categoria: 'oleo' }, cfg),
        novoItem(o, { titulo: 'Velas de ignição no limite', severidade: 'preventivo', nota: 'Eletrodo com desgaste — recomendada troca no B48 a 50 mil.', midia: 'demo', categoria: 'vela' }, cfg),
        novoItem(o, { titulo: 'Pastilhas dianteiras — 40% restante', severidade: 'preventivo', nota: 'Ainda seguras; monitorar. Pode adiar.', midia: 'demo', categoria: 'freio_d' }, cfg),
        novoItem(o, { titulo: 'Freios traseiros e pneus', severidade: 'ok', nota: 'Dentro do padrão.', midia: 'demo', categoria: 'outro' }, cfg),
      ];
      o.eventos.push(
        { ts: new Date(Date.now() - 24 * 3600e3).toISOString(), tipo: 'status', titulo: 'Diagnóstico', desc: 'DVI concluído: 1 crítico, 3 preventivos', ator: 'Diego Ramos' },
        { ts: new Date(Date.now() - 22 * 3600e3).toISOString(), tipo: 'status', titulo: 'Aguardando aprovação', desc: 'Orçamento enviado ao cliente (push + WhatsApp)', ator: 'Sistema' },
      );
      o.status = 'aprovacao';
    });

    /* OS 1259 — Marcelo: em execução (tracking ao vivo no kanban) */
    const os2 = novaOS({
      vin: vins.a4, veiculo: 'Audi A4 45 TFSI quattro (B9)', placa: 'SBX-9F31',
      cliente: 'Marcelo Costa', telefone: '(27) 98811-2233',
      sintoma: 'Luz de arrefecimento acendeu na serra. Perda de fluido visível.',
      tecnico: 'Régis Souza',
      checkin: { ts: new Date(Date.now() - 50 * 3600e3).toISOString(), odometro: 61200, combustivel: 35, itens: { documento: true, chaveReserva: true, triangulo: true, macaco: true, estepe: false }, luzes: ['Temperatura do motor'], danos: [], fotos: 9, assinatura: true },
      ator: 'Paulo Victor de Almeida',
    });
    updateOS(os2.numero, o => {
      o.dtcs = ['002E81 — Bomba de refrigerante: vazão abaixo do esperado'];
      const it = novoItem(o, { titulo: 'Bomba d’água elétrica com falha', severidade: 'critico', nota: 'DTC confirmado + vazamento no corpo da bomba.', midia: 'demo', categoria: 'bomba_agua' }, cfg);
      it.aprovacao = 'aprovado'; it.nivelEscolhido = 'oem';
      const it2 = novoItem(o, { titulo: 'Fluido de arrefecimento + sangria', severidade: 'critico', nota: 'Reposição obrigatória com a troca.', midia: 'demo', categoria: 'fluido_freio' }, cfg);
      it2.aprovacao = 'aprovado'; it2.nivelEscolhido = 'original';
      o.itens = [it, it2];
      o.aprovadoEm = new Date(Date.now() - 40 * 3600e3).toISOString();
      o.aceite = { assinatura: true, ip: '187.36.170.42', hash: 'a3f81c…9d02', ts: o.aprovadoEm };
      o.eventos.push(
        { ts: new Date(Date.now() - 46 * 3600e3).toISOString(), tipo: 'status', titulo: 'Diagnóstico', desc: 'Bomba d’água elétrica condenada', ator: 'Régis Souza' },
        { ts: new Date(Date.now() - 40 * 3600e3).toISOString(), tipo: 'aceite', titulo: 'Orçamento aprovado', desc: 'Cliente aprovou 2 de 2 itens (nível OEM)', ator: 'Marcelo Costa' },
        { ts: new Date(Date.now() - 39 * 3600e3).toISOString(), tipo: 'status', titulo: 'Aguardando peça', desc: 'Pierburg via Importador BR — rastreio #BR-88412', ator: 'Sistema' },
        { ts: new Date(Date.now() - 6 * 3600e3).toISOString(), tipo: 'status', titulo: 'Em execução', desc: 'Peça recebida e conferida. Serviço iniciado no box 2.', ator: 'Régis Souza' },
        { ts: new Date(Date.now() - 2 * 3600e3).toISOString(), tipo: 'update', titulo: 'Micro-update do técnico', desc: '📷 Bomba antiga removida — corpo trincado visível vs. peça nova Pierburg.', ator: 'Régis Souza' },
      );
      o.status = 'execucao';
    });

    /* OS 1240 — histórico concluído do Ricardo (freios) */
    const os3 = novaOS({
      vin: vins.macan, veiculo: 'Porsche Macan S (95B)', placa: 'RQV-2D47',
      cliente: 'Ricardo Almeida', telefone: '(27) 99900-0000',
      sintoma: 'Troca de pastilhas e discos dianteiros.',
      tecnico: 'Diego Ramos',
      checkin: { ts: '2026-06-14T08:40:00', odometro: 46900, combustivel: 45, itens: { documento: true, chaveReserva: false, triangulo: true, macaco: true, estepe: true }, luzes: [], danos: [], fotos: 8, assinatura: true },
      ator: 'Paulo Victor de Almeida',
    });
    updateOS(os3.numero, o => {
      o.numero = 1240; // histórico
      const a = novoItem(o, { titulo: 'Discos dianteiros no limite mínimo', severidade: 'critico', midia: 'demo', categoria: 'disco_d' }, cfg);
      const b = novoItem(o, { titulo: 'Pastilhas dianteiras gastas', severidade: 'critico', midia: 'demo', categoria: 'freio_d' }, cfg);
      a.aprovacao = b.aprovacao = 'aprovado';
      a.nivelEscolhido = 'original'; b.nivelEscolhido = 'original';
      const venc = new Date('2027-06-15');
      a.garantia = b.garantia = { inicio: '2026-06-15', fim: venc.toISOString().slice(0, 10) };
      o.itens = [a, b];
      o.status = 'entregue';
      o.qc = { torques: true, resetService: true, testDrive: '4,2 km', assinaturaTecnico: 'Diego Ramos', assinaturaInspetor: 'Régis Souza', ts: '2026-06-15T16:10:00' };
      o.pagamento = { metodo: 'Pix', valor: totalOS(o, true), ts: '2026-06-15T17:22:00', txid: 'EVX1240' };
      o.nf = { numero: 'NFS-e 2026/000412', ts: '2026-06-15T17:23:00' };
      o.nps = 10;
      o.eventos.push({ ts: '2026-06-15T17:30:00', tipo: 'entrega', titulo: 'Veículo entregue', desc: 'Checkout concluído · NPS 10', ator: 'Paulo Victor de Almeida' });
    });

    // seq segue do 1259
    write(KEYS.seq, 1259);
    write(KEYS.seedv, true);
  }

  /* Seeds da Agenda — guarda própria: aparece também em demos que já
     tinham sido semeadas antes de a Agenda existir. Datas relativas a hoje. */
  function seedAgenda() {
    if (read(KEYS.seedAgenda, false)) return;
    const dia = (off) => { const t = new Date(); t.setDate(t.getDate() + off); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
    const lista = read(KEYS.agendamentos, []);
    [
      { nome: 'Ana Beatriz Rocha', telefone: '(27) 99123-4567', veiculo: 'Audi A4 45 TFSI quattro (B9)', placa: 'SBC-4A18', servico: 'diagnostico', servico_nome: 'Diagnóstico', data: dia(0), hora: '15:30', obs: 'Luz do motor acesa desde ontem — perde potência na serra.', status: 'novo' },
      { nome: 'Ricardo Almeida', telefone: '(27) 99900-0000', veiculo: 'Porsche Macan S (95B)', placa: 'RQV-2D47', servico: 'manutencao', servico_nome: 'Manutenção', data: dia(1), hora: '09:00', obs: 'Revisão dos 50.000 km.', status: 'confirmado' },
      { nome: 'Juliana Freire', telefone: '(27) 98876-1122', veiculo: 'Audi Q5 Sportback 55 TFSIe (FY)', placa: 'RUX-8C33', servico: 'suspensao', servico_nome: 'Suspensão', data: dia(3), hora: '10:00', obs: 'Batida seca no quebra-molas, só do lado direito.', status: 'novo' },
    ].forEach((a, i) => lista.push({
      id: 'ag-seed-' + (i + 1), protocolo: 'AG-DEMO' + (i + 1), os_numero: null,
      criado_em: new Date(Date.now() - (3 - i) * 3600e3).toISOString(), ...a,
    }));
    write(KEYS.agendamentos, lista);
    write(KEYS.seedAgenda, true);
  }

  /* ---------- Migração lazy: clientes derivados das OS (idempotente) ---------- */
  function ensureClients() {
    const porData = (l) => [...l].sort((a, b) => new Date(a.criada) - new Date(b.criada));

    // 1 · veículo herda o telefone do check-in mais recente do VIN (dados legados)
    const veics = getVehicles();
    let vMudou = false;
    veics.forEach(v => {
      if (normTel(v.telefone)) return;
      const os = porData(getAllOS()).reverse().find(o => o.vin === v.vin && normTel(o.telefone));
      if (os) { v.telefone = os.telefone; vMudou = true; }
    });
    if (vMudou) saveVehicles(veics);

    // 2 · registros de cliente derivados das OS (mais antiga → mais nova; último nome vence)
    const lista = getClientes();
    let cMudou = false;
    porData(getAllOS()).forEach(o => {
      const t = normTel(o.telefone);
      if (!t) return;
      let c = lista.find(x => normTel(x.telefone) === t);
      if (!c) {
        c = { nome: o.cliente, telefone: o.telefone, senha: null, convite: novoToken(lista),
              desde: new Date(o.criada).getFullYear(), criadoEm: new Date().toISOString(), ativadoEm: null };
        lista.push(c); cMudou = true;
      } else if (o.cliente && c.nome !== o.cliente) { c.nome = o.cliente; cMudou = true; }
    });

    // 3 · personas demo (fill-only: nunca sobrescreve senha já criada)
    [
      { tel: '27999000000', convite: 'demo-ricardo', senha: enc('demo2026'), desde: 2021 },
      { tel: '27988112233', convite: 'demo-marcelo', senha: null, desde: 2024 },
    ].forEach(d => {
      const c = lista.find(x => normTel(x.telefone) === d.tel);
      if (!c) return;
      if (c.convite !== d.convite && !c.ativadoEm) { c.convite = d.convite; cMudou = true; }
      if (!c.senha && d.senha) { c.senha = d.senha; c.ativadoEm = new Date().toISOString(); cMudou = true; }
      if (c.desde !== d.desde) { c.desde = d.desde; cMudou = true; }
    });
    if (cMudou) saveClientes(lista);
  }

  /* ---------- Pendências (itens recusados → régua) ---------- */
  function pendencias(telefone) {
    const t = normTel(telefone);
    const out = [];
    getAllOS().forEach(o => {
      if (t && normTel(o.telefone) !== t) return;
      o.itens.forEach(i => {
        if (i.aprovacao === 'recusado') out.push({ os: o.numero, veiculo: o.veiculo, placa: o.placa, item: i });
      });
    });
    return out;
  }

  /* ---------- Chat OS ---------- */
  function chatSend(numero, de, texto) {
    return updateOS(numero, o => o.chat.push({ ts: new Date().toISOString(), de, texto }),
      { tipo: 'chat', titulo: `Mensagem de ${de}`, desc: texto.slice(0, 80), ator: de });
  }

  const brl = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fdt = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fd = (iso) => new Date(iso).toLocaleDateString('pt-BR');

  /* ---------- Ações do cliente no app (mesma via nos dois modos) ---------- */
  function aprovarOrcamento(numero, decisoes, aceite) {
    const alvo = getOS(numero);
    if (!alvo) return null;
    const lista = Object.values(decisoes || {});
    const aprovadosN = lista.filter(d => d.aprovado).length;
    const recusadosN = lista.length - aprovadosN;
    updateOS(numero, o => {
      o.itens.forEach(i => {
        if (i.severidade === 'ok') return;
        const d = decisoes[i.id];
        if (!d) return;
        i.nivelEscolhido = d.nivel || 'original';
        i.aprovacao = d.aprovado ? 'aprovado' : 'recusado';
      });
      o.aceite = aceite;
      o.aprovadoEm = aceite.ts;
    }, { tipo: 'aceite', titulo: 'Orçamento aprovado pelo app', desc: `${aprovadosN} aprovado(s), ${recusadosN} adiado(s) — assinatura digital registrada.`, ator: alvo.cliente });
    if (aprovadosN) setStatus(numero, 'execucao', 'Sistema', 'Itens aprovados liberados para o box.');
    return getOS(numero);
  }
  // Regra de negócio do pagamento — muta a OS `o` (formato da NF + garantias +
  // evento de entrega) e devolve true/false. IDEMPOTENTE: se a OS já tem
  // pagamento, é no-op e devolve false. Isso sobrevive ao refetch+reaplica do
  // updateOS de nuvem num conflito de versão (não sobrescreve pagamento já
  // confirmado no servidor nem duplica o evento). Fonte única, delegada pelo
  // registrarPagamento local e pelo do adaptador de nuvem (werk-cloud.js).
  function aplicarPagamento(o, opts, agora, cfgG) {
    if (o.pagamento) return false;
    o.pagamento = { metodo: opts.metodo || 'Pix', valor: opts.valor, ts: agora.toISOString(), txid: 'EVX' + o.numero };
    if (opts.retirada) o.pagamento.retirada = opts.retirada;
    o.nf = { numero: `NFS-e ${agora.getFullYear()}/${String(400 + o.numero % 100).padStart(6, '0')}`, ts: agora.toISOString() };
    const fim = new Date(agora); fim.setMonth(fim.getMonth() + (cfgG.peca ?? 12));
    o.itens.forEach(i => { if (i.aprovacao === 'aprovado') i.garantia = { inicio: agora.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) }; });
    o.eventos.push({ ts: agora.toISOString(), tipo: 'entrega', titulo: 'Pagamento confirmado', desc: opts.desc || `Pix ${brl(opts.valor)} · NF emitida · garantia ativada`, ator: opts.ator || 'Sistema' });
    return true;
  }
  // Registra pagamento + NF + garantias de uma OS num único ponto — usado tanto
  // pelo checkout do painel quanto pelo pagamento no app do cliente, para não
  // divergir o formato da NF nem as regras de garantia. A idempotência real está
  // dentro de aplicarPagamento (no mutator); o retorno rápido aqui é só um atalho.
  // opts: { valor, metodo, retirada, ator, desc }.
  function registrarPagamento(numero, opts) {
    opts = opts || {};
    const alvo = getOS(numero);
    if (!alvo || alvo.pagamento) return null; // já pago/inexistente: no-op → o chamador ajusta a mensagem
    const cfgG = getConfig().garantiaMeses;
    const agora = new Date();
    const valor = opts.valor != null ? opts.valor : totalOS(alvo, true);
    // guarda + evento DENTRO do mutator (sem 3º param); captura se aplicou de fato
    // — se em concorrência o mutator virar no-op, devolve null (chamador não duplica)
    let aplicado = false;
    updateOS(numero, o => { aplicado = aplicarPagamento(o, { metodo: opts.metodo, valor, retirada: opts.retirada, desc: opts.desc, ator: opts.ator }, agora, cfgG); });
    return aplicado ? getOS(numero) : null;
  }
  function chatCliente(numero, texto) {
    const o = getOS(numero);
    return o ? chatSend(numero, o.cliente, texto) : null;
  }
  function avaliarNps(numero, nota) {
    const o = getOS(numero);
    if (!o) return null;
    return updateOS(numero, os => { os.nps = +nota; }, { tipo: 'update', titulo: `NPS ${nota}/10`, desc: 'Avaliação do cliente registrada.', ator: o.cliente });
  }

  /* ============================================================
     8 · IA de check-in — visão real das fotos + consulta de placa
     ------------------------------------------------------------
     analisarFotos() tenta a VISÃO REAL na função serverless
     /api/analisar-fotos (usa a ANTHROPIC_API_KEY configurada na
     Vercel) e cai no modo ASSISTIDO (heurística determinística) se a
     chave/endpoint não estiver disponível — mesmo formato de retorno,
     nada quebra na demo local. A consulta de placa segue o mesmo
     padrão: tenta a API real (/api/placa) e cai para a base local.
     [API: visão computacional · consulta de placa BR]
     ============================================================ */
  const CHECKLIST_ITENS = ['Documento (CRLV)', 'Chave reserva', 'Triângulo', 'Macaco/chave de roda', 'Estepe/kit reparo', 'Tapetes originais'];
  const AVARIAS_POOL = [
    { x: 26, y: 42, nota: 'Risco no para-choque dianteiro (lado esq.)', sev: 'media' },
    { x: 72, y: 46, nota: 'Amassado leve na porta traseira (lado dir.)', sev: 'media' },
    { x: 50, y: 20, nota: 'Trinca no para-brisa (canto passageiro)', sev: 'alta' },
    { x: 84, y: 64, nota: 'Roda dianteira direita raspada no meio-fio', sev: 'baixa' },
    { x: 33, y: 70, nota: 'Desgaste irregular no pneu dianteiro esq.', sev: 'baixa' },
  ];
  const LUZES_POOL = ['Service', 'TPMS', 'Check Engine', 'ABS', 'Airbag', 'EPB'];

  function _hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

  // Análise assistida das fotos (fallback determinístico, sem custo/latência).
  function _analisarAssistida(fotos, ctx) {
    ctx = ctx || {};
    const n = Object.keys(fotos || {}).length;
    const h = _hash((ctx.vin || ctx.placa || 'EVX') + ':' + n);
    const kmAtual = ctx.km ? +ctx.km : (18000 + (h % 92000));
    const combustivel = [15, 25, 35, 50, 60, 70, 85][h % 7];
    const luzes = (h % 4 === 0) ? [] : LUZES_POOL.slice(0, 1 + (h % 2));
    const nAvarias = h % 3;                          // 0..2 avarias
    const avarias = AVARIAS_POOL.slice(0, nAvarias).map(a => ({ ...a }));
    const faltando = [];                             // índices da CHECKLIST_ITENS ausentes
    if (h % 5 === 0) faltando.push(2);               // triângulo
    if (h % 7 === 0) faltando.push(4);               // estepe/kit
    const itens = CHECKLIST_ITENS.map((_, i) => !faltando.includes(i));
    return {
      modo: 'assistida',                             // 'ia' quando a visão real responde
      km: kmAtual, kmFonte: 'assistida', kmRecepcao: (ctx.km ? +ctx.km : null),
      combustivel, combustivelLido: true, luzes, avarias, itens,
      itensFaltantes: faltando.map(i => CHECKLIST_ITENS[i]),
      itensNaoVerificados: [],                        // mesmo formato do modo IA
      confianca: 0.72 + (h % 18) / 100,
      fotosAnalisadas: n,
    };
  }

  // Lê as fotos do check-in. Tenta a visão REAL (função serverless
  // /api/analisar-fotos, que usa a ANTHROPIC_API_KEY do servidor) e cai
  // no modo assistido se a chave/endpoint não estiver disponível (demo
  // local em file://, deploy sem a variável, offline). Mesmo formato.
  /* O corpo de uma função serverless na Vercel é limitado a ~4,5 MB — acima disso
     ela devolve 413 FUNCTION_PAYLOAD_TOO_LARGE e a IA nem chega a rodar. Um tour
     de 8 fotos de iPhone passa disso com facilidade quando o conteúdo tem textura
     (motor sujo, cascalho, pouca luz): medido, 8 fotos ruidosas dão ~5,9 MB em
     base64 contra ~0,4 MB de uma lataria lisa. Como isso depende da FOTO, a falha
     era intermitente — o pior tipo. Encolhemos só a CÓPIA que vai para a IA; a
     foto guardada no check-in e impressa no Termo continua na resolução cheia. */
  const IA_TETO = 3.8 * 1024 * 1024;                 // margem sobre o limite real (medido: 4 MB passa, 5 MB não)
  const IA_ESCADA = [[1400, 0.68], [1200, 0.60], [1024, 0.55], [880, 0.50]];

  function _recomprimir(dataUrl, lado, q) {
    return new Promise((resolve) => {
      if (typeof Image !== 'function' || typeof document === 'undefined') { resolve(dataUrl); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, lado / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * k));
          c.height = Math.max(1, Math.round(img.height * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const u = c.toDataURL('image/jpeg', q);
          resolve(u && u.length > 32 ? u : dataUrl);
        } catch (_) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // Devolve um conjunto de fotos que CABE no envio. Só recomprime se precisar.
  async function _caberNoEnvio(fotos) {
    const chaves = Object.keys(fotos || {});
    if (!chaves.length) return { fotos, reduzido: false };
    let atual = fotos;
    if (JSON.stringify(atual).length <= IA_TETO) return { fotos: atual, reduzido: false };
    for (let i = 0; i < IA_ESCADA.length; i++) {
      const menor = {};
      for (const k of chaves) menor[k] = await _recomprimir(fotos[k], IA_ESCADA[i][0], IA_ESCADA[i][1]);
      atual = menor;
      if (JSON.stringify(atual).length <= IA_TETO) return { fotos: atual, reduzido: true };
    }
    return { fotos: atual, reduzido: true, aindaGrande: true };
  }

  async function analisarFotos(fotos, ctx) {
    ctx = ctx || {};
    let motivo = null;
    try {
      const cabe = await _caberNoEnvio(fotos);
      const r = await fetch('/api/analisar-fotos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fotos: cabe.fotos, ctx }),
      });
      if (r.ok) {
        const d = await r.json();
        // { modo:'ia', km, combustivel, luzes, avarias, itens, itensFaltantes, confianca, fotosAnalisadas }
        if (d && d.ok) return Object.assign(d, { reduzido: !!cabe.reduzido });
        motivo = (d && d.erro) || 'a visão não respondeu';
      } else if (r.status === 404) {
        motivo = null;                               // demo local / sem função publicada: nada a explicar
      } else {
        motivo = r.status === 413
          ? 'as fotos ficaram grandes demais para o envio'
          : 'a visão respondeu ' + r.status;
      }
    } catch (_) { motivo = null; /* offline / file:// → modo assistido, sem alarde */ }
    // Cair no assistido é aceitável; cair CALADO não é — quem preenche a OS precisa
    // saber que aqueles campos não vieram de uma leitura real das fotos.
    return Object.assign(_analisarAssistida(fotos, ctx), { motivo });
  }

  /* ============================================================
     DICIONÁRIO DE CÓDIGOS DE FALHA — camada de APRENDIZADO
     ------------------------------------------------------------
     Faz a IA consumir MENOS a cada leitura: todo laudo lido pela
     IA ENSINA o dicionário (código → descrição pt-BR, sistema,
     severidade, termo de peça). Códigos já conhecidos passam a
     ser decodificados LOCALMENTE (sem IA, custo ZERO) e só os
     inéditos vão para a IA. Vem semeado com o banco OBD-II
     MUNDIAL (SAE J2012/ISO 15031-6 — ~2 mil códigos genéricos
     P (motor/transmissão) e U (rede/comunicação) que qualquer
     scanner emite: Autel, Launch, ISTA, ELM327…); os códigos
     genéricos C/B e os proprietários (hex de fabricante etc.) são
     aprendidos dos laudos reais lidos pela IA.
     Fica no navegador (localStorage) — é um cache de custo, não
     dado do cliente; por isso o adaptador de nuvem o delega ao
     módulo local sem tabela dedicada.
     ============================================================ */
  const KDIC = (DEMO ? 'evx.demo' : 'evx') + '.ista.dic'; // aprendidos: { "8040D2": {descricao, sistema, …} }
  let _seedObd = null;                 // banco mundial já carregado (lazy)
  let _seedObdPromise = null;

  // Sistema a partir do prefixo SAE J2012 (letra de família + origem).
  function dicSistemaSae(cod) {
    const L = String(cod || '').toUpperCase()[0];
    if (L === 'P') return 'motor';               // Powertrain (motor/transmissão)
    if (L === 'C') return 'freios/estabilidade'; // Chassis (ABS/DSC, direção, suspensão)
    if (L === 'B') return 'carroceria';          // Body (airbag/SRS refinado por palavra-chave)
    if (L === 'U') return 'eletrica';            // Network/comunicação (barramento CAN/LIN)
    return 'outro';
  }
  // Palavras que denunciam sistema de segurança na descrição (reforço p/ leitura local).
  function descCritica(desc) {
    return /airbag|\bsrs\b|restraint|cinto|pretens|freio|\babs\b|\bdsc\b|\bdxc\b|est?abilidad|dire[çc][aã]o|steering|\beps\b|brake/i.test(String(desc || ''));
  }

  // Carrega (uma vez) o banco OBD-II mundial. Offline/file:// → {} (segue só com
  // os aprendidos + heurística de prefixo). cache:'force-cache' porque é estático.
  async function carregarSeedObd() {
    if (_seedObd) return _seedObd;
    if (_seedObdPromise) return _seedObdPromise;
    _seedObdPromise = (async () => {
      try {
        const r = await fetch('assets/data/dtc-obd.json', { cache: 'force-cache' });
        if (r.ok) { const j = await r.json(); if (j && typeof j === 'object') { _seedObd = j; return j; } }
      } catch (_) { /* sem rede / file:// */ }
      _seedObd = {}; return _seedObd;
    })();
    return _seedObdPromise;
  }

  function dicAprendidos() { return read(KDIC, {}) || {}; }

  // Consulta síncrona de UM código: aprendido (pt-BR, do balcão) > banco mundial
  // (EN, genérico) > null. O banco só aparece depois de carregarSeedObd().
  function dicGet(cod) {
    const c = String(cod || '').toUpperCase().trim();
    if (!c) return null;
    const ap = dicAprendidos()[c];
    if (ap && ap.descricao) return { codigo: c, fonte: 'aprendido', ...ap };
    const seed = _seedObd && _seedObd[c];
    if (seed) return { codigo: c, descricao: seed, sistema: dicSistemaSae(c), formato: /^[PBCU]\d/.test(c) ? 'sae' : 'desconhecido', fonte: 'banco' };
    return null;
  }

  // Aprende com um laudo já lido pela IA. Só entra o que a IA TRANSCREVEU (não
  // leitura ambígua de foto). Reaproveita o que já sabia quando o campo vier vazio.
  function dicAprender(codigos) {
    if (!Array.isArray(codigos) || !codigos.length) return { novos: 0, total: 0 };
    const dic = dicAprendidos();
    let novos = 0;
    for (const c of codigos) {
      if (!c || typeof c !== 'object') continue;
      const cod = String(c.codigo || '').toUpperCase().trim();
      if (!cod || cod === '—' || !c.descricao) continue;
      if (c.caractere_ambiguo) continue;                 // não fixa leitura duvidosa
      const antes = dic[cod];
      dic[cod] = {
        descricao: String(c.descricao).slice(0, 240),
        sistema: c.sistema || (antes && antes.sistema) || dicSistemaSae(cod),
        severidade: c.severidade || (antes && antes.severidade) || 'media',
        termo_peca: c.termo_peca || (antes && antes.termo_peca) || null,
        formato: c.formato || (antes && antes.formato) || null,
        modulo: c.modulo || (antes && antes.modulo) || null,
        critico_seguranca: !!(c.critico_seguranca || (antes && antes.critico_seguranca)),
        vezes: ((antes && antes.vezes) || 0) + 1,
      };
      if (!antes) novos++;
    }
    write(KDIC, dic);
    return { novos, total: Object.keys(dic).length };
  }

  function dicStats() {
    const aprendidos = Object.keys(dicAprendidos()).length;
    const banco = _seedObd ? Object.keys(_seedObd).length : 0;
    return { aprendidos, banco, total: aprendidos + banco };
  }
  function dicDump() { return { ...dicAprendidos() }; }   // cópia p/ o visualizador em Configurações
  function dicLimpar() { write(KDIC, {}); return { aprendidos: 0 }; }

  // Decodifica uma lista de códigos SÓ com o dicionário (sem IA). Devolve o que
  // conseguiu + o que ficou de fora, para o painel decidir se cai na IA.
  async function decodeLocal(codigos, ctx) {
    await carregarSeedObd();
    const lista = (Array.isArray(codigos) ? codigos : [])
      .map(x => (typeof x === 'string' ? x : (x && x.codigo) || ''))
      .map(s => String(s).toUpperCase().trim()).filter(Boolean);
    const vistos = new Set(); const conhecidos = []; const desconhecidos = [];
    for (const cod of lista) {
      if (vistos.has(cod)) continue; vistos.add(cod);
      const hit = dicGet(cod);
      if (!hit) { desconhecidos.push(cod); continue; }
      const critico = !!hit.critico_seguranca || descCritica(hit.descricao);
      conhecidos.push({
        codigo: cod,
        formato: hit.formato || (/^[PBCU]\d/.test(cod) ? 'sae' : (/^[0-9A-F]{4,6}$/.test(cod) ? 'hex_bmw' : 'desconhecido')),
        modulo: hit.modulo || null,
        descricao: hit.descricao || 'Falha registrada',
        sistema: hit.sistema || dicSistemaSae(cod),
        severidade: critico ? 'alta' : (hit.severidade || 'media'),
        tipo: 'indefinido', critico_seguranca: critico, caractere_ambiguo: false,
        exige_medicao: true, medicao: null,
        termo_peca: hit.termo_peca || null, causa_provavel: '', acao: '',
        fonte_dic: hit.fonte,
      });
    }
    return { conhecidos, desconhecidos, total: vistos.size, cobertura: vistos.size ? conhecidos.length / vistos.size : 0 };
  }

  // Monta um laudo (mesmo formato do da IA) a partir da leitura LOCAL — renderiza
  // igual, mas sem causa-raiz profunda (isso continua sendo trabalho da IA, via
  // "aprofundar com IA"). Usado quando TODOS os códigos já são conhecidos.
  function montarLaudoLocal(dec, ctx) {
    ctx = ctx || {};
    const codigos = (dec && dec.conhecidos) || [];
    const temCritico = codigos.some(c => c.critico_seguranca);
    return {
      ok: true, modo: 'dicionario', eh_ista: true, legivel: true,
      recaptura_necessaria: false, motivo_recaptura: null,
      veiculo: { modelo: ctx.modelo || null, chassi: null, km: null },
      resumo_executivo: codigos.length + ' código(s) decodificados pelo dicionário local — leitura sem custo de IA.'
        + (temCritico ? ' Há código de sistema de segurança: confirme e meça antes de orçar.' : '')
        + ' Para separar causa-raiz de consequência, use “aprofundar com IA”.',
      causa_raiz_provavel: null,
      requer_confirmacao_profissional: temCritico,
      avisos_seguranca: temCritico ? ['Há código de sistema de segurança (airbag/freio/direção). Não libere o veículo — confirme e meça antes de qualquer ação.'] : [],
      codigos,
      codigos_omitidos: 0,
      sistemas_afetados: [...new Set(codigos.map(c => c.sistema))],
      prioridades: [],
      proximos_passos: (dec && dec.desconhecidos && dec.desconhecidos.length)
        ? ['Ainda sem catálogo: ' + dec.desconhecidos.join(', ') + ' — leia com IA para decodificar e ensinar o dicionário.'] : [],
      observacoes: 'Leitura local pelo dicionário (banco OBD-II mundial + aprendizado da oficina). Descrições de códigos ainda não revisados pela IA podem vir em inglês.',
      confianca: 0.75, anexos: 0, modo_dicionario: true,
    };
  }

  // Atalho para o painel: decodifica local e, se cobriu 100%, devolve o laudo
  // pronto (custo zero); senão devolve o mapa de cobertura para cair na IA.
  async function lerLocal(codigos, ctx) {
    const dec = await decodeLocal(codigos, ctx);
    if (dec.total && !dec.desconhecidos.length) return montarLaudoLocal(dec, ctx);
    return { ok: false, cobertura: dec.cobertura, conhecidos: dec.conhecidos.length, desconhecidos: dec.desconhecidos, total: dec.total };
  }

  // Perito de diagnóstico do scanner: manda os anexos (fotos/PDF) ou o texto
  // extraído para a função serverless /api/analisar-ista (usa a ANTHROPIC_API_KEY).
  // Sem chave/endpoint (demo local), devolve um laudo de exemplo para a tela.
  async function analisarIsta(arquivos, ctx, texto) {
    ctx = ctx || {};
    try {
      const r = await fetch('/api/analisar-ista', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ arquivos: arquivos || [], texto: texto || '', ctx }),
      });
      if (r.ok) { const d = await r.json(); if (d && d.ok) return d; }
    } catch (_) { /* sem endpoint / offline → laudo demo */ }
    return _istaDemo(ctx);
  }
  function _istaDemo(ctx) {
    return {
      ok: true, modo: 'demo', eh_ista: true, legivel: true, recaptura_necessaria: false, motivo_recaptura: null,
      veiculo: { modelo: (ctx && ctx.modelo) || 'Veículo', chassi: null, km: null },
      resumo_executivo: 'Exemplo (modo demonstração — a IA real roda em produção com a chave da Vercel). Padrão clássico: subtensão de alimentação parece ser a causa comum de vários códigos em módulos diferentes; há um código de airbag que exige confirmação do técnico.',
      causa_raiz_provavel: 'Subtensão de alimentação (bateria/IBS ou aterramento) — hipótese a confirmar antes de mexer nos módulos afetados.',
      requer_confirmacao_profissional: true,
      avisos_seguranca: ['Código de airbag/SRS presente — não liberar o veículo; confirmar com o técnico responsável e medir antes de qualquer ação.'],
      codigos: [
        { codigo: '00A6B2', formato: 'hex_bmw', modulo: 'DME', descricao: 'Subtensão de alimentação detectada', sistema: 'eletrica', severidade: 'alta', tipo: 'raiz', critico_seguranca: false, caractere_ambiguo: false, exige_medicao: true, medicao: 'Teste de bateria/IBS, tensão de repouso e saída do alternador.', termo_peca: 'bateria / sensor IBS', causa_provavel: 'Bateria fraca ou aterramento ruim indica subtensão geral.', acao: 'Medir e tratar a alimentação antes dos demais códigos.' },
        { codigo: '480A02', formato: 'hex_bmw', modulo: 'DSC', descricao: 'Sem comunicação com módulo (barramento)', sistema: 'freios/estabilidade', severidade: 'alta', tipo: 'consequente', critico_seguranca: true, caractere_ambiguo: false, exige_medicao: true, medicao: 'Reverificar após corrigir a alimentação; checar conector/barramento.', termo_peca: 'módulo DSC / conector', causa_provavel: 'Provável consequência da subtensão — pode limpar sozinho.', acao: 'Reavaliar depois de tratar a causa-raiz.' },
        { codigo: '801C33', formato: 'hex_bmw', modulo: 'ACSM', descricao: 'Airbag: interrupção no circuito', sistema: 'airbag/seguranca', severidade: 'critica', tipo: 'indefinido', critico_seguranca: true, caractere_ambiguo: false, exige_medicao: true, medicao: 'Inspeção do circuito/conector do airbag pelo técnico — sistema de segurança.', termo_peca: 'airbag / chicote do airbag', causa_provavel: 'Circuito de airbag — não concluir sem inspeção física.', acao: 'Confirmação profissional obrigatória antes de qualquer ação.' },
      ],
      sistemas_afetados: ['elétrica', 'freios/estabilidade', 'airbag/segurança'],
      prioridades: ['1) Tratar a subtensão (causa-raiz)', '2) Reavaliar códigos consequentes', '3) Inspeção do airbag pelo técnico'],
      proximos_passos: ['Teste de bateria/IBS e tensão de repouso', 'Reler a memória de falhas após corrigir a alimentação', 'Inspeção física do circuito de airbag'],
      observacoes: 'Modo demonstração — em produção a IA lê o laudo real que você anexar.', confianca: 0.7, anexos: 0,
    };
  }

  // Base local mínima de placas-demo (além dos veículos já cadastrados).
  const PLACA_DEMO = {
    'PONTO123': { vin: '', modelo: 'VW Golf GTI Mk7', anoModelo: 2019, cor: 'Branco', combustivel: 'Gasolina' },
  };
  // Consulta placa → dados do veículo (VIN/chassi, modelo, ano, cor).
  async function consultarPlaca(placa) {
    const p = normPlaca(placa);
    if (!p) return { ok: false, erro: 'Informe a placa.' };
    const known = getVehicles().find(v => normPlaca(v.placa) === p);
    if (known) return { ok: true, fonte: 'garagem', placa: p, vin: known.vin, modelo: known.modelo, anoModelo: known.anoModelo, cor: known.cor };
    if (PLACA_DEMO[p]) return { ok: true, fonte: 'demo', placa: p, ...PLACA_DEMO[p] };
    try { // API real de placa via função serverless (quando a chave estiver configurada no servidor)
      const r = await fetch('/api/placa?placa=' + encodeURIComponent(p), { headers: { accept: 'application/json' } });
      if (r.ok) { const d = await r.json(); if (d && d.ok) return { ...d, placa: p, fonte: 'api' }; }
    } catch (_) { /* offline / sem endpoint → cai no aviso abaixo */ }
    return { ok: false, placa: p, erro: 'Placa não encontrada. Configure a API de consulta (/api/placa) ou digite o VIN.' };
  }

  // Sugestão de orçamento a partir dos sinais do check-in (luzes + sintoma).
  function sugerirOrcamento(sinais, familia, config) {
    sinais = sinais || {}; config = config || getConfig();
    const txt = ((sinais.luzes || []).join(' ') + ' ' + (sinais.sintoma || '')).toLowerCase();
    const regras = [
      { re: /service|revis|[óo]leo/, cat: 'oleo', motivo: 'Alerta Service / revisão' },
      { re: /freio|brake|pastilh|epb/, cat: 'freio_d', motivo: 'Indício de freio' },
      { re: /amort|susp|barulho|lombada|ru[íi]do/, cat: 'amortecedor', motivo: 'Ruído de suspensão' },
      { re: /check engine|falha|motor|epc/, cat: 'diagnostico', motivo: 'Check Engine / falha' },
    ];
    const cats = [];
    for (const r of regras) if (r.re.test(txt) && !cats.some(c => c.cat === r.cat)) cats.push(r);
    if (!cats.length) cats.push({ cat: 'diagnostico', motivo: 'Diagnóstico inicial recomendado' });
    return cats.map(c => {
      const m = motorDePecas(c.cat, familia || 'g20', config);
      return { categoria: c.cat, motivo: c.motivo, descricao: m.descricao, preco: (m.niveis.original.preco || 0) + (m.mo || 0) };
    });
  }

  // Migração demo: garante a identidade da oficina-piloto EUROVIX no config LOCAL
  // (idempotente). Só quando já há demo (seedv) e a identidade está em branco —
  // assim navegadores demo antigos não regridem para a marca em branco. Tenant real
  // (nuvem) nunca passa por aqui: começa em branco e preenche no onboarding.
  function ensureMarcaDemo() {
    if (!read(KEYS.seedv, false)) return;
    const c = read(KEYS.config, {}) || {};
    const nome = (c.oficina && c.oficina.nome || '').trim();
    // Migra caches antigos: marca do cliente-piloto e o placeholder sem identidade.
    const cacheVelho = DEMO && (/eurovix/i.test(nome) || /^Oficina Demonstra/i.test(nome));
    if (nome && !cacheVelho) return;
    // A DEMONSTRAÇÃO tem identidade própria — uma oficina fictícia, com logo e
    // domínio próprios. Não é a marca de nenhum cliente, e não é o LexOS: é
    // justamente essa separação que prova o white-label. Quem abre o demo vê o
    // sistema vestido de outra empresa, que é como ele será entregue.
    write(KEYS.config, { ...c, oficina: {
      nome: 'Nordwerk', cnpj: '00.000.000/0001-00',
      endereco: 'Av. das Oficinas, 1200 — Distrito Industrial',
      cidade: 'Sua Cidade/UF', fone: '(00) 90000-0000',
      email: 'contato@nordwerk.uselexgo.com',
      pixChave: 'contato@nordwerk.uselexgo.com',
      site: 'nordwerk.uselexgo.com',
      horario: 'Seg–Sex 8h–18h · Sáb 8h–12h',
      logo: 'assets/img/demo/nordwerk-logo.svg',
      logoDoc: 'assets/img/demo/nordwerk-logo-doc.svg',
      icon: 'assets/img/demo/nordwerk-icon.svg',
    } });
  }


  if (!CLOUD) { // na nuvem o banco é a verdade: sem seeds/migração local
    seed();
    seedAgenda();
    ensureClients();
    ensureMarcaDemo();
  }

  return {
    ready: Promise.resolve(), cloud: false, online: true, isDemo: DEMO,
    // No modo demonstração o painel ganha uma persona (Gestor/Mecânico/Consultor)
    // para exercitar os papéis; fora dele, o módulo local não tem login (demo puro).
    authUser: () => (DEMO ? { email: demoPapel() + '.demo@lexos.app', demo: true } : null),
    loginStaff: async () => (DEMO ? { papel: demoPapel() } : null),
    logoutAuth: () => {},
    staffPerfil: () => (DEMO ? { papel: demoPapel(), demo: true } : null),
    staffListar: async () => (DEMO ? { ok: true, lista: DEMO_TEAM } : { ok: true, lista: [] }),
    staffCriar: async () => ({ ok: false, erro: 'Gestão de equipe disponível apenas no modo nuvem.' }),
    staffEditar: async () => ({ ok: false, erro: 'Gestão de equipe disponível apenas no modo nuvem.' }),
    staffRemover: async () => ({ ok: false, erro: 'Gestão de equipe disponível apenas no modo nuvem.' }),
    mudarMinhaSenha: async () => ({ ok: false, erro: 'Disponível apenas no modo nuvem.' }),
    resetarSenha: async () => ({ ok: false, erro: 'Recuperação por e-mail disponível apenas no modo nuvem.' }),
    resetarSenhaCliente: async () => ({ ok: false, erro: 'Redefinição por link disponível apenas no modo nuvem.' }),
    emRecuperacao: () => false,
    aprovarOrcamento, registrarPagamento, chatCliente, avaliarNps,
    _aplicarPagamento: aplicarPagamento, // interno: só o registrarPagamento (local e do adaptador) deve usar
    KEYS, STATUS, statusIdx, CATEGORIAS, ETK, SUPPLIERS, AW_TABLE,
    validateVIN, decodeVIN, fixVIN, checkRecalls, catalogoDoVin,
    analisarFotos, analisarIsta, consultarPlaca, sugerirOrcamento,
    carregarSeedObd, dicGet, dicAprender, dicStats, decodeLocal, lerLocal, dicDump, dicLimpar,
    motorDePecas, itemPreco, totalOS, custoOS,
    getConfig, saveConfig,
    getVehicles, upsertVehicle,
    normTel, normPlaca, getClientes, upsertCliente, clientePorTelefone, clientePorConvite,
    ativarCliente, loginCliente, garagemDe, conviteUrl, waLink,
    marca,
    getAllOS, saveAllOS, getOS, novaOS, novoItem, itemDeIsta, updateOS, setStatus,
    getAgendamentos, addAgendamento, setAgendamentoStatus, agendarPublico,
    pendencias, chatSend,
    pixPayload, brl, fdt, fd,
  };
})();
