// ============================================================
// EUROVIX · WERK OS — visão real das fotos de check-in
// ------------------------------------------------------------
// Função serverless (Vercel). Lê as fotos do tour 360° com a
// visão da Claude e devolve, no formato que o painel consome:
// odômetro, combustível, luzes de alerta, avarias e checklist.
// Consome a variável de ambiente ANTHROPIC_API_KEY (você cola a
// chave no painel da Vercel — nunca no código). Sem a chave,
// responde { ok:false } e o app cai no modo assistido.
//
// Prompt + normalizador endurecidos por um time de agentes
// especialistas (odômetro, combustível, luzes, avarias, itens,
// robustez de formato, anti-alucinação). Princípio-mestre:
// ABSTENÇÃO HONESTA — na dúvida, null/[]/confiança baixa em vez
// de um número plausível. O consultor revisa antes de fechar a OS.
// ============================================================

const SLOTS = ['Frente', 'Traseira', 'Lateral esq.', 'Lateral dir.', 'Teto', 'Interior', 'Painel/odômetro', 'Porta-malas'];
const CHECKLIST = ['Documento (CRLV)', 'Chave reserva', 'Triângulo', 'Macaco/chave de roda', 'Estepe/kit reparo', 'Tapetes originais'];
const MAX_FOTOS = 8;

async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, erro: 'Use POST.' }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ ok: false, erro: 'Visão não configurada (defina ANTHROPIC_API_KEY na Vercel).' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  const fotos = body.fotos || {};
  const ctx = body.ctx || {};

  const entradas = Array.isArray(fotos) ? fotos.map((v, i) => [i, v]) : Object.keys(fotos).map(k => [k, fotos[k]]);
  const imgs = [];
  for (const [k, url] of entradas) {
    if (typeof url !== 'string') continue;
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(url);
    if (!m) continue;
    imgs.push({ rotulo: SLOTS[+k] || ('Foto ' + k), media_type: m[1], data: m[2] });
    if (imgs.length >= MAX_FOTOS) break;
  }
  if (!imgs.length) { res.status(200).json({ ok: false, erro: 'Nenhuma foto válida recebida.' }); return; }

  const content = [];
  for (const im of imgs) {
    content.push({ type: 'text', text: 'Foto — ' + im.rotulo + ':' });
    content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
  }
  const ctxTxt = [
    ctx.modelo ? 'Modelo: ' + ctx.modelo : '',
    ctx.placa ? 'Placa: ' + ctx.placa : '',
    ctx.vin ? 'VIN: ' + ctx.vin : '',
  ].filter(Boolean).join(' · ');
  content.push({ type: 'text', text: instrucao(ctxTxt) });

  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1400, messages: [{ role: 'user', content }] }),
    });
    if (!r.ok) {
      const detalhe = await r.text().catch(() => '');
      res.status(200).json({ ok: false, erro: 'Falha na visão (' + r.status + ').', detalhe: String(detalhe).slice(0, 300) });
      return;
    }
    const data = await r.json();
    const texto = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    const parsed = extrairJson(texto);
    if (!parsed) { res.status(200).json({ ok: false, erro: 'Resposta da IA sem JSON legível.' }); return; }
    res.status(200).json(normalizar(parsed, imgs.length, ctx));
  } catch (e) {
    res.status(200).json({ ok: false, erro: 'Erro ao chamar a visão: ' + (e && e.message ? e.message : String(e)) });
  }
}

