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
function txt(v) { return (v == null || v === '') ? null : String(v).trim(); }

// Melhor linha FIPE (maior "score") → valor de mercado + código para o histórico.
function fipeInfo(d) {
  const arr = (d && d.fipe && Array.isArray(d.fipe.dados)) ? d.fipe.dados : [];
  if (!arr.length) return null;
  const best = arr.slice().sort((a, b) => (b && b.score || 0) - (a && a.score || 0))[0] || arr[0];
  const out = {
    valor: txt(pick(best, 'texto_valor', 'valor')),
    codigo: txt(pick(best, 'codigo_fipe')),
    modelo: txt(pick(best, 'texto_modelo')),
    referencia: txt(pick(best, 'mes_referencia')),
  };
  return (out.valor || out.codigo) ? out : null;
}

// Normaliza o retorno do ApiPlacas para o WERK. Entrega o MÁXIMO de dados úteis do
// veículo e do "histórico" público (situação, origem, FIPE/valor, município/UF),
// tolerante a variações de nome de campo (MAIÚSCULAS x minúsculas), ao objeto
// "extra" (às vezes vazio) e ao bloco FIPE (fipe.dados[]).
function normalizar(d, placa) {
  const ex = (d.extra && typeof d.extra === 'object') ? d.extra : {};
  const fipe = (d.fipe && Array.isArray(d.fipe.dados) && d.fipe.dados[0]) ? d.fipe.dados[0] : {};
  const marca = pick(d, 'MARCA', 'marca') || pick(ex, 'marca', 'MARCA');
  const modelo = pick(d, 'MODELO', 'modelo') || pick(ex, 'modelo', 'MODELO');
  const submodelo = pick(d, 'SUBMODELO', 'submodelo') || pick(ex, 'submodelo');
  const versao = pick(d, 'VERSAO', 'versao', 'VERSÃO') || pick(ex, 'versao');
  const chassi = pick(d, 'chassi', 'CHASSI', 'chassis') || pick(ex, 'chassi', 'CHASSI');
  const anoMod = pick(d, 'anoModelo', 'ano_modelo') || pick(ex, 'ano_modelo', 'anoModelo') || pick(fipe, 'ano_modelo');
  const anoFab = pick(d, 'ano', 'anoFabricacao', 'ano_fabricacao') || pick(ex, 'ano', 'ano_fabricacao');
  const cor = pick(d, 'cor', 'COR') || pick(ex, 'cor', 'COR');
  const comb = pick(ex, 'combustivel', 'COMBUSTIVEL', 'combustível') || pick(d, 'combustivel') || pick(fipe, 'combustivel');
  const municipio = pick(d, 'municipio', 'MUNICIPIO') || pick(ex, 'municipio', 'MUNICIPIO');
  const uf = pick(d, 'uf', 'UF') || pick(ex, 'uf', 'UF');
  const origem = pick(d, 'origem', 'ORIGEM') || pick(ex, 'origem');
  const segmento = pick(d, 'segmento', 'SEGMENTO') || pick(ex, 'segmento');
  const situacao = pick(d, 'situacao', 'SITUACAO', 'situação') || pick(ex, 'situacao');
  const modeloFull = [marca, modelo].filter(Boolean).join(' ').trim();
  // O ApiPlacas mascara o chassi (ex.: "*****00841") em parte dos planos: ao tirar
  // os "*" sobra um fragmento inválido. Só emitimos VIN quando vier completo (17
  // caracteres) — senão fica vazio e o check-in segue pedindo o VIN da etiqueta.
  const vinLimpo = chassi ? String(chassi).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '') : '';
  return {
    ok: true,
    placa,
    vin: vinLimpo.length === 17 ? vinLimpo : '',
    chassi: txt(chassi) ? String(chassi).trim().toUpperCase() : null,  // bruto (pode vir mascarado "*****00841") — mostrado no check-in para o mecânico completar o VIN
    modelo: modeloFull || (txt(modelo)),      // "RENAULT LOGAN ZEN10MT" — vai p/ o campo do veículo
    marca: txt(marca),
    modeloBase: txt(modelo),                  // só o MODELO ("LOGAN ZEN10MT")
    submodelo: txt(submodelo),
    versao: txt(versao),
    anoModelo: soAno(anoMod),
    anoFabricacao: soAno(anoFab),
    cor: txt(cor),
    combustivel: txt(comb),
    municipio: txt(municipio),
    uf: txt(uf),
    origem: txt(origem),
    segmento: txt(segmento),
    situacao: txt(situacao),
    fipe: fipeInfo(d),                        // { valor:"R$ 57.175,00", codigo, modelo, referencia } | null
  };
}

module.exports = handler;
module.exports.config = { maxDuration: 15 };
module.exports._internals = { normalizar, RE_PLACA };
