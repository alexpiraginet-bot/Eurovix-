/* ============================================================
   LexOS · WERK OS — entrada por Face ID / Touch ID / digital
   ------------------------------------------------------------
   O QUE ISTO É, COM TODAS AS LETRAS
   O navegador não deixa um site "pedir o Face ID" direto. O que existe
   é o WebAuthn: o aparelho guarda uma chave e só a usa depois de
   reconhecer o dono (Face ID no iPhone, Touch ID no Mac, digital no
   Android). Usamos isso como COFRE LOCAL: depois de a pessoa entrar uma
   vez com a senha, guardamos essa credencial CIFRADA neste aparelho e o
   Face ID é o que destranca.

   Quando o autenticador suporta a extensão `prf` (iOS 18+, Chrome
   recente), a chave da cifra nasce do próprio Face ID: sem o rosto certo
   NÃO existe como decifrar — nem com acesso ao armazenamento. Quando não
   suporta, guardamos a chave junto (marcado como `prf:false`): aí a
   biometria é conveniência, não cofre. Em ambos os casos nada sai deste
   aparelho e nada vai para o servidor.

   Escopos (um cofre por superfície, nunca compartilhado):
     'cliente' → app.html      'staff' → werkos.html      'admin' → admin.html
   ============================================================ */
(function () {
  'use strict';

  var PREFIXO = 'evx.bio.';
  var RP_NOME = 'LexOS';

  /* ---------- base64 <-> bytes ---------- */
  function paraB64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function deB64(s) {
    var bin = atob(s), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  function aleatorio(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  function ler(escopo) {
    try { return JSON.parse(localStorage.getItem(PREFIXO + escopo) || 'null'); } catch (_) { return null; }
  }
  function gravar(escopo, rec) {
    try { localStorage.setItem(PREFIXO + escopo, JSON.stringify(rec)); return true; } catch (_) { return false; }
  }

  /* ---------- cifra ---------- */
  function chaveDe(bytes) {
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  function cifrar(bytes, texto) {
    var iv = aleatorio(12);
    return chaveDe(bytes)
      .then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(texto)); })
      .then(function (ct) { return { iv: paraB64(iv), ct: paraB64(ct) }; });
  }
  function decifrar(bytes, rec) {
    return chaveDe(bytes)
      .then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(rec.iv) }, k, deB64(rec.ct)); })
      .then(function (buf) { return new TextDecoder().decode(buf); });
  }

  /* ---------- disponibilidade ---------- */
  // Só oferecemos quando o aparelho TEM biometria de verdade (o "platform
  // authenticator"). Chave de segurança USB não interessa aqui.
  function disponivel() {
    if (!window.PublicKeyCredential || !window.isSecureContext ||
        !navigator.credentials || !window.crypto || !crypto.subtle) return Promise.resolve(false);
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return Promise.resolve(false);
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(function () { return false; });
  }

  // Nome que a pessoa reconhece no próprio aparelho.
  function nome() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'Face ID';
    if (/Macintosh/.test(ua)) return 'Touch ID';
    if (/Android/.test(ua)) return 'sua digital';
    return 'biometria';
  }

  function ativo(escopo) { var r = ler(escopo); return !!(r && r.id && r.ct); }
  function rotuloDe(escopo) { var r = ler(escopo); return r ? r.rotulo || '' : ''; }
  function esquecer(escopo) { try { localStorage.removeItem(PREFIXO + escopo); } catch (_) {} }

  /* ---------- ativar: cria a credencial e tranca o segredo ---------- */
  // `segredo` é o que destranca a conta depois (ex.: {tel, senha}). Fica
  // cifrado; em texto puro só existe durante o login que a pessoa acabou de fazer.
  function ativar(escopo, rotulo, segredo) {
    var salt = aleatorio(32);
    var texto = JSON.stringify(segredo);
    return navigator.credentials.create({
      publicKey: {
        challenge: aleatorio(32),
        rp: { name: RP_NOME },                        // sem id → o domínio atual
        user: { id: aleatorio(16), name: rotulo || escopo, displayName: rotulo || escopo },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',        // o próprio aparelho, não chave USB
          userVerification: 'required',               // exige o rosto/digital, não só o PIN do site
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',                          // não queremos identificar o fabricante
        extensions: { prf: { eval: { first: salt } } },
      },
    }).then(function (cred) {
      if (!cred) throw new Error('cancelado');
      var id = paraB64(cred.rawId);
      var ext = (cred.getClientExtensionResults && cred.getClientExtensionResults()) || {};
      var prf = ext.prf && ext.prf.results && ext.prf.results.first;
      if (prf) return { id: id, chavePrf: new Uint8Array(prf) };
      // O autenticador aceitou a extensão mas só entrega o segredo numa
      // verificação: pedimos uma agora (o iPhone mostra o Face ID de novo).
      if (ext.prf && ext.prf.enabled) {
        return navigator.credentials.get({
          publicKey: {
            challenge: aleatorio(32),
            allowCredentials: [{ type: 'public-key', id: deB64(id) }],
            userVerification: 'required', timeout: 60000,
            extensions: { prf: { eval: { first: salt } } },
          },
        }).then(function (a) {
          var e2 = (a && a.getClientExtensionResults && a.getClientExtensionResults()) || {};
          var p2 = e2.prf && e2.prf.results && e2.prf.results.first;
          return { id: id, chavePrf: p2 ? new Uint8Array(p2) : null };
        }).catch(function () { return { id: id, chavePrf: null }; });
      }
      return { id: id, chavePrf: null };
    }).then(function (r) {
      var usaPrf = !!r.chavePrf;
      var chave = usaPrf ? r.chavePrf : aleatorio(32);
      return cifrar(chave, texto).then(function (c) {
        var rec = {
          v: 1, id: r.id, salt: paraB64(salt), iv: c.iv, ct: c.ct,
          prf: usaPrf,
          chave: usaPrf ? null : paraB64(chave),      // sem prf a chave mora aqui (conveniência, não cofre)
          rotulo: rotulo || '', em: Date.now(),
        };
        if (!gravar(escopo, rec)) throw new Error('sem espaço para guardar');
        return { ok: true, cofre: usaPrf };
      });
    }).catch(function (e) {
      return { ok: false, erro: motivo(e) };
    });
  }

  /* ---------- entrar: pede o rosto e devolve o segredo ---------- */
  function entrar(escopo) {
    var rec = ler(escopo);
    if (!rec) return Promise.resolve({ ok: false, erro: 'Este aparelho ainda não tem ' + nome() + ' configurado.' });
    return navigator.credentials.get({
      publicKey: {
        challenge: aleatorio(32),
        allowCredentials: [{ type: 'public-key', id: deB64(rec.id) }],
        userVerification: 'required',
        timeout: 60000,
        extensions: rec.prf ? { prf: { eval: { first: deB64(rec.salt) } } } : undefined,
      },
    }).then(function (a) {
      if (!a) throw new Error('cancelado');
      var chave;
      if (rec.prf) {
        var ext = (a.getClientExtensionResults && a.getClientExtensionResults()) || {};
        var p = ext.prf && ext.prf.results && ext.prf.results.first;
        // Sem o segredo do autenticador não há como decifrar — e é isso mesmo
        // que queremos: o cofre depende do rosto, não do armazenamento.
        if (!p) throw new Error('sem-prf');
        chave = new Uint8Array(p);
      } else {
        chave = deB64(rec.chave);
      }
      return decifrar(chave, rec);
    }).then(function (txt) {
      return { ok: true, segredo: JSON.parse(txt) };
    }).catch(function (e) {
      if (e && e.message === 'sem-prf') {
        esquecer(escopo);   // registro inutilizável: melhor pedir para reativar
        return { ok: false, erro: 'Precisamos reativar o ' + nome() + ' neste aparelho — entre com a senha uma vez.' };
      }
      return { ok: false, erro: motivo(e) };
    });
  }

  function motivo(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || (e && e.message === 'cancelado')) return 'Cancelado — use a senha ou tente de novo.';
    if (n === 'InvalidStateError') return 'Este aparelho já tem um acesso salvo para esta conta.';
    if (n === 'NotSupportedError') return 'Este aparelho não oferece ' + nome() + ' para sites.';
    if (n === 'SecurityError') return 'Só funciona no endereço oficial do sistema (https).';
    return (e && e.message) || 'Não foi possível concluir — tente de novo.';
  }

  window.EVXBio = {
    disponivel: disponivel, nome: nome, ativo: ativo, rotuloDe: rotuloDe,
    ativar: ativar, entrar: entrar, esquecer: esquecer,
  };

  /* ============================================================
     "Manter conectado neste aparelho"
     ------------------------------------------------------------
     A sessão do Supabase é persistente por padrão: fica no aparelho e
     sobrevive a fechar o navegador. Quem DESMARCA a opção quer o oposto —
     sair quando fechar. Como não existe evento confiável de "fechei o
     navegador" (no iPhone o `pagehide` dispara só por trocar de app),
     usamos um sinal de vida: enquanto alguma aba está aberta, ela carimba
     a hora a cada 30s. Na próxima abertura, se o último carimbo é velho,
     o navegador esteve fechado → derruba a sessão.
     Isso não sofre do problema de abrir uma segunda aba (o carimbo da
     primeira está fresco) nem do de trocar de app no celular.
     ============================================================ */
  var K_EFEMERA = 'evx.sessao.efemera';   // '1' = não manter conectado
  var K_VIVO = 'evx.sessao.vivo';         // hora do último sinal de vida
  var JANELA = 90 * 1000;                 // fechou e voltou em até 90s = mesma sessão

  function carimbar() { try { localStorage.setItem(K_VIVO, String(Date.now())); } catch (_) {} }

  // Chame no login. `manter` false = derruba ao fechar o navegador.
  function definirPermanencia(manter) {
    try {
      if (manter) localStorage.removeItem(K_EFEMERA);
      else localStorage.setItem(K_EFEMERA, '1');
    } catch (_) {}
    carimbar();
  }
  function permanencia() { try { return localStorage.getItem(K_EFEMERA) !== '1'; } catch (_) { return true; } }

  // Chame no boot, ANTES de ler a sessão: true = o navegador foi fechado e a
  // pessoa pediu para não ficar conectada.
  function expirouAoFechar() {
    try {
      if (localStorage.getItem(K_EFEMERA) !== '1') return false;
      var t = +localStorage.getItem(K_VIVO) || 0;
      return (Date.now() - t) > JANELA;
    } catch (_) { return false; }
  }
  function limparPermanencia() { try { localStorage.removeItem(K_EFEMERA); localStorage.removeItem(K_VIVO); } catch (_) {} }

  carimbar();
  setInterval(function () { if (document.visibilityState !== 'hidden') carimbar(); }, 30000);
  window.addEventListener('pagehide', carimbar);
  document.addEventListener('visibilitychange', carimbar);

  window.EVXSessao = {
    definir: definirPermanencia, manter: permanencia,
    expirouAoFechar: expirouAoFechar, limpar: limparPermanencia,
  };
})();