// ------------------------------------------------------------
// Prompt endurecido — regras por campo, contrato tri-estado e
// nulos honestos. Pede SOMENTE JSON.
// ------------------------------------------------------------
function instrucao(ctxTxt) {
  return [
    'Você é o assistente de vistoria de entrada de uma oficina automotiva premium. Analise as fotos do tour 360° do check-in' + (ctxTxt ? ' (' + ctxTxt + ')' : '') + '.',
    'PRINCÍPIO: abster é melhor que chutar. Na menor dúvida devolva null/[]/false e confiança baixa. O consultor humano revisa tudo antes de fechar a OS. Nunca invente km, placa, luzes ou itens. Nunca repita dados do contexto/recepção como se você tivesse lido na foto. Fotos têm no máx. 480px: se um dígito/símbolo ficar pequeno, borrado ou serrilhado, abstenha.',
    '',
    'RESPONDA SOMENTE com um objeto JSON válido (sem prosa, sem markdown, sem cercas), neste formato EXATO:',
    '{',
    '  "km": <inteiro do HODÔMETRO TOTAL, ou null>,',
    '  "combustivel": <inteiro 0-100 do tanque, ou null>,',
    '  "luzes": [<nomes das luzes de alerta REALMENTE acesas>],',
    '  "avarias": [{"x":<0-100>,"y":<0-100>,"nota":"<pt-BR curto>","sev":"baixa|media|alta"}],',
    '  "itensPresentes": {' + CHECKLIST.map(i => '"' + i + '":<true|false|null>').join(',') + '},',
    '  "confianca": <fração 0 a 1>',
    '}',
    '',
    'km (odômetro): apenas o hodômetro TOTAL acumulado (5-7 dígitos fixos). NÃO é velocímetro, conta-giros, trip/parcial (tem decimal ou rótulo TRIP/A/B), autonomia ("km restante"), consumo, relógio nem temperatura. Painel apagado/desligado, "000000", borrão, reflexo, dígito ambíguo ou qualquer dígito coberto ⇒ km=null. Não complete zeros nem adivinhe. Inteiro puro, sem ponto/vírgula/unidade. Assuma km (Brasil); só milhas com rótulo "mi" explícito. Se nenhuma foto mostra o odômetro nítido ⇒ null.',
    'combustivel: percentual do tanque, 0=E/vazio, 100=F/cheio. Ponteiro: E=0,¼=25,½=50,¾=75,F=100. Barras digitais: só se enxergar acesos E apagados. NUNCA use autonomia (km), consumo ou litros como nível. Não confunda com o marcador de TEMPERATURA (C-H). Painel apagado ⇒ null (não é tanque vazio). Ilegível/ausente ⇒ null. NUNCA chute 50.',
    'luzes: array de strings pt-BR só de telltales de FALHA claramente ACESOS (vermelho=crítico, âmbar=atenção). NÃO liste verde/azul (informativos), setas/pisca, farol alto, luz de posição, cinto, porta aberta, combustível baixo, ECO/cruise. Se muitas luzes acendem juntas (autoteste ao ligar a ignição, motor desligado) ⇒ []. Reflexo no vidro pode simular luz ⇒ na dúvida, []. Nomes canônicos: "Check Engine","ABS","Airbag","Freio","TPMS","Pressão do óleo","Temperatura do motor","Bateria/carga","EPC","DPF","Direção elétrica","Service". Sem alerta legível ⇒ [].',
    'avarias: SÓ dano físico real e visível no veículo em vistoria (risco, amassado, trinca, roda/calota raspada, para-brisa trincado, farol quebrado). NÃO reporte sujeira, gotas, poeira, reflexo, brilho, sombra, frestas de design, adesivos nem carro refletido/ao fundo. x/y são inteiros 0-100 (x=0 esq., 100 dir.; y=0 topo, 100 base); se não souber localizar use 50. Comece a nota pela região e lado (ex.: "Porta diant. dir.: risco no verniz"). sev conservador (na dúvida, o menor). Reporte cada dano UMA vez. No máx. ~6 avarias, notas curtas. Nada visível ⇒ [].',
    'itensPresentes: três estados por item — true só se VIR o item na foto certa; false só se o local aparece COMPROVADAMENTE vazio; null se não aparece/fechado/escuro/ilegível. "Não vi" nunca é "não tem" ⇒ null. Não deduza (porta-malas cheio não prova triângulo). Tapetes⇒foto Interior; Triângulo/Macaco/Estepe⇒Porta-malas com forro levantado; Documento e Chave reserva quase sempre null (sem slot no tour).',
    'confianca: fração 0-1 (nunca %). É GLOBAL e reflete a evidência MAIS FRACA entre os campos que você preencheu — uma leitura nítida não compensa outra ilegível. Poucas fotos úteis, reflexo ou borrão ⇒ confiança baixa. Se quase nada foi lido, confiança ≤0.3. Ausente = você não calibrou ⇒ trate como baixa.',
  ].join('\n');
}

