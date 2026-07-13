// ============================================================
// LexOS · WERK OS — perito de diagnóstico do scanner por IA
// ------------------------------------------------------------
// O mecânico anexa o laudo do scanner — QUALQUER marca (BMW ISTA,
// Autel, Launch, Thinkcar, ELM327/OBD-II genérico) — como FOTO da
// tela/impressão OU PDF exportado, e a Claude age como um MESTRE
// de diagnóstico automotivo: TRANSCREVE e traduz o laudo, extrai
// cada código (hex proprietário ou SAE P/C/B/U), separa CAUSA-RAIZ
// de código CONSEQUENTE, prioriza e sugere os passos.
//
// Consome ANTHROPIC_API_KEY (cole na Vercel — nunca no código).
// Sem a chave, responde { ok:false } e o painel cai no modo manual.
//
// Prompt + normalizador ENDURECIDOS por agentes especialistas:
//  - PRINCÍPIO-MESTRE: TRANSCREVER, NÃO ADIVINHAR. Tudo na saída
//    tem de existir LITERALMENTE no anexo. Na dúvida: null + baixa
//    confiança, nunca um valor plausível.
//  - Portões duros (reforçados no JS, não só no prompt): sistemas
//    de SEGURANÇA (airbag/freio/direção) nunca são "liberados" e
//    exigem confirmação do técnico; laudo ilegível ⇒ zera códigos
//    e confiança; VIN nunca sai por extenso (mascarado).
// ============================================================

const MAX_BYTES = 8 * 1024 * 1024; // ~8 MB por anexo já decodificado
const SIST_CRITICOS = ['airbag/seguranca', 'freios/estabilidade', 'direcao'];

async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, erro: 'Use POST.' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ ok: false, erro: 'IA de diagnóstico não configurada (defina ANTHROPIC_API_KEY na Vercel).' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  const ctx = body.ctx || {};

  // texto = seção de memória de falhas já extraída do PDF no navegador (pdf.js).
  // Enviar só isso, em vez das páginas do PDF como imagem, corta ~10× o custo de
  // entrada (o PDF inteiro é tokenizado; o texto filtrado, não).
  const textoExtraido = (typeof body.texto === 'string') ? body.texto.slice(0, 60000) : '';

  let brutos = body.arquivos || body.arquivo || [];
  if (!Array.isArray(brutos)) brutos = [brutos];
  const anexos = [];
  for (const url of brutos) {
    if (typeof url !== 'string') continue;
    const m = /^data:(image\/[a-zA-Z0-9.+-]+|application\/pdf);base64,(.+)$/.exec(url);
    if (!m) continue;
    if (m[2].length * 0.75 > MAX_BYTES) continue;
    anexos.push({ media_type: m[1], data: m[2], pdf: m[1] === 'application/pdf' });
    if (anexos.length >= 6) break;
  }
  if (!anexos.length && !textoExtraido) { res.status(200).json({ ok: false, erro: 'Nenhum anexo válido (envie foto JPG/PNG, PDF do ISTA ou o texto da memória de falhas).' }); return; }

  const content = [];
  if (textoExtraido) content.push({ type: 'text', text: 'MEMÓRIA DE FALHAS extraída do laudo do scanner (texto do PDF, seção de códigos + cabeçalho do veículo). Transcreva/traduza a partir DESTE texto:\n\n' + textoExtraido });
  for (const a of anexos) {
    if (a.pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
    else content.push({ type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.data } });
  }
  const ctxTxt = [
    ctx.modelo ? 'Modelo informado: ' + ctx.modelo : '',
    ctx.placa ? 'Placa: ' + ctx.placa : '',
    (ctx.km != null && ctx.km !== '') ? 'KM da recepção: ' + ctx.km : '',
  ].filter(Boolean).join(' · ');
  content.push({ type: 'text', text: instrucao(ctxTxt) });

  // Haiku por padrão (mais barato); com o texto já extraído, dá conta da transcrição.
  // Para máxima profundidade de diagnóstico, defina ANTHROPIC_MODEL_ISTA=claude-sonnet-5.
  const model = process.env.ANTHROPIC_MODEL_ISTA || 'claude-haiku-4-5';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      // thinking OFF: é transcrição do laudo, não raciocínio — sem isso o modelo
      // gastava todo o orçamento "pensando" no PDF grande e não sobrava p/ o JSON.
      body: JSON.stringify({ model, max_tokens: 8000, thinking: { type: 'disabled' }, messages: [{ role: 'user', content }] }),
    });
    if (!r.ok) {
      const detalhe = await r.text().catch(() => '');
      res.status(200).json({ ok: false, erro: 'Falha na IA de diagnóstico (' + r.status + ').', detalhe: String(detalhe).slice(0, 300) });
      return;
    }
    const data = await r.json();
    const texto = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    const parsed = extrairJson(texto);
    if (!parsed) { res.status(200).json({ ok: false, erro: 'Resposta da IA sem JSON legível.' }); return; }
    res.status(200).json(normalizar(parsed, anexos.length || (textoExtraido ? 1 : 0)));
  } catch (e) {
    res.status(200).json({ ok: false, erro: 'Erro ao chamar a IA: ' + (e && e.message ? e.message : String(e)) });
  }
}

