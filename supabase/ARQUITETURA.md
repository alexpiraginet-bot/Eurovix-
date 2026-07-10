# CONTRATO — Nuvem EUROVIX (Supabase) · Fase "sem modo demo"

Repositório: /home/user/Eurovix- (site estático na Vercel, sem build; JS puro).
Stack escolhida pela spec do WERK OS: **Supabase** (Postgres + Auth + Realtime; Storage na Fase 2).
Este contrato é vinculante para todos os artefatos. Em dúvida, siga o contrato — não invente.

## Princípios

1. **Dois modos, um código.** `assets/js/env.js` (commitado, público) define `window.EVX_ENV = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }`. Vazio → modo demo (localStorage, comportamento atual, zero regressão). Preenchido → modo nuvem. A anon key é pública por design (RLS protege tudo).
2. **Interface WERK preservada.** A UI inteira (app.js, werkos.js, documento.js, painel.html) consome a interface síncrona de `assets/js/werk-data.js` (exports listados abaixo). O adaptador de nuvem (`assets/js/werk-cloud.js`) implementa A MESMA interface sobre um **espelho em memória** hidratado do Supabase — leituras continuam síncronas.
3. **Espelho + cache.** O adaptador persiste o espelho nas MESMAS chaves localStorage (`evx.werk.os`, `evx.werk.vehicles`, `evx.werk.clients`, `evx.werk.config`) — assim os listeners `storage` existentes e o realtime entre abas continuam funcionando sem tocar na UI. Realtime do Supabase → atualiza espelho → grava cache → `window.dispatchEvent(new CustomEvent('evx:sync'))` (a UI também ganhará listener disso).
4. **Escritas otimistas.** Mutações aplicam no espelho imediatamente (retorno síncrono igual hoje) e fazem push assíncrono. Conflito/erro → refetch da linha + `evx:sync` + `console.warn` (sem fila offline na Fase 1).
5. **Produção começa VAZIA.** Seeds de demonstração NUNCA vão para o banco. Em modo nuvem, `werk-data.js` pula `seed()`/`ensureClients()`.

## Interface WERK (exports de werk-data.js — paridade obrigatória)

`KEYS, STATUS, statusIdx, CATEGORIAS, ETK, SUPPLIERS, AW_TABLE, validateVIN, decodeVIN, fixVIN, checkRecalls, motorDePecas, itemPreco, totalOS, custoOS, getConfig, saveConfig, getVehicles, upsertVehicle, normTel, normPlaca, getClientes, upsertCliente, clientePorTelefone, clientePorConvite, ativarCliente, loginCliente, garagemDe, conviteUrl, waLink, getAllOS, saveAllOS, getOS, novaOS, novoItem, updateOS, setStatus, pendencias, chatSend, pixPayload, brl, fdt, fd`

Adições ao contrato (nos DOIS modos):
- `WERK.ready` → Promise resolvida quando dados utilizáveis (local: resolvida na hora; nuvem: após hidratação inicial).
- `WERK.cloud` → boolean; `WERK.online` → boolean (nuvem: false em erro de rede).
- `WERK.authUser()` → usuário auth atual ou null (local: sempre null).
- `WERK.loginStaff(email, senha)` / `WERK.logoutAuth()` → nuvem: Supabase auth; local: no-op que retorna null/undefined.
- **Await-áveis** (Promise na nuvem, valor direto no local — os call-sites usarão `await`, que funciona nos dois): `novaOS, loginCliente, ativarCliente, upsertCliente, clientePorConvite, loginStaff`.
- Demais funções: síncronas sobre o espelho (leituras) ou otimistas (escritas: `updateOS, setStatus, chatSend, upsertVehicle, saveConfig, saveAllOS`).
- `werk-data.js` mudará `const WERK` → `var WERK` para permitir que `werk-cloud.js` (carregado depois) faça `WERK = criarAdaptadorNuvem(WERK)` quando `EVX_ENV.SUPABASE_URL` estiver preenchida. O adaptador recebe o módulo local para reusar helpers puros (validateVIN, motorDePecas, pixPayload, brl/fdt/fd, novoItem, itemPreco, totalOS, custoOS, normTel, normPlaca, conviteUrl, waLink, KEYS/STATUS/etc. — TODOS os puros são delegados, nunca reimplementados).

