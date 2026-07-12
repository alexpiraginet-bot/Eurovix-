// ============================================================
// EUROVIX · WERK OS — visão real das fotos de check-in
// ------------------------------------------------------------
// Função serverless (Vercel). Recebe as fotos do tour 360° e
// devolve, no MESMO formato do modo assistido, a leitura de:
// odômetro, combustível, luzes de alerta, avarias e itens do
// checklist. Consome a variável de ambiente ANTHROPIC_API_KEY
// (você cola a chave no painel da Vercel — nunca no código).
//
// Sem a chave configurada, responde { ok:false } e o app cai
// automaticamente no modo assistido (heurístico) — nada quebra.
// Modelo padrão: barato para visão em escala; troque com a
// variável ANTHROPIC_MODEL se quiser mais precisão.
// ============================================================

// Rótulos dos slots do tour (índice → ângulo), espelham o painel.
const SLOTS = ['Frente', 'Traseira', 'Lateral esq.', 'Lateral dir.', 'Teto', 'Interior', 'Painel/odômetro', 'Porta-malas'];
// Checklist de itens conferidos na entrada (mesma ordem do WERK OS).
const CHECKLIST = ['Documento (CRLV)', 'Chave reserva', 'Triângulo', 'Macaco/chave de roda', 'Estepe/kit reparo', 'Tapetes originais'];
const MAX_FOTOS = 8; // teto por consulta — controla custo e latência

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, erro: 'Use POST.' }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ ok: false, erro: 'Visão não configurada (defina ANTHROPIC_API_KEY na Vercel).' }); return; }

  // Corpo pode chegar já parseado (objeto) ou como string.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  const fotos = body.fotos || {};
  const ctx = body.ctx || {};

  // fotos = { indiceSlot: dataURL } (ou array) → normaliza para blocos de imagem.
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

  // Conteúdo: rótulo + imagem para cada foto e, por último, a instrução.
  const content = [];
  for (const im of imgs) {
    content.push({ type: 'text', text: 'Foto — ' + im.rotulo + ':' });
    content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
  }
  const ctxTxt = [
    ctx.modelo ? 'Modelo: ' + ctx.modelo : '',
    ctx.placa ? 'Placa: ' + ctx.placa : '',
    ctx.vin ? 'VIN: ' + ctx.vin : '',
    (ctx.km ? 'Km informado na recepção: ' + ctx.km : ''),
  ].filter(Boolean).join(' · ');
  content.push({ type: 'text', text: instrucao(ctxTxt) });

  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content }] }),
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
};

// Prompt: pede SÓ um JSON no formato que o WERK OS consome.
function instrucao(ctxTxt) {
  return [
    'Você é o assistente de vistoria de entrada de uma oficina automotiva premium.',
    'Analise as fotos do check-in' + (ctxTxt ? ' (' + ctxTxt + ')' : '') + ' e extraia os dados abaixo.',
    'Responda SOMENTE com um objeto JSON válido — sem texto antes/depois e sem cercas de markdown.',
    '',
    'Formato exato:',
    '{',
    '  "km": <inteiro do odômetro, ou null se ilegível>,',
    '  "combustivel": <0 a 100, percentual do tanque estimado pelo ponteiro>,',
    '  "luzes": [<nomes das luzes de alerta ACESAS no painel, ex.: "Check Engine","ABS","TPMS"; [] se nenhuma>],',
    '  "avarias": [{ "x": <0-100 posição horizontal na carroceria>, "y": <0-100 vertical>, "nota": "<descrição curta em pt-BR>", "sev": "baixa|media|alta" }],',
    '  "itensPresentes": { ' + CHECKLIST.map(i => '"' + i + '": <true|false>').join(', ') + ' },',
    '  "confianca": <0 a 1, sua confiança geral na leitura>',
    '}',
    '',
    'Regras: relate apenas avarias realmente visíveis (riscos, amassados, trincas, rodas raspadas).',
    'Se um item do checklist não aparecer em nenhuma foto, marque false. Nunca invente placa nem km.',
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

// Normaliza a saída da IA para o contrato do WERK OS (mesmo shape do modo assistido).
function normalizar(p, n, ctx) {
  const clamp = (v, lo, hi, d) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const pres = p.itensPresentes || {};
  const itens = CHECKLIST.map(nome => pres[nome] !== false);           // desconhecido → presente
  const itensFaltantes = CHECKLIST.filter((_, i) => !itens[i]);
  const avarias = Array.isArray(p.avarias) ? p.avarias.slice(0, 8).map(a => ({
    x: clamp(a.x, 0, 100, 50), y: clamp(a.y, 0, 100, 50),
    nota: String(a.nota || 'Avaria detectada').slice(0, 120),
    sev: ['baixa', 'media', 'alta'].includes(a.sev) ? a.sev : 'media',
  })) : [];
  const luzes = Array.isArray(p.luzes) ? p.luzes.map(String).map(s => s.trim()).filter(Boolean).slice(0, 8) : [];
  const kmModelo = Number(p.km); const kmCtx = Number(ctx && ctx.km);
  const km = isFinite(kmModelo) && kmModelo > 0 ? Math.round(kmModelo) : (isFinite(kmCtx) && kmCtx > 0 ? Math.round(kmCtx) : null);
  return {
    ok: true,
    modo: 'ia',
    km,
    combustivel: Math.round(clamp(p.combustivel, 0, 100, 50)),
    luzes, avarias, itens, itensFaltantes,
    confianca: clamp(p.confianca, 0, 1, 0.9),
    fotosAnalisadas: n,
  };
}