// ------------------------------------------------------------
// Prompt do perito — pt-BR, TRANSCREVER-não-adivinhar, JSON estrito.
// ------------------------------------------------------------
function instrucao(ctxTxt) {
  return [
    'Você é um MESTRE em diagnóstico automotivo, anos de balcão com scanners de todas as marcas (BMW ISTA/ISTA-D, Autel, Launch, Thinkcar, ELM327/OBD-II genérico). Recebeu o laudo de diagnóstico de um scanner (foto da tela/impressão ou PDF)' + (ctxTxt ? ' — contexto da recepção: ' + ctxTxt : '') + '.',
    '',
    'PRINCÍPIO-MESTRE: TRANSCREVER, NÃO ADIVINHAR. Você LÊ e TRADUZ o laudo para o mecânico — você NÃO diagnostica o carro no lugar dele. Todo código, texto, módulo e leitura na sua saída tem de existir LITERALMENTE na imagem/PDF. Código não é diagnóstico: sem medição/inspeção física, nada é conclusivo. O mecânico revisa tudo antes de qualquer reparo.',
    '',
    'REGRAS (invioláveis):',
    '1) NUNCA invente código, descrição, módulo, valor medido, freeze-frame ou data que não estejam impressos. "descricao" é a TRANSCRIÇÃO do texto do laudo (traduza alemão/inglês→pt-BR); não melhore a descrição pelo seu conhecimento do código. Sem texto no laudo ⇒ descricao curta e observe. Sem código legível ⇒ codigos:[].',
    '2) FORMATO DO CÓDIGO: copie EXATAMENTE como impresso. Padrão SAE/OBD-II = letra + 4 díg. (P=motor/transmissão, C=chassi/freios/direção, B=carroceria, U=rede — ex. "P0016","C1234","B00A0","U0100") ⇒ formato "sae". Código proprietário de fabricante em hex (ex. BMW "00A6B2","801C33"; 4–6 díg. hexadecimais) ⇒ "hex_bmw". Sem certeza ⇒ "desconhecido". NÃO converta um formato no outro nem invente o "P" equivalente. Caractere ambíguo em foto (0/O/D, 8/B, 5/S, 1/I, 2/Z, 6/G) ⇒ caractere_ambiguo:true e cite em observacoes, não escolha no chute.',
    '3) LEGIBILIDADE: se estiver borrado, com reflexo, cortado ou sem o cabeçalho do módulo, legivel:false, recaptura_necessaria:true e diga em motivo_recaptura o que refazer. Com ilegível NÃO emita códigos.',
    '4) CAUSA-RAIZ vs CONSEQUENTE: em qualquer marca, bateria fraca/subtensão ("Unterspannung", Klemme 30/15, "low voltage"), massa/aterramento ruim, um conector solto ou perda de comunicação de barramento (CAN/LIN/K-CAN/PT-CAN/FlexRay, "sem mensagem do módulo X", "lost communication") DISPARAM dezenas de códigos em vários módulos. Marque esses como tipo "consequente"; aponte a provável causa comum em causa_raiz_provavel (SEMPRE hipótese a confirmar, nunca conclusão) e ALERTE contra trocar peça por cada código.',
    '5) SEGURANÇA: código de airbag/SRS/ACSM, cinto/pré-tensionador, freio/DSC/ABS ou direção/EPS ⇒ critico_seguranca:true. NUNCA diga que o carro está seguro para rodar, NUNCA sugira "apagar o código e liberar" e NUNCA cravar a causa. requer_confirmacao_profissional:true e um aviso claro em avisos_seguranca.',
    '6) MEDIR ANTES: nunca condene peça a partir do código. Se a decisão depende de medição/inspeção, exige_medicao:true e descreva em "medicao" o passo objetivo (ex.: teste de bateria/IBS + tensão de repouso; misfire ⇒ dados ao vivo/compressão; interrupção/curto ⇒ resistência e continuidade no conector). Verbo condicional ("indica/sugere"), nunca "a peça X está com defeito".',
    '7) NUNCA gere número de peça, referência OEM, preço, mão de obra ou tempo. Não é estimável do laudo — orçamento é da oficina.',
    '8) PRIVACIDADE: não repita o VIN inteiro (devolva chassi mascarado ou null). Ignore nome/endereço/telefone/e-mail do cabeçalho. Não use o odômetro do freeze-frame como km atual.',
    '9) O anexo pode ser de QUALQUER scanner ou marca — aceite todos. eh_ista:true sempre que houver um laudo de diagnóstico legível (códigos de falha/DTC de qualquer padrão). Marque eh_ista:false SOMENTE se o anexo não for um diagnóstico (selfie, documento aleatório, foto sem códigos).',
    '10) LAUDO GRANDE: se houver muitos códigos, liste NO MÁXIMO os 20 mais relevantes — causa-raiz e críticos de segurança PRIMEIRO, depois por severidade (crítica→alta→média→baixa). Informe quantos ficaram de fora em "codigos_omitidos" (int, 0 se listou todos). Mantenha "descricao", "medicao", "causa_provavel" e "acao" concisos (1 frase cada) para o JSON caber inteiro.',
    '',
    'RESPONDA SOMENTE com um objeto JSON válido (sem prosa/markdown/cercas), EXATAMENTE assim:',
    '{',
    '  "eh_ista": <bool>, "legivel": <bool>, "recaptura_necessaria": <bool>, "motivo_recaptura": <str|null>,',
    '  "veiculo": {"modelo": <str|null>, "chassi": <str curto/mascarado|null>, "km": <int|null>},',
    '  "resumo_executivo": "<2-4 frases claras p/ o consultor repassar>",',
    '  "causa_raiz_provavel": <str|null — hipótese a confirmar>,',
    '  "requer_confirmacao_profissional": <bool>, "avisos_seguranca": [<str>],',
    '  "codigos": [{"codigo":"<exato>","formato":"hex_bmw|sae|desconhecido","modulo":<str|null>,"descricao":"<transcrito+traduzido>","sistema":"motor|transmissao|freios/estabilidade|direcao|airbag/seguranca|eletrica|arrefecimento|conforto|carroceria|outro","severidade":"baixa|media|alta|critica","tipo":"raiz|consequente|indefinido","critico_seguranca":<bool>,"caractere_ambiguo":<bool>,"exige_medicao":<bool>,"medicao":<str|null>,"termo_peca":<str|null — termo curto p/ buscar a peça no catálogo, ex. "bobina de ignição"/"Zündspule"; só o nome do componente, sem nº de peça>,"causa_provavel":"<condicional>","acao":"<próxima ação>"}],',
    '  "sistemas_afetados": [<str>], "prioridades": [<str, do mais crítico ao cosmético>], "proximos_passos": [<medições/testes ANTES de orçar>],',
    '  "codigos_omitidos": <int — quantos códigos ficaram de fora do array (0 se listou todos)>,',
    '  "observacoes": "<ressalvas, o que ficou ilegível/ambíguo>", "confianca": <0 a 1>',
    '}',
  ].join('\n');
}