## Esquema Postgres (supabase/schema.sql — idempotente, re-executável)

Extensão: `pgcrypto`. Todas as tabelas com **RLS habilitado**.

- `clientes(id uuid pk default gen_random_uuid(), telefone_norm text unique not null, telefone text not null, nome text not null, desde int, convite text unique not null, ativado_em timestamptz, auth_user uuid unique references auth.users(id) on delete set null, criado_em timestamptz default now())`
- `veiculos(vin text pk, dados jsonb not null default '{}'::jsonb, placa text, placa_norm text, km int default 0, cliente text, telefone_norm text, cofre jsonb not null default '[]'::jsonb, atualizado_em timestamptz not null default now())` — `dados` = campos do decodeVIN (modelo, motor, cambio, familia, anoModelo, planta, sa).
- `ordens(numero int pk, criada timestamptz not null default now(), status text not null check (status in ('fila','diagnostico','aprovacao','peca','execucao','qc','lavagem','pronto','entregue')), vin text, veiculo text, placa text, cliente text, telefone_norm text, sintoma text, tecnico text, consultor text, checkin jsonb, dtcs jsonb not null default '[]'::jsonb, itens jsonb not null default '[]'::jsonb, qc jsonb, pagamento jsonb, nf jsonb, nps int check (nps between 0 and 10), aceite jsonb, aprovado_em timestamptz, chat jsonb not null default '[]'::jsonb, eventos jsonb not null default '[]'::jsonb, versao int not null default 0, atualizado_em timestamptz not null default now())` — itens/chat/eventos ficam embutidos em jsonb NESTA fase (paridade 1:1 com a interface; normalização é Fase 2 documentada).
- Sequence `os_numero_seq` START 2000 + RPC `nova_os_numero() returns int` (security definer, staff-only OU chamada interna da RPC de check-in — decidir: check-in é staff, então staff-only).
- `eventos_log(id bigserial pk, os_numero int not null, ts timestamptz not null, tipo text, titulo text, descr text, ator text, gravado_em timestamptz default now())` — **auditoria imutável**: trigger AFTER INSERT OR UPDATE em `ordens` insere no log os eventos novos (diff por comprimento do array `eventos`); nenhuma policy de UPDATE/DELETE + trigger `bloquear_mutacao_log()` que dá RAISE EXCEPTION.
- `config(id int pk default 1 check (id = 1), data jsonb not null default '{}'::jsonb, atualizado_em timestamptz default now())`
- `staff(auth_user uuid pk references auth.users(id) on delete cascade, nome text not null, papel text not null default 'consultor', criado_em timestamptz default now())`
- Trigger genérico `set_atualizado_em()` em ordens/veiculos/config.
- Trigger em `ordens` BEFORE UPDATE: `versao = OLD.versao + 1` e valida `eventos` nunca encolhe (append-only: `jsonb_array_length(NEW.eventos) >= jsonb_array_length(OLD.eventos)` senão EXCEPTION).
- Realtime: `alter publication supabase_realtime add table ordens, veiculos, clientes, config` (guardado com DO $$ ... EXCEPTION WHEN duplicate_object/undefined_object).

## Segurança (RLS + RPCs — tudo no schema.sql)

Funções helper (security definer, `set search_path = public`):
- `is_staff() returns boolean` → exists(select 1 from staff where auth_user = auth.uid()).
- `meus_telefones() returns setof text` → select telefone_norm from clientes where auth_user = auth.uid().

Policies:
- `clientes`: SELECT staff OU `auth_user = auth.uid()`; INSERT/UPDATE/DELETE staff. (Ativação de convite é só por RPC.)
- `veiculos`: SELECT staff OU `telefone_norm in (select meus_telefones())`; INSERT/UPDATE/DELETE staff.
- `ordens`: SELECT staff OU `telefone_norm in (select meus_telefones())`; INSERT/UPDATE/DELETE staff. Cliente NUNCA escreve direto — só pelas RPCs abaixo.
- `config`: SELECT/UPDATE/INSERT staff (o app do cliente não precisa dela; preços já congelados nos itens).
- `eventos_log`: SELECT staff; sem policies de escrita (só triggers definer).
- `staff`: SELECT staff; escrita só via SQL editor/service role (runbook).

