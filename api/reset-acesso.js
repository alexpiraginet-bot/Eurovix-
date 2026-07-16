// ============================================================
// LexOS — gerar LINK de redefinição de senha (Supabase Admin)
// ------------------------------------------------------------
// POST /api/reset-acesso
//   Body:  { tipo:'oficina'|'cliente', email?, telefone? }   (origin é do servidor)
//   Header: Authorization: Bearer <access_token do chamador>
//   → { ok:true, link } — o link que você envia (WhatsApp). Quem abre
//     define a nova senha (fluxo PASSWORD_RECOVERY do Supabase).
//
// Segurança (a service_role só existe aqui, na env SUPABASE_SERVICE_ROLE
// da Vercel — nunca no navegador/repo):
//   • tipo 'oficina'  → o chamador precisa ser ADMIN LexOS (is_lex_admin).
//   • tipo 'cliente'  → a RLS da tabela clientes define o escopo: a equipe só
//     enxerga/reseta clientes da PRÓPRIA oficina; um cliente, só a si mesmo
//     (resetar a própria senha é inofensivo — não há escalonamento entre tenants).
//
// Sem SUPABASE_SERVICE_ROLE → { ok:false } e o admin usa o dashboard.
// ============================================================

const DEF_URL = 'https://olfqtvncorwhjrjjzmer.supabase.co';       // público (igual ao env.js)
const DEF_ANON = 'sb_publishable_2GhJjTqPP8r5p8-zJNr0uQ_I7zyjdOs'; // chave publishable (pública)
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const emailCliente = (tel) => 'c' + String(tel).replace(/\D/g, '') + '@clientes.eurovix.app';

async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, erro: 'Use POST.' }); return; }
  const URL = (process.env.SUPABASE_URL || DEF_URL).replace(/\/+$/, '');
  const ANON = process.env.SUPABASE_ANON_KEY || DEF_ANON;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
  if (!SERVICE) { res.status(200).json({ ok: false, erro: 'Redefinição não configurada (defina SUPABASE_SERVICE_ROLE na Vercel).' }); return; }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) { res.status(200).json({ ok: false, erro: 'Entre como administrador/equipe primeiro.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  const tipo = body.tipo === 'cliente' ? 'cliente' : 'oficina';

  try {
    // 1 · autorização do chamador + e-mail alvo
    let email = '';
    if (tipo === 'cliente') {
      const tel = String(body.telefone || '').replace(/\D/g, '');
      if (tel.length < 10) { res.status(200).json({ ok: false, erro: 'Informe o telefone do cliente (com DDD).' }); return; }
      // RLS: a linha só volta se o cliente for da oficina do chamador (staff).
      const chk = await fetch(URL + '/rest/v1/clientes?select=telefone_norm&telefone_norm=eq.' + encodeURIComponent(tel) + '&limit=1',
        { headers: { apikey: ANON, Authorization: 'Bearer ' + token } });
      const rows = chk.ok ? await chk.json().catch(() => []) : [];
      if (!Array.isArray(rows) || !rows.length) { res.status(200).json({ ok: false, erro: 'Cliente não encontrado na sua oficina (ou você não é da equipe).' }); return; }
      email = emailCliente(tel);
    } else {
      const adm = await fetch(URL + '/rest/v1/rpc/is_lex_admin',
        { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
      const isAdmin = adm.ok && (await adm.json().catch(() => false)) === true;
      if (!isAdmin) { res.status(200).json({ ok: false, erro: 'Apenas administradores LexOS podem redefinir a senha de uma oficina.' }); return; }
      email = String(body.email || '').trim().toLowerCase();
      if (!RE_EMAIL.test(email)) { res.status(200).json({ ok: false, erro: 'Informe o e-mail de login da oficina.' }); return; }
    }

    // 2 · gera o link de recuperação (service_role). A origem do redirect é fixada
    // pelo SERVIDOR (headers da própria requisição) — nunca confiamos no corpo.
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const origin = host ? proto + '://' + host : '';
    const redirectTo = origin ? origin + (tipo === 'cliente' ? '/app.html' : '/werkos.html') : '';
    const payload = redirectTo ? { type: 'recovery', email, redirect_to: redirectTo } : { type: 'recovery', email };
    const gen = await fetch(URL + '/auth/v1/admin/generate_link',
      { method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const g = await gen.json().catch(() => null);
    if (!gen.ok || !g) {
      const msg = (g && (g.msg || g.message || g.error_description || g.error)) || ('Falha ao gerar o link (' + gen.status + ').');
      const amigavel = /not.*found|no.*user|user.*exist|user/i.test(String(msg))
        ? 'Nenhuma conta encontrada para esse acesso — a oficina/cliente já ativou o login?'
        : String(msg).slice(0, 160);
      res.status(200).json({ ok: false, erro: amigavel });
      return;
    }
    const link = g.action_link || (g.properties && g.properties.action_link) || '';
    if (!link) { res.status(200).json({ ok: false, erro: 'O provedor não retornou o link.' }); return; }
    res.status(200).json({ ok: true, link, email });
  } catch (e) {
    res.status(200).json({ ok: false, erro: 'Erro ao gerar o link de redefinição — tente de novo.' });
  }
}

module.exports = handler;
module.exports.config = { maxDuration: 15 };
module.exports._internals = { RE_EMAIL, emailCliente };
