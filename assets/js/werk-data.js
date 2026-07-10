/* ============================================================
   EUROVIX · WERK OS — camada de dados
   Modelo operacional completo da oficina sobre localStorage.
   Em produção, cada bloco marcado [API] é substituído pela
   integração real (Supabase/Postgres, PartsLink24, TecDoc,
   Mercado Pago/Stone, NFS-e) mantendo esta mesma interface.
   ============================================================ */

const WERK = (() => {

  const KEYS = {
    os: 'evx.werk.os',
    vehicles: 'evx.werk.vehicles',
    clients: 'evx.werk.clients',
    config: 'evx.werk.config',
    seedv: 'evx.werk.seed.v1',
    seq: 'evx.werk.seq',
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
    { re: /^WBA7[A-Z0-9]/, modelo: 'BMW 320i M Sport (G20)', motor: 'B48B20 2.0T', cambio: 'ZF 8HP', familia: 'g20', ano: 2021 },
    { re: /^WBA5[A-Z0-9]/, modelo: 'BMW M135i xDrive (F40)', motor: 'B48A20T1 2.0T 306cv', cambio: 'Aisin 8AT', familia: 'f40', ano: 2020 },
    { re: /^WBAJ[A-Z0-9]/, modelo: 'BMW X1 sDrive20i (F48)', motor: 'B48A20 2.0T', cambio: 'Aisin 8AT', familia: 'f48', ano: 2022 },
    { re: /^WBS/,          modelo: 'BMW M3 Competition (G80)', motor: 'S58B30 3.0T 510cv', cambio: 'ZF 8HP76', familia: 'g80', ano: 2022 },
    { re: /^WBY/,          modelo: 'BMW i4 eDrive40 (G26)',  motor: 'Elétrico 340cv', cambio: 'Redução única', familia: 'g26', ano: 2023 },
  ];
  function decodeVIN(vin) {
    vin = (vin || '').toUpperCase();
    const hit = VIN_MODELS.find(m => m.re.test(vin));
    const planta = { A: 'Munique/DE', B: 'Dingolfing/DE', C: 'Leipzig/DE', F: 'Araquari/BR', P: 'Rosslyn/ZA' }[vin[10]] || 'Munique/DE';
    return {
      vin,
      modelo: hit ? hit.modelo : 'BMW (decodificação completa via ETK na integração)',
      motor: hit ? hit.motor : '—',
      cambio: hit ? hit.cambio : '—',
      familia: hit ? hit.familia : 'g20',
      anoModelo: hit ? hit.ano : 2021,
      planta,
      sa: hit ? ['S2VF Rodas M', 'S494 Bancos aquecidos', 'S6AK ConnectedDrive'] : [],
    };
  }

  /* ============================================================
     3 · RECALLS por VIN [API: BMW recall lookup]
     ============================================================ */
  const RECALLS = [
    { re: /^WBA5/, codigo: '0032-EGR', titulo: 'Recall módulo EGR — inspeção do cooler', status: 'aberto' },
  ];
  const checkRecalls = (vin) => RECALLS.filter(r => r.re.test((vin || '').toUpperCase()));

  /* ============================================================
     4 · MOTOR DE PEÇAS POR CHASSI
     Camada 1 ETK (VIN→part number) · Camada 2 preço original
     Camada 3 TecDoc cross-ref · Camada 4 cotação multi-fornecedor
     [API: PartsLink24 + TecDoc + cotação B2B]
     ============================================================ */
  const ETK = {
    oleo:       { g20: '11 42 8 583 898', f40: '11 42 8 583 898', f48: '11 42 8 570 590', g80: '11 42 8 093 204', desc: 'Filtro de óleo + anel' },
    freio_d:    { g20: '34 10 6 888 777', f40: '34 10 6 898 730', f48: '34 10 6 865 460', g80: '34 11 8 093 711', desc: 'Pastilhas dianteiras' },
    disco_d:    { g20: '34 10 6 797 606', f40: '34 11 6 898 728', f48: '34 11 6 866 293', g80: '34 11 8 072 018', desc: 'Discos dianteiros (par)' },
    vela:       { g20: '12 12 0 040 551', f40: '12 12 0 040 551', f48: '12 12 8 657 002', g80: '12 12 5 A21 B02', desc: 'Velas de ignição (jogo)' },
    amortecedor:{ g20: '31 31 6 879 322', f40: '31 30 6 892 940', f48: '31 31 6 862 460', g80: '31 30 8 095 572', desc: 'Amortecedores dianteiros (par)' },
    bieleta:    { g20: '31 30 6 862 864', f40: '31 30 6 862 864', f48: '31 30 6 862 865', g80: '31 30 8 067 439', desc: 'Bieletas da barra (par)' },
    bomba_agua: { g20: '11 51 8 482 251', f40: '11 51 8 482 251', f48: '11 51 8 635 089', g80: '11 51 8 087 340', desc: 'Bomba d’água + termostato' },
    fluido_freio:{ g20: '83 13 2 405 977', f40: '83 13 2 405 977', f48: '83 13 2 405 977', g80: '83 13 2 405 977', desc: 'Fluido DOT4 LV (1L)' },
    correia:    { g20: '11 28 8 580 360', f40: '11 28 8 580 360', f48: '11 28 8 651 439', g80: '—', desc: 'Correia + tensor' },
  };

  // Preço de referência da peça ORIGINAL por categoria (R$) [API: PartsLink24]
  const PRECO_BASE = {
    oleo: 420, freio_d: 1480, disco_d: 2380, vela: 980, amortecedor: 4680,
    bieleta: 620, bomba_agua: 2980, fluido_freio: 160, correia: 890, outro: 800,
  };

  // TecDoc cross-ref: fabricantes por nível e fator de preço [API: TecDoc]
  const CROSSREF = {
    original:    { rotulo: 'Original BMW', fator: 1.00, fabricantes: { default: 'BMW Genuine' } },
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
    { id: 'dealer',  nome: 'Dealer BMW local',   prazo: 2,  fator: 1.00, niveis: ['original'] },
    { id: 'importbr',nome: 'Importador BR',      prazo: 5,  fator: 0.86, niveis: ['original', 'oem'] },
    { id: 'schmied', nome: 'Schmiedmann (DK)',   prazo: 10, fator: 0.74, niveis: ['original', 'oem', 'aftermarket'] },
    { id: 'fcp',     nome: 'FCP Euro (US)',      prazo: 12, fator: 0.70, niveis: ['oem', 'aftermarket'] },
    { id: 'autodoc', nome: 'AUTODOC (DE)',       prazo: 15, fator: 0.62, niveis: ['oem', 'aftermarket'] },
  ];

  // Tempos padrão de MO — AW (1h = 12 AW, padrão BMW flat rate) [API: tabela oficial]
  const AW_TABLE = {
    oleo: 6, freio_d: 10, disco_d: 14, vela: 8, amortecedor: 28,
    bieleta: 8, bomba_agua: 30, fluido_freio: 6, correia: 16, outro: 12,
    diagnostico: 10,
  };
  const CATEGORIAS = Object.keys(PRECO_BASE);

  function motorDePecas(categoria, familia, config) {
    const cat = ETK[categoria] ? categoria : 'outro';
    const part = ETK[cat] ? (ETK[cat][familia] || ETK[cat].g20) : '—';
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
        fabricante: cr.fabricantes[cat] || cr.fabricantes.default || 'BMW Genuine',
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
    oficina: {
      nome: 'EUROVIX REPARAÇÃO AUTOMOTIVA LTDA',
      cnpj: '45.979.822/0001-02',
      endereco: 'R. Maria de Lourdes Garcia, 303 — Monte Belo, Vitória/ES · CEP 29053-310',
      cidade: 'Vitória/ES',
      fone: '(27) 99730-6440 (WhatsApp)',
      pixChave: 'configure-sua-chave@pix (demo)',
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

  const getConfig = () => ({ ...DEFAULT_CONFIG, ...read(KEYS.config, {}), margens: { ...DEFAULT_CONFIG.margens, ...(read(KEYS.config, {}).margens || {}) } });
  const saveConfig = (c) => write(KEYS.config, c);

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
    do { t = Math.random().toString(36).slice(2, 10); } while (lista.some(c => c.convite === t));
    return t;
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
        nome: dados.nome || 'Cliente EUROVIX', telefone: dados.telefone,
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
      cliente: dados.cliente || 'Cliente EUROVIX',
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
  function pixPayload(valor, txid) {
    const cfg = getConfig();
    const mai = emv('00', 'br.gov.bcb.pix') + emv('01', cfg.oficina.pixChave);
    let p = emv('00', '01') + emv('26', mai) + emv('52', '0000') + emv('53', '986') +
      emv('54', valor.toFixed(2)) + emv('58', 'BR') + emv('59', 'EUROVIX OFICINA BMW') +
      emv('60', 'VITORIA') + emv('62', emv('05', (txid || 'EVXOS').slice(0, 20)));
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
      m135: fixVIN('WBA5U71090' + '7L90210'),
      g20:  fixVIN('WBA7A91000' + '7B12933'),
      x1:   fixVIN('WBAJA51050' + '5C60481'),
    };
    upsertVehicle({ vin: vins.m135, ...decodeVIN(vins.m135), placa: 'RQV-2D47', cor: 'Preto Safira',  km: 48500, cliente: 'Ricardo Almeida', telefone: '(27) 99900-0000', cofre: ['Manual do proprietário.pdf', 'Nota da chave codificada.pdf', 'Laudo cautelar 2024.pdf'] });
    upsertVehicle({ vin: vins.g20,  ...decodeVIN(vins.g20),  placa: 'SBX-9F31', cor: 'Branco Alpino', km: 61200, cliente: 'Marcelo Costa',  telefone: '(27) 98811-2233', cofre: ['Manual do proprietário.pdf'] });
    upsertVehicle({ vin: vins.x1,   ...decodeVIN(vins.x1),   placa: 'RWK-7B12', cor: 'Branco Alpino', km: 21300, cliente: 'Ricardo Almeida', telefone: '(27) 99900-0000', cofre: [] });

    itemSeq = 0;

    /* OS 1258 — do Ricardo (usuário demo do app): aguardando aprovação */
    const os1 = novaOS({
      vin: vins.m135, veiculo: 'BMW M135i xDrive (F40)', placa: 'RQV-2D47',
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
      vin: vins.g20, veiculo: 'BMW 320i M Sport (G20)', placa: 'SBX-9F31',
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
      vin: vins.m135, veiculo: 'BMW M135i xDrive (F40)', placa: 'RQV-2D47',
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
      { tel: '27999000000', convite: 'demo-ricardo', senha: enc('bmw2026'), desde: 2021 },
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

  seed();
  ensureClients();

  return {
    KEYS, STATUS, statusIdx, CATEGORIAS, ETK, SUPPLIERS, AW_TABLE,
    validateVIN, decodeVIN, fixVIN, checkRecalls,
    motorDePecas, itemPreco, totalOS, custoOS,
    getConfig, saveConfig,
    getVehicles, upsertVehicle,
    normTel, normPlaca, getClientes, upsertCliente, clientePorTelefone, clientePorConvite,
    ativarCliente, loginCliente, garagemDe, conviteUrl, waLink,
    getAllOS, saveAllOS, getOS, novaOS, novoItem, updateOS, setStatus,
    pendencias, chatSend,
    pixPayload, brl, fdt, fd,
  };
})();