RPCs (security definer, validação server-side; são a ÚNICA via de escrita do cliente):
- `convite_info(p_token text)` → callable por `anon`: retorna json `{nome, telefone, veiculos: [{modelo, placa, cor}], ativo: bool}` do cliente com esse convite (ou null). Não vaza nada sem token exato.
- `ativar_convite(p_token text)` → authenticated: valida token existente e `auth_user is null`, faz `auth_user = auth.uid(), ativado_em = now()`; retorna a linha do cliente. Idempotente para o MESMO uid.
- `aprovar_orcamento(p_numero int, p_decisoes jsonb, p_aceite jsonb)` → authenticated dono da OS + status='aprovacao': aplica em `itens` (por id: `aprovacao` in ('aprovado','recusado') + `nivelEscolhido` in ('original','oem','aftermarket')), grava `aceite`, `aprovado_em`, empurra evento, status → 'execucao' se ≥1 aprovado. Retorna a OS.
- `chat_cliente(p_numero int, p_texto text)` → dono da OS: append em chat + evento. Limite 500 chars.
- `avaliar_nps(p_numero int, p_nota int)` → dono, status='entregue', nps null: grava nps + evento.
- `checkin_os(p_os jsonb, p_veiculo jsonb, p_cliente jsonb)` → staff: transação única (numero da sequence, upsert veiculo, upsert cliente preservando convite/auth, insert ordem). Retorna `{numero, convite}`.

Auth:
- Cliente: e-mail sintético `c<telefone_norm>@clientes.eurovix.app` + senha criada no convite. Fluxo: `supabase.auth.signUp({email, password})` → `rpc('ativar_convite', {p_token})`. Login: `signInWithPassword`. **Runbook DEVE instruir: Authentication → Providers → Email → desativar "Confirm email"** (e-mails sintéticos não recebem correio).
- Staff: usuário real criado no dashboard + `insert into staff(auth_user, nome) values ((select id from auth.users where email='...'), 'Paulo Victor')` no runbook.
- Troca de senha do cliente: `auth.updateUser` (Fase atual: só via app logado; "esqueci" = novo convite no balcão, já é o fluxo).

## Adaptador (assets/js/werk-cloud.js)

