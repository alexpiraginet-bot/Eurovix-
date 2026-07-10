/* ============================================================
   EUROVIX · Dados compartilhados (demo)
   Catálogo de serviços, veículos e ordens de serviço usados
   pelo site, pelo fluxo de agendamento e pelo app do cliente.
   Persistência local via localStorage (chaves EVX.*).
   ============================================================ */

const EVX = (() => {

  const STORAGE = {
    appointments: 'evx.appointments',
    session: 'evx.session',
    orders: 'evx.orders',
    notifications: 'evx.notifications',
  };

  /* ---------- Catálogo de serviços (brand board: 6 linhas) ---------- */
  const SERVICES = [
    {
      id: 'manutencao',
      icon: 'wrench',
      nome: 'Manutenção',
      tag: 'Preventiva e corretiva',
      desc: 'Revisões completas seguindo o plano BMW CBS (Condition Based Service), com registro digital de cada item.',
      itens: ['Óleo e filtros originais', 'Correias, velas e bobinas', 'Fluidos de freio e arrefecimento', 'Inspeção eletrônica de 60 itens'],
      duracao: '4h — 1 dia',
    },
    {
      id: 'diagnostico',
      icon: 'scan',
      nome: 'Diagnóstico',
      tag: 'Eletrônico avançado',
      desc: 'Equipamento dedicado BMW (ISTA) para leitura profunda de módulos, codificação e falhas intermitentes.',
      itens: ['Leitura de todos os módulos', 'Teste de atuadores', 'Codificação e atualização de software', 'Laudo técnico digital'],
      duracao: '1h — 3h',
    },
    {
      id: 'performance',
      icon: 'gauge',
      nome: 'Performance',
      tag: 'Potência e preparação',
      desc: 'Do Stage 1 ao projeto completo: remap com dinamômetro, hardware de suporte e acerto para uso em rua ou track day.',
      itens: ['Remap Stage 1 / Stage 2', 'Downpipe, intercooler e admissão', 'Medição antes/depois em dyno', 'Setup para track day'],
      duracao: 'sob projeto',
    },
    {
      id: 'suspensao',
      icon: 'spring',
      nome: 'Suspensão',
      tag: 'Precisão e segurança',
      desc: 'Geometria de direção com equipamento 3D e recuperação do comportamento original — ou acerto esportivo.',
      itens: ['Amortecedores e molas', 'Buchas, braços e coxins', 'Alinhamento 3D e balanceamento', 'Acerto de altura e cambagem'],
      duracao: '3h — 1 dia',
    },
    {
      id: 'freios',
      icon: 'disc',
      nome: 'Freios',
      tag: 'Máxima eficiência',
      desc: 'Sistema de freios OEM ou performance, com sangria eletrônica assistida e sensores de desgaste renovados.',
      itens: ['Pastilhas e discos OEM / performance', 'Fluido DOT4 / DOT5.1', 'Sangria eletrônica via scanner', 'Sensores e calibração'],
      duracao: '2h — 5h',
    },
    {
      id: 'frotas',
      icon: 'fleet',
      nome: 'Revisão de Frotas',
      tag: 'Gestão especializada',
      desc: 'Manutenção programada para frotas premium com SLA, leva-e-traz e relatório individual por veículo.',
      itens: ['Plano de manutenção por veículo', 'SLA e prioridade de box', 'Leva-e-traz corporativo', 'Relatórios mensais de frota'],
      duracao: 'contrato',
    },
  ];

  /* ---------- Pilares (hero do site) ---------- */
  const PILLARS = [
    { icon: 'badge',  nome: 'Especialistas BMW', desc: 'Equipe certificada' },
    { icon: 'tool',   nome: 'Equipamentos',      desc: 'Tecnologia avançada' },
    { icon: 'part',   nome: 'Peças Originais',   desc: 'Qualidade garantida' },
    { icon: 'chart',  nome: 'Performance',       desc: 'Máximo desempenho' },
    { icon: 'shield', nome: 'Garantia',          desc: 'Segurança total' },
  ];

  /* ---------- Conta demo do app ---------- */
  const DEMO_USER = {
    nome: 'Ricardo Almeida',
    email: 'demo@eurovix.com.br',
    telefone: '(27) 99900-0000',
    cliente_desde: 2021,
  };

  const VEHICLES = [
    {
      id: 'm135i',
      modelo: 'BMW M135i',
      ano: 2020,
      placa: 'RQV-2D47',
      cor: 'Preto Safira',
      km: 48500,
      proxRevisao: { km: 50000, titulo: 'Revisão dos 50.000 km', restante: 1500 },
      saude: { oleo: 78, freios: 64, pneus: 82, bateria: 91 },
    },
    {
      id: 'x1',
      modelo: 'BMW X1 sDrive20i',
      ano: 2022,
      placa: 'RWK-7B12',
      cor: 'Branco Alpino',
      km: 21300,
      proxRevisao: { km: 30000, titulo: 'Revisão dos 30.000 km', restante: 8700 },
      saude: { oleo: 88, freios: 90, pneus: 76, bateria: 95 },
    },
  ];

  /* ---------- Etapas padrão de uma OS ---------- */
  const OS_STAGES = [
    { id: 'recebido',   nome: 'Veículo recebido',      desc: 'Check-in e inspeção de entrada concluídos.' },
    { id: 'diagnostico',nome: 'Diagnóstico',           desc: 'Avaliação técnica e leitura eletrônica.' },
    { id: 'orcamento',  nome: 'Aguardando aprovação',  desc: 'Orçamento enviado — aprove pelo app.' },
    { id: 'execucao',   nome: 'Em execução',           desc: 'Serviço em andamento no box.' },
    { id: 'testes',     nome: 'Testes e controle',     desc: 'Rodagem de teste e checklist de qualidade.' },
    { id: 'pronto',     nome: 'Pronto para retirada',  desc: 'Veículo lavado e liberado.' },
  ];

  /* ---------- Ordens de serviço iniciais (demo) ---------- */
  const SEED_ORDERS = [
    {
      id: 1257,
      veiculo: 'BMW M135i · RQV-2D47',
      servico: 'Revisão Preventiva',
      abertura: '2026-07-08T09:12:00',
      status: 'andamento',
      etapa: 1,                     // índice em OS_STAGES — evolui ao vivo no app
      orcamento: { total: 2890, itens: [
        { nome: 'Óleo 5W-30 Original BMW (6L)', valor: 890 },
        { nome: 'Filtros: óleo, ar e cabine',    valor: 640 },
        { nome: 'Fluido de freio DOT4 + sangria',valor: 480 },
        { nome: 'Velas de ignição (4x)',         valor: 520 },
        { nome: 'Mão de obra especializada',     valor: 360 },
      ]},
      consultor: 'André — Consultor Técnico',
    },
    {
      id: 1240,
      veiculo: 'BMW M135i · RQV-2D47',
      servico: 'Pastilhas + discos dianteiros',
      abertura: '2026-06-14T08:40:00',
      entrega: '2026-06-15T17:30:00',
      status: 'concluida',
      etapa: 5,
      orcamento: { total: 3480, itens: [
        { nome: 'Discos dianteiros originais (par)', valor: 1980 },
        { nome: 'Pastilhas dianteiras',              valor: 940 },
        { nome: 'Sensor de desgaste',                valor: 180 },
        { nome: 'Mão de obra + sangria',             valor: 380 },
      ]},
      consultor: 'André — Consultor Técnico',
      avaliacao: 5,
    },
    {
      id: 1233,
      veiculo: 'BMW X1 sDrive20i · RWK-7B12',
      servico: 'Diagnóstico eletrônico',
      abertura: '2026-05-27T10:05:00',
      entrega: '2026-05-27T15:20:00',
      status: 'concluida',
      etapa: 5,
      orcamento: { total: 420, itens: [
        { nome: 'Diagnóstico completo ISTA', valor: 420 },
      ]},
      consultor: 'Paula — Consultora Técnica',
      avaliacao: 5,
    },
  ];

  /* ---------- Horários de agendamento ---------- */
  const SLOTS = ['08:00', '09:00', '10:00', '11:00', '13:30', '14:30', '15:30', '16:30'];

  const CONTACT = {
    endereco: 'Av. Nossa Senhora da Penha, 1240 — Enseada do Suá, Vitória/ES',
    telefone: '(27) 3020-4890',
    whatsapp: '5527999004890',
    email: 'contato@eurovix.com.br',
    horario: 'Seg – Sex · 8h às 18h  |  Sáb · 8h às 12h',
  };

  /* ---------- Helpers de persistência ---------- */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* modo privado */ }
  }

  function getAppointments() { return read(STORAGE.appointments, []); }
  function saveAppointment(appt) {
    const list = getAppointments();
    list.unshift(appt);
    write(STORAGE.appointments, list);
    pushNotification({
      titulo: 'Agendamento confirmado',
      texto: `${appt.servicoNome} — ${appt.dataLabel} às ${appt.hora}. Protocolo ${appt.protocolo}.`,
      quando: Date.now(),
      tipo: 'agenda',
    });
    return appt;
  }

  function getOrders() {
    const saved = read(STORAGE.orders, null);
    if (saved) return saved;
    write(STORAGE.orders, SEED_ORDERS);
    return SEED_ORDERS.map(o => ({ ...o }));
  }
  function saveOrders(orders) { write(STORAGE.orders, orders); }

  function getNotifications() { return read(STORAGE.notifications, []); }
  function pushNotification(n) {
    const list = getNotifications();
    list.unshift({ id: Date.now() + Math.floor(Math.random() * 999), lida: false, ...n });
    write(STORAGE.notifications, list.slice(0, 40));
    return list;
  }
  function markNotificationsRead() {
    write(STORAGE.notifications, getNotifications().map(n => ({ ...n, lida: true })));
  }

  function getSession() { return read(STORAGE.session, null); }
  function setSession(s) { write(STORAGE.session, s); }
  function clearSession() { localStorage.removeItem(STORAGE.session); }

  function protocolo() {
    const n = Math.floor(100000 + Math.random() * 899999);
    return `EVX-${n}`;
  }

  function brl(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /* ---------- Ícones SVG (kit de UI do brand board) ---------- */
  const ICONS = {
    wrench: '<path d="M13.8 6.2a4.4 4.4 0 0 0-5.9 5.4L3 16.5V21h4.5l4.9-4.9a4.4 4.4 0 0 0 5.4-5.9l-3 3-2.8-.7-.7-2.8 3-3z"/>',
    scan:   '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><circle cx="12" cy="12" r="3.2"/>',
    gauge:  '<path d="M5 19a9 9 0 1 1 14 0"/><path d="M12 13l4.5-4.5"/><circle cx="12" cy="13" r="1.6"/>',
    spring: '<path d="M6 4h12M6 20h12M7 4c5 2.2 5 4.4 0 6.6 5 2.2 5 4.4 0 6.6M17 4c-5 2.2-5 4.4 0 6.6-5 2.2-5 4.4 0 6.6"/>',
    disc:   '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4"/>',
    fleet:  '<path d="M3 16v-4l2-5h9l2 5h5v4h-2M5 16h9"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
    badge:  '<circle cx="12" cy="9" r="5.4"/><path d="M8.6 13.6 7 21l5-2.6L17 21l-1.6-7.4"/>',
    tool:   '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16v4h4l5.5-5.5a4 4 0 0 0 5-5L15 13l-2-2 1.5-5.5z"/>',
    part:   '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>',
    chart:  '<path d="M4 20V10M10 20V4M16 20v-8M4 20h17"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6l7-3z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    calendar:'<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 2.8V6.5M16 2.8V6.5"/>',
    clock:  '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.2 2"/>',
    check:  '<path d="M4.5 12.5l5 5L19.5 7"/>',
    car:    '<path d="M4 15v-3l2-5.5h12L20 12v3M4 15h16M4 15v3h2.6v-2M20 15v3h-2.6v-2M7 9h10"/>',
    pin:    '<path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
    phone:  '<path d="M6 3h4l1.5 5-2.4 1.8a13 13 0 0 0 5.1 5.1L16 12.5l5 1.5v4a2 2 0 0 1-2.2 2A17.4 17.4 0 0 1 4 6.2 2 2 0 0 1 6 3z"/>',
    whats:  '<path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.1A8.5 8.5 0 1 0 12 3.5z"/><path d="M9.2 8.6c2 4.2 3.4 5.1 5.6 6l1.2-1.6-2-1.2-1 .7c-.8-.6-1.5-1.4-2-2.3l.8-.9-1.1-2.1-1.5 1.4z"/>',
    bell:   '<path d="M6 16v-5.5a6 6 0 1 1 12 0V16l1.8 2.5H4.2L6 16z"/><path d="M10 21a2.2 2.2 0 0 0 4 0"/>',
    user:   '<circle cx="12" cy="8.2" r="4.2"/><path d="M4 20.5c1.4-3.6 4.4-5.3 8-5.3s6.6 1.7 8 5.3"/>',
    home:   '<path d="M4 11l8-7 8 7v9h-5.5v-5.5h-5V20H4v-9z"/>',
    list:   '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4.4" cy="6" r="1"/><circle cx="4.4" cy="12" r="1"/><circle cx="4.4" cy="18" r="1"/>',
    arrow:  '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back:   '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    close:  '<path d="M6 6l12 12M18 6L6 18"/>',
    star:   '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8L12 3.6z"/>',
    engine: '<path d="M7 7V4.5M11 7V4.5M5 9.5h9l2 2.5h3.5v6H17l-2 2H7l-2-2.5H3v-5h2V9.5zM20.5 12v6"/>',
    key:    '<circle cx="8" cy="14.5" r="4.2"/><path d="M11 11.5L20 3M16 6.5l2.5 2.5M13.5 9l2 2"/>',
    doc:    '<path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    logout: '<path d="M14 4H5v16h9M10 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
    alert:  '<path d="M12 3.8 21.4 20H2.6L12 3.8z"/><path d="M12 10v4.4M12 17.4v.2"/>',
    speed:  '<path d="M12 4a9 9 0 0 1 9 9h-3.2M12 4a9 9 0 0 0-9 9h3.2M12 4v3"/><path d="M12 13l4-4"/><circle cx="12" cy="13" r="1.5"/>',
  };

  function icon(name, size, cls) {
    const body = ICONS[name] || ICONS.wrench;
    return `<svg class="ico ${cls || ''}" width="${size || 22}" height="${size || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  return {
    STORAGE, SERVICES, PILLARS, DEMO_USER, VEHICLES, OS_STAGES, SLOTS, CONTACT,
    getAppointments, saveAppointment,
    getOrders, saveOrders,
    getNotifications, pushNotification, markNotificationsRead,
    getSession, setSession, clearSession,
    protocolo, brl, icon,
  };
})();
