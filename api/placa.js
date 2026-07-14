// ============================================================
// LexOS · WERK OS — consulta de placa (ApiPlacas / apiplacas.com.br)
// ------------------------------------------------------------
// O painel chama /api/placa?placa=ABC1D23 no check-in e recebe os
// dados do veículo (marca, modelo, ano, cor, chassi→VIN, combustível)
// para preencher automaticamente a OS.
//
// O TOKEN é segredo: vem da env APIPLACAS_TOKEN (defina na Vercel),
// NUNCA fica no código/repositório. Sem token → { ok:false } e o
// painel segue no preenchimento manual.
//
// Endpoint (GET, placa + token no path). Configurável por env
// APIPLACAS_URL caso o provedor mude a base.
// ============================================================

const DEFAULT_BASE = 'https://wdapi2.com.br/consulta'; // ApiPlacas (apiplacas.com.br)
// Placa BR: antiga AAA9999 e Mercosul AAA9A99 → 3 letras + díg + (díg|letra) + 2 díg.
const RE_PLACA = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;

async function handler(req, res) {
  const token = process.env.APIPLACAS_TOKEN;
  const base = (process.env.APIPLACAS_URL || DEFAULT_BASE).replace(/\/+$/, '');

  const bruta = (req.query && req.query.placa) || placaDaUrl(req.url) || '';
  const placa = String(bruta).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!RE_PLACA.test(placa)) { res.status(200).json({ ok: false, erro: 'Placa inválida (use AAA0A00 ou AAA9999).' }); return; }
  if (!token) { res.status(200).json({ ok: false, erro: 'Consulta de placa não configurada (defina APIPLACAS_TOKEN na Vercel).' }); return; }

  try {
    const r = await fetch(base + '/' + placa + '/' + token, { headers: { accept: 'application/json' } });
    const txt = await r.text();
    let d = null; try { d = JSON.parse(txt); } catch (_) { /* resposta não-JSON */ }
    if (!d || typeof d !== 'object') {
      res.status(200).json({ ok: false, erro: 'Falha na consulta de placa (' + r.status + ').' });
      return;
    }
    // ApiPlacas sinaliza erro (placa não encontrada / sem créditos / token) em
    // "mensagemRetorno" (ou message/erro conforme o caso).
    const temDados = pick(d, 'MARCA', 'marca', 'MODELO', 'modelo') || (d.extra && pick(d.extra, 'marca', 'modelo'));
    if (!temDados) {
      const msg = pick(d, 'mensagemRetorno', 'message', 'mensagem', 'erro', 'error');
      res.status(200).json({ ok: false, erro: msg ? String(msg).slice(0, 160) : 'Placa não encontrada.' });
      return;
    }
    res.status(200).json(normalizar(d, placa));
  } catch (e) {
    res.status(200).json({ ok: false, erro: 'Erro ao consultar a placa — tente de novo.' });
  }
}

function placaDaUrl(url) {
  try { return new URL(url, 'http://x').searchParams.get('placa'); } catch (_) { return null; }
}
function pick(o, ...ks) { if (!o) return null; for (const k of ks) { if (o[k] != null && o[k] !== '') return o[k]; } return null; }
function soAno(v) { const s = String(v == null ? '' : v).replace(/\D/g, ''); return s ? s.slice(0, 4) : null; }

// Normaliza o formato do ApiPlacas para o que o WERK.consultarPlaca espera:
// { ok, vin, modelo, marca, anoModelo, cor, combustivel }. Tolerante a variações
// de nome de campo (MAIÚSCULAS x minúsculas) e ao objeto "extra".
function normalizar(d, placa) {
  const ex = (d.extra && typeof d.extra === 'object') ? d.extra : {};
  // No retorno real o "extra" às vezes vem vazio e combustível/ano só existem
  // no bloco FIPE (fipe.dados[0]) — daí a busca em três camadas.
  const fipe = (d.fipe && Array.isArray(d.fipe.dados) && d.fipe.dados[0]) ? d.fipe.dados[0] : {};
  const marca = pick(d, 'MARCA', 'marca') || pick(ex, 'marca', 'MARCA');
  const modelo = pick(d, 'MODELO', 'modelo') || pick(ex, 'modelo', 'MODELO');
  const chassi = pick(d, 'chassi', 'CHASSI', 'chassis') || pick(ex, 'chassi', 'CHASSI');
  const anoMod = pick(d, 'anoModelo', 'ano_modelo', 'ano') || pick(ex, 'ano_modelo', 'anoModelo', 'ano') || pick(fipe, 'ano_modelo');
  const cor = pick(d, 'cor', 'COR') || pick(ex, 'cor', 'COR');
  const comb = pick(ex, 'combustivel', 'COMBUSTIVEL', 'combustível') || pick(d, 'combustivel') || pick(fipe, 'combustivel');
  const municipio = pick(d, 'municipio', 'MUNICIPIO') || pick(ex, 'municipio', 'MUNICIPIO');
  const uf = pick(d, 'uf', 'UF') || pick(ex, 'uf', 'UF');
  const modeloFull = [marca, modelo].filter(Boolean).join(' ').trim();
  // O ApiPlacas mascara o chassi (ex.: "*****00841") em parte dos planos: ao tirar
  // os "*" sobra um fragmento inválido. Só emitimos VIN quando vier completo (17
  // caracteres) — senão fica vazio e o check-in segue pedindo o VIN da etiqueta.
  const vinLimpo = chassi ? String(chassi).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '') : '';
  return {
    ok: true,
    placa,
    vin: vinLimpo.length === 17 ? vinLimpo : '',
    modelo: modeloFull || (modelo || null),
    marca: marca || null,
    anoModelo: soAno(anoMod),
    cor: cor ? String(cor).trim() : null,
    combustivel: comb ? String(comb).trim() : null,
    municipio: municipio ? String(municipio).trim() : null,
    uf: uf ? String(uf).trim() : null,
  };
}

module.exports = handler;
module.exports.config = { maxDuration: 15 };
module.exports._internals = { normalizar, RE_PLACA };