- IIFE clássico (sem módulos), carregado APÓS werk-data.js e APÓS `assets/vendor/supabase.js` (UMD global `supabase.createClient`).
- Se `!EVX_ENV.SUPABASE_URL || !EVX_ENV.SUPABASE_ANON_KEY` → não faz nada (modo demo).
- Hidratação: `ready = Promise.all([fetch ordens, veiculos, clientes(se staff/dono), config(se staff)])` → espelho `{os:[], vehicles:[], clients:[], config}` → grava cache localStorage → resolve. Cliente não-staff: clientes = só o próprio (RLS entrega). Anon (ninguém logado): tudo vazio exceto nada — telas de login não precisam de dados; `convite_info` cobre o cadastro.
- Realtime: um canal `postgres_changes` para ordens/veiculos/clientes/config → upsert/remove no espelho pela PK → cache → `evx:sync`.
- Ordenação do espelho de ordens: `criada` desc (paridade com unshift local).
- `updateOS(numero, mut, evento)`: aplica no espelho (mesma semântica do local, incl. push de evento), retorna a OS; push assíncrono com guarda de versão: `update ... .eq('numero', n).eq('versao', vLocal)`; se 0 linhas → refetch + reaplicar mut 1x → push; se falhar de novo → refetch + warn.
- `setStatus`: como local (usa updateOS) + notificação EVX se disponível (delegar ao local? o local setStatus usa updateOS local — adaptador reimplementa chamando SEU updateOS e copiando o push de notificação).
- `novaOS(dados)`: staff → `rpc('checkin_os', ...)`? NÃO — novaOS é chamada também por seed15 (staff/demo). Na nuvem: `novaOS` async → rpc `checkin_os` com os 3 payloads montados a partir de `dados` (o veículo vem por `upsertVehicle` separado hoje em werkos; a RPC aceita `p_veiculo null` → só ordem+cliente; werkos continuará chamando upsertVehicle/upsertCliente — que na nuvem são otimistas com push staff-direto). Simplicidade > transação perfeita na Fase 1: `novaOS` async usa `nova_os_numero()` + insert direto (staff tem policy). Retorna a OS completa.
- `loginCliente(tel, senha)` async: signInWithPassword(email sintético) → sucesso: garante espelho hidratado → retorna cliente do espelho (ou fetch). Falha → null.
- `ativarCliente(token, senha)` async: pega `convite_info`; signUp; se "User already registered" → signInWithPassword; `rpc ativar_convite`; re-hidrata; retorna cliente.
- `clientePorConvite(token)` async na nuvem: `rpc convite_info` (mapear para shape `{nome, telefone, senha: ativo ? 'x' : null, convite: token}` + veículos vão pro espelho temporário para `garagemDe` do cadastro funcionar — OU retornar `{__veiculos}` e o app usa isso; DECISÃO: o adaptador guarda `ultimoConviteInfo` e `garagemDe(tel)` consulta espelho ∪ essa info; simples).
- `pendencias/getOS/getAllOS/getVehicles/getClientes/garagemDe/clientePorTelefone/getConfig`: síncronos sobre espelho.
- `upsertCliente/upsertVehicle/saveConfig/saveAllOS/chatSend (staff)`: otimista + push. `chatSend` de CLIENTE (detectado por `!is_staff` no espelho/authUser) → rpc `chat_cliente`. Aprovação do cliente: app.js chamará `updateOS` hoje; na nuvem o adaptador detecta usuário cliente e converte a mutação de aprovação em `rpc aprovar_orcamento` — NÃO: frágil demais. DECISÃO: app.js (call-site de aprovação/NPS/chat) passa a chamar novas funções do contrato `WERK.aprovarOrcamento(numero, decisoes, aceite)`, `WERK.avaliarNps(numero, nota)`, `WERK.chatCliente(numero, texto)` — no local elas delegam para updateOS/chatSend com a mesma lógica atual; na nuvem viram RPCs. (Integração dos call-sites é responsabilidade do orquestrador, não dos agentes.)
- Erros de rede: capturar, `online=false`, `evx:sync`; próximo sucesso → true.

## Runbook (SETUP-NUVEM.md) — passos exatos para o dono

1. Criar projeto no supabase.com (free tier, região São Paulo `sa-east-1`).
2. SQL Editor → colar `supabase/schema.sql` → Run (re-executável).
3. Authentication → Sign In/Providers → Email: ON, **Confirm email: OFF**.
4. Criar usuário staff (Authentication → Users → Add user, e-mail real + senha) e rodar o INSERT de staff do runbook.
5. Settings → API → copiar `Project URL` e `anon public` → colar em `assets/js/env.js` → commit/push (deploy automático).
6. Testar: werkos.html pede login staff; check-in cria OS real; app.html?convite=… cria cliente real; painel live.
7. O que NUNCA fazer: colar `service_role` no site.

## Divisão de trabalho

- **Agente Schema**: escreve `supabase/schema.sql` (+ comentários por bloco). Deve ler `assets/js/werk-data.js` para paridade de campos/status e o contrato para RLS/RPCs. Idempotência total (drop policy if exists / create or replace function / on conflict).
- **Agente Adaptador**: escreve `assets/js/werk-cloud.js` completo + `assets/js/env.js` (placeholders vazios + comentário de instrução). Lê `assets/js/werk-data.js` (interface + semântica de updateOS/novaOS/pendencias) e o contrato.
- **Agente Runbook**: escreve `SETUP-NUVEM.md` (PT-BR, passo a passo com telas nomeadas do dashboard Supabase 2026) e um bloco novo para o README (seção "☁️ Nuvem (produção)") salvo em `supabase/README-secao.md`.
- **Revisores adversariais** (1 por artefato): RLS/segurança (schema), paridade de interface + corridas (adaptador), executabilidade do runbook por leigo.
- **Orquestrador (fora dos agentes)**: var WERK, gate de seeds, script tags, call-sites await/aprovarOrcamento/avaliarNps/chatCliente, tela de login staff no werkos, `WERK.ready` gating, vendor supabase.js, testes e publicação.