function extrairJson(t) {
  if (!t) return null;
  let s = String(t).trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{');
  if (a < 0) return null;
  s = s.slice(a);
  // 1) tentativa direta: do 1º { ao último }
  const b = s.lastIndexOf('}');
  if (b > 0) { try { return JSON.parse(s.slice(0, b + 1)); } catch (_) { /* segue p/ reparo */ } }
  // 2) reparo de truncamento (max_tokens estourado): fecha string/estruturas abertas
  try { const rep = repararJson(s); if (rep) return JSON.parse(rep); } catch (_) {}
  return null;
}
// Fecha um JSON cortado no meio: termina string aberta, remove token pendente e
// completa os colchetes/chaves que ficaram abertos. O normalizador é tolerante a
// objetos de código parciais, então salvamos o laudo em vez de perder tudo.
function repararJson(s) {
  const stack = [];
  let inStr = false, esc = false, out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += ch;
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) out += '"';                        // fecha a string cortada
  out = out.replace(/[\s,]*$/, '');             // tira vírgula/espaço solto no fim
  if (/"\s*:\s*$/.test(out)) out += 'null';     // "chave": <cortado> → null
  out = out.replace(/,\s*"[^"]*"\s*$/, '');     // ..., "chaveSemValor" → descarta
  for (let k = stack.length - 1; k >= 0; k--) out += (stack[k] === '{' ? '}' : ']');
  return out;
}

// ------------ coercers / portões de segurança ------------
function slug(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
// remove qualquer VIN de 17 caracteres (proteção de privacidade, no JS)
function maskVin(s) { return String(s == null ? '' : s).replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, m => '•••••••' + m.slice(-4)); }
function str(v, max) { const s = (typeof v === 'string' && v.trim()) ? v.trim() : ''; return maskVin(s).slice(0, max || 240); }
function strOrNull(v, max) { const s = str(v, max); return s || null; }
function boolish(v, def) { if (v === true) return true; if (v === false) return false; const s = slug(v); if (['true', 'sim', '1', 'yes'].includes(s)) return true; if (['false', 'nao', '0', 'no'].includes(s)) return false; return def; }

const SEVS = ['baixa', 'media', 'alta', 'critica'];
function coerceSev(v) { const sg = slug(v); if (/critic|grave|fatal/.test(sg)) return 'critica'; if (/alta|alto|high|serio/.test(sg)) return 'alta'; if (/media|medio|moder|medium/.test(sg)) return 'media'; if (/baixa|leve|low|minor/.test(sg)) return 'baixa'; return 'media'; }
function coerceTipo(v) { const sg = slug(v); if (/raiz|root|origem|gatilho|primar/.test(sg)) return 'raiz'; if (/consequen|secundar|follow|deriv/.test(sg)) return 'consequente'; return 'indefinido'; }
function coerceFormato(v, codigo) {
  const sg = slug(v);
  const c = String(codigo || '').trim();
  if (/^[PBCU]\d{4}$/i.test(c)) return 'sae';            // o código manda: SAE/OBD-II
  if (/sae|p.?code|obd/.test(sg)) return 'sae';
  if (/hex|bmw/.test(sg)) return 'hex_bmw';
  if (/^[0-9A-F]{4,6}$/i.test(c)) return 'hex_bmw';
  return 'desconhecido';
}
const SISTEMAS = ['motor', 'transmissao', 'freios/estabilidade', 'direcao', 'airbag/seguranca', 'eletrica', 'arrefecimento', 'conforto', 'carroceria', 'outro'];
function coerceSistema(v) {
  const sg = slug(v);
  if (/motor|dme|dde|engine|inject|vanos|valvetronic|misfire|combust/.test(sg)) return 'motor';
  if (/transmiss|cambio|egs|gearbox|embreagem/.test(sg)) return 'transmissao';
  if (/freio|dsc|dbc|dxc|abs|estabilidade|brake/.test(sg)) return 'freios/estabilidade';
  if (/direcao|steering|eps|servotronic/.test(sg)) return 'direcao';
  if (/airbag|srs|acsm|mrs|seguranca|cinto|pretensor|safety|crash/.test(sg)) return 'airbag/seguranca';
  if (/eletric|elétr|eletr|elect|bateria|chicote|conector|modulo|barramento|can|kombi|\bcas\b|frm/.test(sg)) return 'eletrica';
  if (/arrefec|coolant|radiador|temperatura/.test(sg)) return 'arrefecimento';
  if (/conforto|ar.?cond|ihka|banco|vidro/.test(sg)) return 'conforto';
  if (/carro|lataria|body|porta|capo/.test(sg)) return 'carroceria';
  return SISTEMAS.includes(sg) ? sg : 'outro';
}
function coerceKm(v) {
  let n;
  if (typeof v === 'number') n = Math.round(v);
  else if (typeof v === 'string') { const d = v.replace(/[^\d]/g, ''); if (!d) return null; n = parseInt(d, 10); }
  else return null;
  if (!isFinite(n) || n <= 0 || n > 2000000) return null;
  return n;
}
function arrStr(v, maxItens, maxLen) {
  let arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[;\n]/) : []);
  const out = [];
  for (let el of arr) { const s = str(el, maxLen || 160); if (s && !out.includes(s)) out.push(s); if (out.length >= (maxItens || 12)) break; }
  return out;
}
function coerceCodigos(v) {
  if (!Array.isArray(v)) return [];
  const out = []; const seen = new Set();
  for (let el of v) {
    if (typeof el === 'string') el = { codigo: el };
    if (!el || typeof el !== 'object') continue;
    const codigo = str(el.codigo, 40);
    const descricao = str(el.descricao || el.desc || el.texto, 260);
    if (!codigo && !descricao) continue;
    const chave = slug(codigo + '|' + descricao);
    if (seen.has(chave)) continue; seen.add(chave);
    const sistema = coerceSistema(el.sistema);
    const critico = boolish(el.critico_seguranca, false) || SIST_CRITICOS.includes(sistema); // portão: sistema crítico força o flag
    out.push({
      codigo: codigo || '—',
      formato: coerceFormato(el.formato, codigo),
      modulo: strOrNull(el.modulo, 40),
      descricao: descricao || 'Falha registrada',
      sistema,
      severidade: critico ? (coerceSev(el.severidade) === 'baixa' ? 'alta' : coerceSev(el.severidade)) : coerceSev(el.severidade),
      tipo: coerceTipo(el.tipo),
      critico_seguranca: critico,
      caractere_ambiguo: boolish(el.caractere_ambiguo, false),
      exige_medicao: boolish(el.exige_medicao, false),
      medicao: strOrNull(el.medicao, 300),
      termo_peca: strOrNull(el.termo_peca || el.termoPeca, 80),
      causa_provavel: str(el.causa_provavel || el.causa, 300),
      acao: str(el.acao || el.recomendacao, 300),
    });
    if (out.length >= 40) break;
  }
  const rank = { critica: 0, alta: 1, media: 2, baixa: 3 };
  out.sort((a, b) => (rank[a.severidade] - rank[b.severidade]) || (a.tipo === 'raiz' ? -1 : 1));
  return out;
}
function coerceConf(v) {
  let n; if (typeof v === 'number') n = v; else if (typeof v === 'string') n = Number(v.replace(',', '.').replace('%', '')); else n = NaN;
  if (!isFinite(n)) return 0.4;
  if (n > 1 && n <= 100) n = n / 100;
  if (n < 0 || n > 1) return 0.4;
  return Math.round(n * 100) / 100;
}