// Extrai o primeiro objeto JSON do texto (tolera cercas de markdown).
function extrairJson(t) {
  if (!t) return null;
  let s = String(t).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

// ------------------------------------------------------------
// Coercers dedicados — cada um com default HONESTO (null/[]),
// nunca um valor plausível de preenchimento.
// ------------------------------------------------------------
function slug(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

// km: inteiro do hodômetro total, ou null. Nunca herda ctx.km.
function coerceKm(v) {
  let n;
  if (typeof v === 'number') { if (!isFinite(v)) return null; n = Math.round(v); }
  else if (typeof v === 'string') { const d = v.replace(/[^\d]/g, ''); if (!d) return null; n = parseInt(d, 10); } // separador de milhar BR e sufixos somem
  else return null; // boolean, array, objeto, null, undefined
  if (!isFinite(n) || n <= 0 || n > 2000000) return null; // 0=painel apagado; teto de sanidade contra alucinação/RPM/VIN
  return n;
}

// combustível: inteiro 0-100 (múltiplo de 5), ou null. Preserva 0 real. Nunca 50 de default.
function coerceFuel(v) {
  let n;
  if (typeof v === 'number') { if (!isFinite(v)) return null; n = v; }
  else if (typeof v === 'string') {
    let s = slug(v).replace(',', '.').replace('%', '').trim();
    if (s === '' ) return null;
    if (s === 'e' || s === 'vazio' || s === 'empty') return 0;
    if (s === 'f' || s === 'cheio' || s === 'full') return 100;
    if (s === 'meio' || s === 'metade') return 50;
    const fr = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
    if (fr) { const a = +fr[1], b = +fr[2]; if (!(b > 0)) return null; n = a / b * 100; }
    else { n = parseFloat(s); if (!isFinite(n)) return null; }
  } else return null; // null, boolean, array, objeto
  if (n > 102 || n < -2) return null;          // grosseiramente fora ⇒ provável autonomia/litros ⇒ null (não satura p/ 100)
  n = Math.max(0, Math.min(100, n));
  return Math.round(n / 5) * 5;                 // múltiplo de 5, anti-falsa-precisão a 480px
}

const LUZ_SINON = [
  [/check engine|verificar motor|luz do motor|\bmil\b|injecao/, 'Check Engine'],
  [/airbag|air bag|\bsrs\b/, 'Airbag'],
  [/\babs\b/, 'ABS'],
  [/tpms|pneu/, 'TPMS'],
  [/oleo|\boil\b/, 'Pressão do óleo'],
  [/temperatura|coolant|arrefec/, 'Temperatura do motor'],
  [/bateria|carga|alternador|battery/, 'Bateria/carga'],
  [/\bepc\b/, 'EPC'],
  [/\bdpf\b|particulad/, 'DPF'],
  [/direcao|\beps\b|steering/, 'Direção elétrica'],
  [/freio|brake|\bepb\b/, 'Freio'],
  [/service|revisao/, 'Service'],
];
const LUZ_BLOCK = /farol alto|high beam|\bseta\b|pisca|blinker|posicao|\bdrl\b|cinto|seatbelt|porta|capo|combustivel|reserva|low fuel|\beco\b|cruise|start.?stop|freio de mao|estacionamento|handbrake|neblina|\bfog\b/;
const LUZ_SENT = /^(nenhuma|nenhum|none|n\/?a|na|sem alerta|ok|-|\.)?$/;

// luzes: array de strings canônicas de FALHA. Objeto→nome, string→split, blocklist, canoniza, dedupe.
function coerceLuzes(v) {
  let arr;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') arr = v.split(/[,;]| e /);
  else return [];
  const out = [];
  for (let el of arr) {
    if (el && typeof el === 'object' && !Array.isArray(el)) el = el.nome || el.name || el.label || el.luz || el.text || '';
    if (typeof el !== 'string') continue;
    const nome = el.replace(/[☀-➿\u{1F000}-\u{1FAFF}]/gu, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    const sg = slug(nome);
    if (!sg || LUZ_SENT.test(sg) || LUZ_BLOCK.test(sg)) continue;
    let canon = nome;
    for (const [re, c] of LUZ_SINON) { if (re.test(sg)) { canon = c; break; } }
    if (!out.some(x => slug(x) === slug(canon))) out.push(canon);
    if (out.length >= 8) break;
  }
  return out;
}

const SEV_MAP = [
  [/alta|grave|sever|\balto\b|high|critic/, 'alta'],
  [/media|medio|moderad|medium/, 'media'],
  [/baixa|leve|\blow\b|minor|superficial/, 'baixa'],
];
function coerceSev(v) { const sg = slug(v); for (const [re, s] of SEV_MAP) if (re.test(sg)) return s; return 'baixa'; }
function coercePos(v, def) {
  if (typeof v === 'boolean' || v == null) return def;
  const c = String(v).replace(/[^0-9.\-]/g, '');
  if (c === '' || c === '.' || c === '-') return def;
  const n = Number(c);
  if (!isFinite(n)) return def;
  return Math.max(0, Math.min(100, Math.round(n)));
}
// avarias: array de objetos {x,y,nota,sev}. Envolve objeto único, pula lixo, string→nota, dedupe, ordena por sev, cap 8.
function coerceAvarias(v) {
  let arr;
  if (Array.isArray(v)) arr = v;
  else if (v && typeof v === 'object' && ('x' in v || 'y' in v || 'nota' in v || 'sev' in v)) arr = [v];
  else return [];
  const out = [];
  for (let el of arr) {
    if (el == null) continue;
    if (typeof el === 'string') el = { nota: el };
    if (typeof el !== 'object' || Array.isArray(el)) continue;
    const nota = (typeof el.nota === 'string' && el.nota.trim()) ? el.nota.trim().slice(0, 120) : 'Avaria detectada';
    out.push({ x: coercePos(el.x, 50), y: coercePos(el.y, 50), nota, sev: coerceSev(el.sev) });
  }
  const seen = new Set(), dd = [];
  for (const a of out) { const k = a.x + '|' + a.y + '|' + a.nota + '|' + a.sev; if (!seen.has(k)) { seen.add(k); dd.push(a); } }
  const rank = { alta: 0, media: 1, baixa: 2 };
  dd.sort((a, b) => rank[a.sev] - rank[b.sev]);
  return dd.slice(0, 8);
}

const ITEM_ALIAS = [
  [/document|crlv/, 'Documento (CRLV)'],
  [/chave/, 'Chave reserva'],
  [/triangulo/, 'Triângulo'],
  [/macaco|chave de roda/, 'Macaco/chave de roda'],
  [/estepe|reparo|\bkit\b/, 'Estepe/kit reparo'],
  [/tapete/, 'Tapetes originais'],
];
function statusItem(v) {
  if (v === true) return 'presente';
  if (v === false) return 'ausente';
  if (typeof v === 'number') return v === 1 ? 'presente' : (v === 0 ? 'ausente' : 'naoVerificado');
  if (typeof v === 'string') {
    const s = slug(v);
    if (['true', 'sim', 'presente', 'ok', '1'].includes(s)) return 'presente';
    if (['false', 'nao', 'ausente', 'faltante', '0'].includes(s)) return 'ausente';
  }
  return 'naoVerificado';
}
// itens: tri-estado. Default de desconhecido = naoVerificado (nunca presente). itens[] bool p/ os checkboxes.
function coerceItens(v) {
  const status = {}; CHECKLIST.forEach(n => { status[n] = 'naoVerificado'; });
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const kk of Object.keys(v)) {
      const sg = slug(kk);
      let canon = CHECKLIST.find(n => slug(n) === sg) || null;
      if (!canon) for (const [re, name] of ITEM_ALIAS) { if (re.test(sg)) { canon = name; break; } }
      if (canon) status[canon] = statusItem(v[kk]);
    }
  }
  return {
    itens: CHECKLIST.map(n => status[n] === 'presente'),           // só presente confirmado marca o checkbox
    itensFaltantes: CHECKLIST.filter(n => status[n] === 'ausente'), // só ausência comprovada
    itensNaoVerificados: CHECKLIST.filter(n => status[n] === 'naoVerificado'),
  };
}

// confiança do modelo: fração [0,1]; ausente/fora de faixa ⇒ baixa (0.3). Nunca infla.
function coerceConf(v) {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') n = Number(v.replace(',', '.'));
  else n = NaN;
  if (!isFinite(n) || n < 0 || n > 1) return 0.3;
  return n;
}
// confiança final = min(modelo, cap por cobertura de fotos, piso quando nada foi lido). Só mantém ou rebaixa.
function confiancaFinal(confModelo, lidos, fotos) {
  const capFotos = fotos <= 1 ? 0.5 : fotos === 2 ? 0.6 : fotos === 3 ? 0.7 : 1;
  let c = Math.min(confModelo, capFotos);
  if (lidos === 0) c = Math.min(c, 0.3);   // lote sem extração não sustenta confiança alta
  return Math.round(c * 100) / 100;
}

// Normaliza a saída da IA para o contrato do WERK OS (+ campos aditivos de honestidade).
function normalizar(p, n, ctx) {
  p = p || {};
  const km = coerceKm(p.km);
  const combustivel = coerceFuel(p.combustivel);
  const luzes = coerceLuzes(p.luzes);
  const avarias = coerceAvarias(p.avarias);
  const it = coerceItens(p.itensPresentes);
  const confirmados = it.itens.filter(Boolean).length + it.itensFaltantes.length;
  const lidos = (km != null ? 1 : 0) + (combustivel != null ? 1 : 0) + (luzes.length ? 1 : 0) + (avarias.length ? 1 : 0) + (confirmados ? 1 : 0);
  const kmRecepcaoNum = ctx && isFinite(Number(ctx.km)) && Number(ctx.km) > 0 ? Math.round(Number(ctx.km)) : null;
  return {
    ok: true,
    modo: 'ia',
    km,
    kmFonte: km != null ? 'ia' : null,          // 'ia' = lido da foto; null = não lido (ctx fica separado)
    kmRecepcao: kmRecepcaoNum,                    // valor informado na recepção — NUNCA fundido com km
    combustivel,
    combustivelLido: combustivel != null,
    luzes,
    avarias,
    itens: it.itens,
    itensFaltantes: it.itensFaltantes,
    itensNaoVerificados: it.itensNaoVerificados,  // a conferir manualmente (separado de "faltando")
    confianca: confiancaFinal(coerceConf(p.confianca), lidos, n),
    fotosAnalisadas: n,
  };
}

module.exports = handler;
// Expostos para a bateria de testes (api/analisar-fotos.eval.js). O default export segue sendo o handler da Vercel.
module.exports._internals = { normalizar, extrairJson, coerceKm, coerceFuel, coerceLuzes, coerceAvarias, coerceItens, coerceConf, confiancaFinal, CHECKLIST, SLOTS };
