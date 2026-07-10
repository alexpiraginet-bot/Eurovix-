/* ============================================================
   EUROVIX · WERK OS — documentos exportáveis (PDF via print)
   ?tipo=termo|dvi|orcamento|os|fatura|garantia & os=N
   ?tipo=prontuario & vin=V
   ============================================================ */

(function () {
  'use strict';

  const q = new URLSearchParams(location.search);
  const tipo = q.get('tipo') || 'os';
  const box = document.getElementById('doc');
  const cfg = WERK.getConfig();
  const sev = { critico: 'CRÍTICO', preventivo: 'PREVENTIVO', ok: 'OK' };

  const header = (titulo, sub) => `
    <div class="doc-head">
      <div>
        <span class="wm">EUROVI<span class="x">X</span></span>
        <small>Oficina Especializada BMW · WERK OS</small>
      </div>
      <div class="dtitle"><b>${titulo}</b><span>${sub}</span></div>
    </div>`;

  const footer = (extra) => `
    <div class="foot">
      <span>${cfg.oficina.nome} · CNPJ ${cfg.oficina.cnpj}<br>${cfg.oficina.endereco} · ${cfg.oficina.fone}</span>
      <span style="text-align:right">${extra || ''}<br>Documento gerado pelo WERK OS em ${new Date().toLocaleString('pt-BR')}</span>
    </div>`;

  const veicGrid = (os) => `
    <h2>Veículo & Cliente</h2>
    <div class="grid">
      <div class="kv"><b>Veículo</b>${os.veiculo}</div>
      <div class="kv"><b>Cliente</b>${os.cliente}</div>
      <div class="kv"><b>VIN (chassi)</b>${os.vin}</div>
      <div class="kv"><b>Telefone</b>${os.telefone || '—'}</div>
      <div class="kv"><b>Placa</b>${os.placa || '—'}</div>
      <div class="kv"><b>Consultor</b>${os.consultor}</div>
    </div>`;

  function orcTable(os, apenasAprovados) {
    const itens = os.itens.filter(i => i.severidade !== 'ok').filter(i => !apenasAprovados || i.aprovacao === 'aprovado');
    return `
      <table>
        <tr><th>Item</th><th>Peça (part number)</th><th>Nível</th><th class="num">Peça</th><th class="num">MO (AW)</th><th class="num">Subtotal</th></tr>
        ${itens.map(i => {
          const nv = i.niveis[i.nivelEscolhido || 'original'];
          return `<tr ${i.aprovacao === 'recusado' ? 'style="opacity:.5;text-decoration:line-through"' : ''}>
            <td><span class="sev ${i.severidade}"></span><b>${i.titulo}</b><br><span class="muted">${i.nota || ''}</span></td>
            <td>${i.pecaDescricao}<br><span class="hash">${nv.partNumber}</span> · ${nv.fabricante}</td>
            <td>${nv.rotulo}</td>
            <td class="num">${WERK.brl(nv.preco)}</td>
            <td class="num">${WERK.brl(i.mo)} (${i.aw})</td>
            <td class="num"><b>${WERK.brl(WERK.itemPreco(i))}</b></td></tr>`;
        }).join('')}
        <tr class="total-row"><td colspan="5">TOTAL ${apenasAprovados ? 'APROVADO' : 'PROPOSTO'}</td>
        <td class="num">${WERK.brl(WERK.totalOS(os, apenasAprovados))}</td></tr>
      </table>`;
  }

  const eventos = (os) => `
    <h2>Linha do tempo (log de auditoria)</h2>
    <table>
      <tr><th>Quando</th><th>Evento</th><th>Detalhe</th><th>Ator</th></tr>
      ${os.eventos.map(e => `<tr><td>${WERK.fdt(e.ts)}</td><td><b>${e.titulo}</b></td><td>${e.desc || ''}</td><td>${e.ator}</td></tr>`).join('')}
    </table>`;

  /* ---------- documentos ---------- */
  const render = {

    termo(os) {
      const c = os.checkin || {};
      const itensV = { 0: 'Documento (CRLV)', 1: 'Chave reserva', 2: 'Triângulo', 3: 'Macaco/chave de roda', 4: 'Estepe/kit', 5: 'Tapetes' };
      const marcados = Array.isArray(c.itens)
        ? Object.entries(itensV).filter(([k]) => c.itens[k]).map(([, v]) => v)
        : Object.entries(c.itens || {}).filter(([, v]) => v).map(([k]) => k);
      return header('Termo de Entrada', `OS #${os.numero} · ${WERK.fdt(c.ts || os.criada)}`) + veicGrid(os) + `
        <h2>Estado registrado no check-in</h2>
        <div class="grid">
          <div class="kv"><b>Odômetro</b>${(c.odometro || 0).toLocaleString('pt-BR')} km (OCR/validado)</div>
          <div class="kv"><b>Combustível</b>${c.combustivel || 0}%</div>
          <div class="kv"><b>Luzes de alerta</b>${(c.luzes && c.luzes.length) ? c.luzes.join(', ') : 'nenhuma'}</div>
          <div class="kv"><b>Itens no veículo</b>${marcados.join(', ') || '—'}</div>
        </div>
        <h2>Tour fotográfico 360° — ${c.fotos || 0} fotos timestampadas</h2>
        <div class="fotobox">
          ${c.fotosData ? Object.values(c.fotosData).map(f => `<div class="ph"><img src="${f}"></div>`).join('')
            : Array.from({ length: Math.min(c.fotos || 4, 8) }, (_, i) => `<div class="ph">foto ${i + 1}<br>arquivada no prontuário</div>`).join('')}
        </div>
        <h2>Danos preexistentes reconhecidos (${(c.danos || []).length})</h2>
        ${(c.danos || []).length ? `<table><tr><th>#</th><th>Descrição</th></tr>${c.danos.map((d, i) => `<tr><td>${i + 1}</td><td>${d.nota}</td></tr>`).join('')}</table>` : '<p class="muted">Nenhum dano preexistente registrado.</p>'}
        <p class="muted" style="margin-top:14px">Declaro que acompanhei a inspeção de entrada e reconheço o estado do veículo acima descrito, registrado em fotos com carimbo de data/hora.</p>
        <div class="sig-row">
          <div class="sig">${typeof c.assinatura === 'string' && c.assinatura.startsWith('data:') ? `<img src="${c.assinatura}">` : ''}${os.cliente}<br>Cliente</div>
          <div class="sig">Recepção EUROVIX<br>Check-in digital</div>
        </div>` + footer('Blindagem jurídica: fotos + assinatura + timestamp');
    },

    dvi(os) {
      return header('Relatório de Inspeção (DVI)', `OS #${os.numero} · padrão europeu 3 cores`) + veicGrid(os) + `
        <h2>Sintoma relatado</h2><p style="font-size:12.5px">${os.sintoma || '—'}</p>
        ${os.dtcs.length ? `<h2>Códigos de falha (scanner)</h2><table>${os.dtcs.map(d => `<tr><td><span class="hash">${d}</span></td></tr>`).join('')}</table>` : ''}
        <h2>Itens inspecionados</h2>
        <table>
          <tr><th>Severidade</th><th>Item</th><th>Evidência técnica</th><th>Mídia</th></tr>
          ${os.itens.map(i => `<tr>
            <td><span class="sev ${i.severidade}"></span><b>${sev[i.severidade]}</b></td>
            <td><b>${i.titulo}</b></td><td>${i.nota || '—'}</td>
            <td>${i.midia ? '📷 arquivada' : '—'}</td></tr>`).join('')}
        </table>
        <p class="muted" style="margin-top:10px">🔴 crítico/segurança — intervenção imediata recomendada · 🟡 preventivo — planejar · 🟢 ok — sem ação. Toda mídia fica vinculada ao VIN no prontuário vitalício.</p>
        ` + footer(`Técnico responsável: ${os.tecnico}`);
    },

    orcamento(os) {
      return header('Orçamento', `OS #${os.numero} · validade 7 dias`) + veicGrid(os) + `
        <h2>Itens propostos — 3 níveis disponíveis por item</h2>
        ${orcTable(os, false)}
        <h2>Níveis de peça</h2>
        <p class="muted">Original BMW (genuína) · OEM — mesmo fabricante que fornece à BMW (Lemförder, Sachs, Mahle, ZF…) · Aftermarket premium (Brembo, Bilstein…). Preço e prazo por item acima consideram a melhor cotação entre ${WERK.SUPPLIERS.length} fornecedores. Mão de obra: tabela de tempos padrão (AW) × ${WERK.brl(cfg.valorHora)}/h.</p>
        ${os.aceite ? `<p style="margin-top:12px"><span class="stamp">Aprovado</span> &nbsp; <span class="muted">Aceite digital em ${WERK.fdt(os.aceite.ts)} · IP ${os.aceite.ip} · hash <span class="hash">${os.aceite.hash}</span></span></p>` : ''}
        ` + footer('Aprovação item a item pelo app — nada é executado sem seu OK');
    },

    os(os) {
      return header('Ordem de Serviço', `OS #${os.numero} · aberta em ${WERK.fdt(os.criada)}`) + veicGrid(os) + `
        <h2>Serviços executados / aprovados</h2>
        ${orcTable(os, true)}
        ${os.qc ? `<h2>Controle de qualidade</h2>
          <div class="grid">
            <div class="kv"><b>Torques</b>registrados ✓</div>
            <div class="kv"><b>Reset service</b>executado ✓</div>
            <div class="kv"><b>Test-drive</b>${os.qc.testDrive}</div>
            <div class="kv"><b>Dupla assinatura</b>${os.qc.assinaturaTecnico} + ${os.qc.assinaturaInspetor}</div>
          </div>` : ''}
        ${eventos(os)}` + footer(`Técnico: ${os.tecnico} · Consultor: ${os.consultor}`);
    },

    fatura(os) {
      const p = os.pagamento || {};
      return header('Fatura / Recibo', `OS #${os.numero} · ${os.nf ? os.nf.numero : 'NF pendente'}`) + veicGrid(os) + `
        <h2>Serviços faturados</h2>
        ${orcTable(os, true)}
        <h2>Pagamento</h2>
        <div class="grid">
          <div class="kv"><b>Método</b>${p.metodo || '—'}</div>
          <div class="kv"><b>Data</b>${p.ts ? WERK.fdt(p.ts) : '—'}</div>
          <div class="kv"><b>Transação</b><span class="hash">${p.txid || '—'}</span></div>
          <div class="kv"><b>Nota fiscal</b>${os.nf ? os.nf.numero : '—'} (emissão automática)</div>
        </div>
        <p style="margin-top:14px"><span class="stamp">Pago ✓</span></p>` + footer('Conciliação automática · NFS-e integrada');
    },

    garantia(os) {
      const itens = os.itens.filter(i => i.garantia);
      return header('Certificado de Garantia', `OS #${os.numero} · por item — peça e mão de obra`) + veicGrid(os) + `
        <h2>Coberturas ativas</h2>
        <table>
          <tr><th>Item</th><th>Peça instalada</th><th>Início</th><th>Vencimento</th><th>Cobertura</th></tr>
          ${itens.map(i => `<tr>
            <td><b>${i.titulo}</b></td>
            <td>${i.pecaDescricao} · ${i.niveis[i.nivelEscolhido || 'original'].fabricante}<br><span class="hash">${i.niveis[i.nivelEscolhido || 'original'].partNumber}</span></td>
            <td>${WERK.fd(i.garantia.inicio)}</td><td><b>${WERK.fd(i.garantia.fim)}</b></td>
            <td>Peça ${cfg.garantiaMeses.peca}m + MO ${cfg.garantiaMeses.mo}m</td></tr>`).join('')}
        </table>
        <p class="muted" style="margin-top:12px">A contagem regressiva de cada garantia fica visível no app do cliente. Acionamento: apresentar este certificado ou o número da OS em qualquer atendimento.</p>
        ` + footer('Garantia registrada automaticamente no checkout');
    },

    prontuario() {
      const vin = q.get('vin');
      const v = WERK.getVehicles().find(x => x.vin === vin) || {};
      const historia = WERK.getAllOS().filter(o => o.vin === vin);
      const invest = historia.reduce((s, o) => s + (o.pagamento ? o.pagamento.valor : 0), 0);
      return header('Prontuário do Veículo', `Histórico vitalício · VIN ${vin}`) + `
        <h2>Identificação</h2>
        <div class="grid">
          <div class="kv"><b>Veículo</b>${v.modelo || '—'}</div>
          <div class="kv"><b>Proprietário atual</b>${v.cliente || '—'}</div>
          <div class="kv"><b>VIN</b>${vin}</div>
          <div class="kv"><b>Placa</b>${v.placa || '—'}</div>
          <div class="kv"><b>Motor / Câmbio</b>${v.motor || '—'} · ${v.cambio || '—'}</div>
          <div class="kv"><b>Odômetro atual</b>${(v.km || 0).toLocaleString('pt-BR')} km</div>
        </div>
        <h2>Resumo do histórico — ${historia.length} OS · ${WERK.brl(invest)} investidos</h2>
        <table>
          <tr><th>OS</th><th>Data</th><th>Serviços</th><th class="num">Valor</th><th>Status</th></tr>
          ${historia.map(o => `<tr>
            <td><b>#${o.numero}</b></td><td>${WERK.fd(o.criada)}</td>
            <td>${o.itens.filter(i => i.aprovacao === 'aprovado').map(i => i.titulo).join('; ') || o.sintoma || '—'}</td>
            <td class="num">${WERK.brl(WERK.totalOS(o, true))}</td>
            <td>${o.status === 'entregue' ? '✓ concluída' : WERK.STATUS[WERK.statusIdx(o.status)].nome}</td></tr>`).join('')}
        </table>
        <h2>Garantias no histórico</h2>
        <table>
          <tr><th>Item</th><th>OS</th><th>Vencimento</th></tr>
          ${historia.flatMap(o => o.itens.filter(i => i.garantia).map(i =>
            `<tr><td>${i.titulo}</td><td>#${o.numero}</td><td><b>${WERK.fd(i.garantia.fim)}</b></td></tr>`)).join('') || '<tr><td colspan="3" class="muted">—</td></tr>'}
        </table>
        <p class="muted" style="margin-top:12px">Histórico documentado = valorização na revenda. Toda mídia (fotos/vídeos de cada OS) permanece arquivada e vinculada a este VIN — nunca deletada.</p>
        ` + footer('Prontuário vitalício indexado por VIN');
    },
  };

  const os = WERK.getOS(q.get('os'));
  if (tipo === 'prontuario') {
    box.innerHTML = render.prontuario();
    document.title = `Prontuário ${q.get('vin')} — EUROVIX`;
  } else if (os && render[tipo]) {
    box.innerHTML = render[tipo](os);
    document.title = `${tipo.toUpperCase()} OS #${os.numero} — EUROVIX`;
  } else {
    box.innerHTML = header('Documento não encontrado', 'verifique o número da OS') + footer();
  }
})();