function normalizar(p, nAnexos) {
  p = p || {};
  if (!boolish(p.eh_ista, true)) {
    return { ok: true, modo: 'ia', eh_ista: false, legivel: false, recaptura_necessaria: false, motivo_recaptura: null, resumo_executivo: 'O anexo não parece um laudo de scanner. Envie a tela de códigos de falha do aparelho (ISTA, Autel, Launch…) ou o PDF exportado.', causa_raiz_provavel: null, requer_confirmacao_profissional: false, avisos_seguranca: [], codigos: [], sistemas_afetados: [], prioridades: [], proximos_passos: [], observacoes: '', confianca: 0, veiculo: { modelo: null, chassi: null, km: null }, anexos: nAnexos };
  }
  const legivel = boolish(p.legivel, true);
  const vo = p.veiculo && typeof p.veiculo === 'object' ? p.veiculo : {};
  let codigos = legivel ? coerceCodigos(p.codigos) : [];          // portão: ilegível zera códigos
  let conf = coerceConf(p.confianca);
  if (!legivel) conf = Math.min(conf, 0.3);                        // portão: ilegível limita confiança

  const temCritico = codigos.some(c => c.critico_seguranca);
  const requerConf = boolish(p.requer_confirmacao_profissional, false) || temCritico; // portão de segurança
  let avisos = arrStr(p.avisos_seguranca, 6, 220);
  if (temCritico && !avisos.length) avisos = ['Há código de sistema de segurança (airbag/freio/direção). Não libere o veículo — exige confirmação e medição do técnico antes de qualquer ação.'];

  return {
    ok: true,
    modo: 'ia',
    eh_ista: true,
    legivel,
    recaptura_necessaria: boolish(p.recaptura_necessaria, !legivel),
    motivo_recaptura: strOrNull(p.motivo_recaptura, 240),
    veiculo: { modelo: strOrNull(vo.modelo, 80), chassi: strOrNull(vo.chassi, 24), km: coerceKm(vo.km) },
    resumo_executivo: str(p.resumo_executivo || p.resumo, 900) || (legivel ? 'Diagnóstico lido — confira os códigos abaixo.' : 'Laudo pouco legível — recomendo reenviar uma captura mais nítida.'),
    causa_raiz_provavel: strOrNull(p.causa_raiz_provavel || p.causaRaiz, 400),
    requer_confirmacao_profissional: requerConf,
    avisos_seguranca: avisos,
    codigos,
    codigos_omitidos: Math.max(0, parseInt(p.codigos_omitidos, 10) || 0),
    sistemas_afetados: arrStr(p.sistemas_afetados, 10, 60),
    prioridades: arrStr(p.prioridades, 10, 200),
    proximos_passos: arrStr(p.proximos_passos || p.proximosPassos, 12, 220),
    observacoes: str(p.observacoes, 600),
    confianca: conf,
    anexos: nAnexos,
  };
}

module.exports = handler;
// Vercel: laudo de PDF grande (dezenas de páginas) pode levar ~1 min — dá folga.
module.exports.config = { maxDuration: 120 };
module.exports._internals = { normalizar, extrairJson, coerceCodigos, coerceSev, coerceTipo, coerceSistema, coerceFormato, coerceKm, coerceConf, maskVin, SEVS, SISTEMAS, SIST_CRITICOS };
