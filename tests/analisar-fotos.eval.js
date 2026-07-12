// ============================================================
// Bateria de testes do normalizador de visão (api/analisar-fotos.js).
// Casos destilados de um time de agentes especialistas + revisão
// adversarial (odômetro, combustível, luzes, avarias, itens,
// robustez de formato, anti-alucinação). Princípio verificado:
// ABSTENÇÃO HONESTA — nada de default plausível (50%, 0.9, presente).
//
// Rodar:  node api/analisar-fotos.eval.js
// ============================================================
const { coerceKm, coerceFuel, coerceLuzes, coerceAvarias, coerceItens, coerceConf, confiancaFinal, normalizar } = require('../api/analisar-fotos.js')._internals;

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function t(nome, real, esperado) {
  if (eq(real, esperado)) { pass++; }
  else { fail++; console.log('✗ ' + nome + '\n    esperado: ' + JSON.stringify(esperado) + '\n    obtido:   ' + JSON.stringify(real)); }
}

// ---------- km ----------
t('km inteiro nítido', coerceKm(84213), 84213);
t('km string milhar BR "128.500"→128500', coerceKm('128.500'), 128500);   // bug antigo: Number→128
t('km string com unidade " 97 650 km "', coerceKm(' 97 650 km '), 97650);  // bug antigo: NaN
t('km boolean→null', coerceKm(true), null);                                 // bug antigo: Number(true)=1
t('km array→null', coerceKm([8, 4, 2, 1, 3]), null);                        // bug antigo: Number([84213])=84213
t('km objeto→null', coerceKm({ total: 84213 }), null);
t('km 0 (painel apagado)→null', coerceKm(0), null);
t('km negativo→null', coerceKm(-12000), null);
t('km alucinação 9999999→null', coerceKm(9999999), null);                   // sem teto antigo passava
t('km float analógico 84212.7→arredonda', coerceKm(84212.7), 84213);
t('km null→null', coerceKm(null), null);
t('km "48512" string pura', coerceKm('48512'), 48512);

// ---------- combustível ----------
t('fuel null→null (não 0, não 50)', coerceFuel(null), null);               // bug antigo: 0
t('fuel undefined→null', coerceFuel(undefined), null);
t('fuel 0 preserva vazio real', coerceFuel(0), 0);
t('fuel 62→arredonda p/ 5', coerceFuel(62), 60);
t('fuel "45%"→45', coerceFuel('45%'), 45);
t('fuel "1/2"→50', coerceFuel('1/2'), 50);
t('fuel "3/4"→75', coerceFuel('3/4'), 75);
t('fuel "E"→0', coerceFuel('E'), 0);
t('fuel "cheio"→100', coerceFuel('cheio'), 100);
t('fuel 520 (autonomia)→null', coerceFuel(520), null);                     // bug antigo: satura 100
t('fuel -5→null', coerceFuel(-5), null);
t('fuel boolean→null', coerceFuel(true), null);
t('fuel "meio"→50', coerceFuel('meio'), 50);

// ---------- luzes ----------
t('luz string "ABS, Airbag"→array', coerceLuzes('ABS, Airbag'), ['ABS', 'Airbag']);   // bug antigo: []
t('luz objeto {nome}', coerceLuzes([{ nome: 'ABS' }]), ['ABS']);                        // bug antigo: "[object Object]"
t('luz blocklist informativas', coerceLuzes(['Seta', 'Farol alto', 'Check Engine']), ['Check Engine']);
t('luz canoniza MIL→Check Engine', coerceLuzes(['MIL']), ['Check Engine']);
t('luz dedupe acento/caixa', coerceLuzes(['ABS', 'abs']), ['ABS']);
t('luz combustível baixo bloqueado', coerceLuzes(['Combustível baixo', 'TPMS']), ['TPMS']);
t('luz freio de mão bloqueado, Freio real mantém', coerceLuzes(['Freio de mão']), []);
t('luz sentinela "nenhuma"→[]', coerceLuzes(['nenhuma']), []);
t('luz tipo inválido→[]', coerceLuzes(42), []);
t('luz "Pressão do óleo"', coerceLuzes(['Luz de óleo']), ['Pressão do óleo']);

// ---------- avarias ----------
t('avaria objeto único→embrulha', coerceAvarias({ x: 50, y: 40, nota: 'Risco', sev: 'alta' }),
  [{ x: 50, y: 40, nota: 'Risco', sev: 'alta' }]);                                        // bug antigo: descartado
