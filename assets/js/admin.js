/* ============================================================
   LexOS · Central Admin — login real (Supabase Auth) + CRUD de oficinas
   ------------------------------------------------------------
   Nuvem (EVX_ENV preenchido): login por e-mail+senha do Supabase Auth,
   restrito à allowlist lex_admins (RLS). CRUD na tabela public.oficinas.
   Sem nuvem: modo local (senha local) + CRUD em localStorage — para demo.
   ============================================================ */
(function () {
  'use strict';
  var ENV = (window.EVX_ENV || {});
  var HAS_SB = !!(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY && window.supabase && supabase.createClient);
  var sb = HAS_SB ? supabase.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY) : null;
  var CLOUD = HAS_SB;
  var LOCAL_PIN = '2705';                          // modo local (sem nuvem): senha do demo
  var LKEY = 'evx.lexos.oficinas';
  var PLANOS = ['Conecta', 'Digital', 'Marca própria'];
  var STATUS = ['lead', 'ativando', 'ativa', 'pausada'];
  var WA = '5527995999995', SUPABASE_PROJ = 'olfqtvncorwhjrjjzmer';
  var $ = function (id) { return document.getElementById(id); };
  var origin = (location.origin && location.origin !== 'null') ? location.origin : '';

  var tmr;
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tmr); tmr = setTimeout(function () { t.classList.remove('on'); }, 2100); }
  function copy(x) { try { navigator.clipboard.writeText(x); toast('Copiado ✓'); } catch (_) { toast('Copie: ' + x); } }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtDate(iso) { if (!iso) return '—'; var d = String(iso).slice(0, 10).split('-'); return d.length === 3 ? d[2] + '/' + d[1] + '/' + d[0] : iso; }
  function waDigits(s) { var d = (s || '').replace(/\D/g, ''); if (!d) return WA; return d.length <= 11 ? '55' + d : d; }

  /* ---------- indicador de modo ---------- */
  $('modeLabel').textContent = CLOUD ? 'nuvem · Supabase Auth' : 'local · demo';
  if (!CLOUD) $('localHint').style.display = 'block';

  /* ---------- auth ---------- */
  async function currentUser() {
    if (CLOUD) { var r = await sb.auth.getSession(); return r.data.session ? { email: r.data.session.user.email } : null; }
    return sessionStorage.getItem('evx.admin.ok') === '1' ? { email: sessionStorage.getItem('evx.admin.email') || 'admin (local)' } : null;
  }
  async function isAdmin() {
    if (!CLOUD) return true;
    try { var r = await sb.rpc('is_lex_admin'); if (r.error) return false; return !!r.data; } catch (_) { return false; }
  }
  async function doLogin(email, senha) {
    if (CLOUD) {
      var r = await sb.auth.signInWithPassword({ email: email, password: senha });
      if (r.error) return { ok: false, erro: 'E-mail ou senha inválidos.' };
      if (!(await isAdmin())) { await sb.auth.signOut(); return { ok: false, erro: 'Conta sem permissão de admin (adicione o e-mail em lex_admins).' }; }
      return { ok: true };
    }
    if (senha === LOCAL_PIN) { sessionStorage.setItem('evx.admin.ok', '1'); sessionStorage.setItem('evx.admin.email', email || 'admin (local)'); return { ok: true }; }
    return { ok: false, erro: 'Senha local incorreta.' };
  }
  async function doLogout() { if (CLOUD) { try { await sb.auth.signOut(); } catch (_) {} } sessionStorage.removeItem('evx.admin.ok'); location.reload(); }

  /* ---------- CRUD oficinas ---------- */
  async function listOficinas() {
    if (CLOUD) {
      var r = await sb.from('oficinas').select('*').order('criado_em', { ascending: false });
      if (r.error) { toast('Erro ao listar: ' + r.error.message); return []; }
      return r.data || [];
    }
    try { return JSON.parse(localStorage.getItem(LKEY) || '[]').slice().sort(function (a, b) { return (b.criado_em || '').localeCompare(a.criado_em || ''); }); } catch (_) { return []; }
  }
  async function saveOficina(o) {
    var row = { nome: o.nome, responsavel: o.responsavel, whatsapp: o.whatsapp, email: o.email, cidade: o.cidade, plano: o.plano, addon_ia: !!o.addon_ia, unidades: +o.unidades || 1, subdominio: o.subdominio || null, status: o.status, obs: o.obs };
    if (CLOUD) {
      var r = o.id ? await sb.from('oficinas').update(row).eq('id', o.id) : await sb.from('oficinas').insert(row);
      if (r.error) return { ok: false, erro: r.error.message };
      return { ok: true };
    }
    var list; try { list = JSON.parse(localStorage.getItem(LKEY) || '[]'); } catch (_) { list = []; }
    if (o.id) { var i = list.findIndex(function (x) { return x.id === o.id; }); if (i >= 0) list[i] = Object.assign({}, list[i], row, { id: o.id }); }
    else { row.id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())); row.criado_em = new Date().toISOString(); list.push(row); }
    localStorage.setItem(LKEY, JSON.stringify(list)); return { ok: true };
  }
  async function delOficina(id) {
    if (CLOUD) { var r = await sb.from('oficinas').delete().eq('id', id); if (r.error) return { ok: false, erro: r.error.message }; return { ok: true }; }
    var list; try { list = JSON.parse(localStorage.getItem(LKEY) || '[]'); } catch (_) { list = []; }
    localStorage.setItem(LKEY, JSON.stringify(list.filter(function (x) { return x.id !== id; }))); return { ok: true };
  }

  /* ---------- render: links & credenciais ---------- */
  var LINKS = [
    { ic: '📝', nm: 'Cadastro público', ds: 'Página onde a oficina contrata.', path: '/lexos.html' },
    { ic: '🎞️', nm: 'Apresentação', ds: 'Deck de vendas para enviar.', path: '/lexos-apresentacao.html' },
    { ic: '🔧', nm: 'Painel WERK OS', ds: 'Gestão da oficina (login da equipe).', path: '/werkos.html' },
    { ic: '📲', nm: 'App do cliente', ds: 'PWA que o cliente usa.', path: '/app.html' },
    { ic: '🌐', nm: 'Site (EUROVIX piloto)', ds: 'Vitrine da oficina-piloto.', path: '/index.html' },
    { ic: '🗄️', nm: 'Supabase', ds: 'Banco, Auth e allowlist de admins.', full: 'https://supabase.com/dashboard/project/' + SUPABASE_PROJ },
    { ic: '▲', nm: 'Vercel', ds: 'Deploy do projeto.', full: 'https://vercel.com/dashboard' },
    { ic: '💬', nm: 'WhatsApp comercial', ds: 'Seu número de contato.', full: 'https://wa.me/' + WA }
  ];
  function renderLinks() {
    $('linksGrid').innerHTML = LINKS.map(function (l) {
      var url = l.full || (origin + l.path);
      return '<div class="lk"><div class="ic">' + l.ic + '</div><div class="nm">' + l.nm + '</div><div class="ds">' + l.ds +
        '</div><div class="url">' + esc(url) + '</div><div class="row"><a class="go" href="' + esc(url) + '" target="_blank" rel="noopener">abrir</a>' +
        '<button class="cp" data-copy="' + esc(url) + '">copiar</button></div></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.lk .cp'), function (b) { b.addEventListener('click', function () { copy(b.getAttribute('data-copy')); }); });
  }

  /* ---------- render: tabela de oficinas ---------- */
  function planoPill(p) { var cls = p === 'Marca própria' ? 'pl-marca' : p === 'Digital' ? 'pl-digital' : 'pl-conecta'; return '<span class="pill ' + cls + '">' + esc(p || '—') + '</span>'; }
  function statusPill(s) { return '<span class="pill st-' + esc(s || 'lead') + '">' + esc(s || 'lead') + '</span>'; }
  async function renderTable() {
    var list = await listOficinas(); var tb = $('ofBody');
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="6"><div class="empty">Nenhuma oficina cadastrada ainda.<br>Clique em <b>+ Nova oficina</b> para começar.</div></td></tr>';
    } else {
      tb.innerHTML = list.map(function (o) {
        return '<tr>' +
          '<td><div class="of">' + esc(o.nome || '—') + '</div>' + (o.cidade ? '<div class="sub">' + esc(o.cidade) + '</div>' : '') + (o.subdominio ? '<div class="sub">' + esc(o.subdominio) + '.lexos.app</div>' : '') + '</td>' +
          '<td>' + esc(o.responsavel || '—') + (o.whatsapp ? '<div class="sub">' + esc(o.whatsapp) + '</div>' : '') + '</td>' +
          '<td>' + planoPill(o.plano) + (o.addon_ia ? ' <span class="pill pl-ia">+IA</span>' : '') + '</td>' +
          '<td>' + statusPill(o.status) + '</td>' +
          '<td>' + fmtDate(o.criado_em) + '</td>' +
          '<td><span class="act">' +
          (o.whatsapp ? '<button data-wa="' + esc(waDigits(o.whatsapp)) + '" title="WhatsApp">💬</button>' : '') +
          '<button data-edit="' + esc(o.id) + '">editar</button>' +
          '<button class="danger" data-del="' + esc(o.id) + '" data-nome="' + esc(o.nome || '') + '">excluir</button>' +
          '</span></td></tr>';
      }).join('');
      Array.prototype.forEach.call(tb.querySelectorAll('[data-wa]'), function (b) { b.addEventListener('click', function () { window.open('https://wa.me/' + b.getAttribute('data-wa'), '_blank', 'noopener'); }); });
      Array.prototype.forEach.call(tb.querySelectorAll('[data-edit]'), function (b) { b.addEventListener('click', function () { openModal(list.find(function (x) { return String(x.id) === b.getAttribute('data-edit'); })); }); });
      Array.prototype.forEach.call(tb.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('Excluir a oficina "' + b.getAttribute('data-nome') + '"? Esta ação não volta.')) return;
          var r = await delOficina(b.getAttribute('data-del'));
          if (!r.ok) { toast('Erro: ' + r.erro); return; }
          toast('Oficina excluída'); renderTable();
        });
      });
    }
    $('ofCount').textContent = list.length;
  }

  /* ---------- modal nova/editar ---------- */
  function fillSelect(sel, arr, val) { sel.innerHTML = arr.map(function (v) { return '<option' + (v === val ? ' selected' : '') + '>' + v + '</option>'; }).join(''); }
  function openModal(o) {
    o = o || {};
    $('m-title').textContent = o.id ? 'Editar oficina' : 'Nova oficina';
    $('m-id').value = o.id || '';
    $('m-nome').value = o.nome || ''; $('m-resp').value = o.responsavel || ''; $('m-wpp').value = o.whatsapp || '';
    $('m-email').value = o.email || ''; $('m-cidade').value = o.cidade || ''; $('m-sub').value = o.subdominio || ''; $('m-obs').value = o.obs || '';
    $('m-unid').value = o.unidades || 1; $('m-ia').checked = !!o.addon_ia;
    fillSelect($('m-plano'), PLANOS, o.plano || 'Conecta');
    fillSelect($('m-status'), STATUS, o.status || 'lead');
    $('ofModal').classList.add('on'); setTimeout(function () { $('m-nome').focus(); }, 60);
  }
  function closeModal() { $('ofModal').classList.remove('on'); }

  /* ---------- init ---------- */
  function showPanel(user) { $('gate').style.display = 'none'; $('panel').style.display = 'block'; $('meEmail').textContent = user ? user.email : ''; renderLinks(); renderTable(); }
  function showGate() { $('gate').style.display = 'flex'; $('panel').style.display = 'none'; }

  (async function init() {
    var u = await currentUser();
    if (u && (await isAdmin())) showPanel(u); else showGate();

    $('loginForm').addEventListener('submit', async function (e) {
      e.preventDefault(); $('loginErr').textContent = '';
      var btn = $('loginBtn'); btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Entrando…';
      var r = await doLogin($('f-email').value.trim(), $('f-senha').value);
      btn.disabled = false; btn.textContent = orig;
      if (!r.ok) { $('loginErr').textContent = r.erro; $('f-senha').select(); return; }
      showPanel(await currentUser());
    });
    $('logout').addEventListener('click', doLogout);
    $('ofNova').addEventListener('click', function () { openModal(null); });
    $('ofCancel').addEventListener('click', closeModal);
    $('ofModal').addEventListener('click', function (e) { if (e.target === $('ofModal')) closeModal(); });
    $('ofForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var nome = $('m-nome').value.trim();
      if (!nome) { $('m-nome').focus(); return; }
      var o = {
        id: $('m-id').value || null, nome: nome, responsavel: $('m-resp').value.trim(), whatsapp: $('m-wpp').value.trim(),
        email: $('m-email').value.trim(), cidade: $('m-cidade').value.trim(), plano: $('m-plano').value, addon_ia: $('m-ia').checked,
        unidades: +$('m-unid').value || 1, subdominio: $('m-sub').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''), status: $('m-status').value, obs: $('m-obs').value.trim()
      };
      var btn = $('ofSalvar'); btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Salvando…';
      var r = await saveOficina(o);
      btn.disabled = false; btn.textContent = orig;
      if (!r.ok) { toast('Erro ao salvar: ' + r.erro); return; }
      toast(o.id ? 'Oficina atualizada ✓' : 'Oficina cadastrada ✓'); closeModal(); renderTable();
    });
  })();
})();