t('avaria pula null no array', coerceAvarias([null, { x: 10, y: 10, nota: 'A', sev: 'baixa' }]),
  [{ x: 10, y: 10, nota: 'A', sev: 'baixa' }]);                                            // bug antigo: TypeError zera tudo
t('avaria string→nota', coerceAvarias(['Risco no para-choque']),
  [{ x: 50, y: 50, nota: 'Risco no para-choque', sev: 'baixa' }]);
t('avaria clamp x/y e sev "critica"→alta', coerceAvarias([{ x: 200, y: -5, nota: 'T', sev: 'critica' }]),
  [{ x: 100, y: 0, nota: 'T', sev: 'alta' }]);                                             // bug antigo: sev→media
t('avaria sev ausente→baixa (não media)', coerceAvarias([{ x: 5, y: 5, nota: 'X' }]),
  [{ x: 5, y: 5, nota: 'X', sev: 'baixa' }]);
t('avaria x vazio→default 50 (não 0)', coerceAvarias([{ x: '', y: '', nota: 'Y', sev: 'media' }]),
  [{ x: 50, y: 50, nota: 'Y', sev: 'media' }]);
t('avaria []', coerceAvarias(null), []);
t('avaria ordena por severidade', coerceAvarias([{ x: 1, y: 1, nota: 'b', sev: 'baixa' }, { x: 2, y: 2, nota: 'a', sev: 'alta' }]).map(a => a.sev), ['alta', 'baixa']);

// ---------- itens (tri-estado) ----------
(() => {
  const r = coerceItens({});
  t('itens {} → nada presente', r.itens, [false, false, false, false, false, false]);
  t('itens {} → nada faltante', r.itensFaltantes, []);
  t('itens {} → todos a conferir', r.itensNaoVerificados.length, 6);
})();
(() => {
  const r = coerceItens({ 'Triangulo': true, 'Estepe/kit reparo': false });   // sem acento + false
  t('item true por chave sem acento', r.itens[2], true);
  t('item false vai p/ faltantes', r.itensFaltantes, ['Estepe/kit reparo']);
  t('itens não afirmados ficam a conferir', r.itensNaoVerificados.length, 4);
})();
t('itens entrada inválida (string)→nada presente', coerceItens('lixo').itens, [false, false, false, false, false, false]);

// ---------- confiança ----------
t('conf ausente→0.3 (não 0.9)', coerceConf(undefined), 0.3);
t('conf 85 (fora de faixa)→0.3', coerceConf(85), 0.3);                       // não vira 1.0
t('conf "0,85" BR→0.85', coerceConf('0,85'), 0.85);
t('conf 0.9 válida', coerceConf(0.9), 0.9);
t('confFinal cap por 1 foto', confiancaFinal(0.9, 3, 1), 0.5);
t('confFinal nada lido→≤0.3', confiancaFinal(0.9, 0, 8), 0.3);
t('confFinal só mantém/rebaixa', confiancaFinal(0.6, 5, 8), 0.6);

// ---------- normalizar (ponta a ponta) ----------
(() => {
  const out = normalizar({ km: null, combustivel: null, luzes: [], avarias: [], itensPresentes: {}, confianca: 0.9 }, 8, { km: 60000 });
  t('nada lido: km null', out.km, null);
  t('nada lido: kmFonte null', out.kmFonte, null);
  t('nada lido: kmRecepcao separado', out.kmRecepcao, 60000);               // recepção NÃO funde no km
  t('nada lido: combustivel null', out.combustivel, null);
  t('nada lido: combustivelLido false', out.combustivelLido, false);
  t('nada lido: confiança rebaixada', out.confianca <= 0.3, true);
})();
(() => {
  const out = normalizar({ km: '128.500', combustivel: '3/4', luzes: 'Check Engine', avarias: { x: 20, y: 30, nota: 'Risco porta', sev: 'media' }, itensPresentes: { 'Triangulo': true }, confianca: 0.92 }, 6, {});
  t('leitura real: km parseado', out.km, 128500);
  t('leitura real: kmFonte ia', out.kmFonte, 'ia');
  t('leitura real: fuel fração', out.combustivel, 75);
  t('leitura real: luz string→array', out.luzes, ['Check Engine']);
  t('leitura real: avaria objeto único', out.avarias.length, 1);
  t('leitura real: item presente', out.itens[2], true);
})();

console.log('\n' + (fail === 0 ? '✓ TODOS OS TESTES PASSARAM' : '✗ FALHAS ACIMA') + ' — ' + pass + ' passaram, ' + fail + ' falharam (' + (pass + fail) + ' asserções)');
process.exit(fail === 0 ? 0 : 1);
