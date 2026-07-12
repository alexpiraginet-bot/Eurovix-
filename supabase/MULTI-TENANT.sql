-- ============================================================================
-- LexOS · MULTI-TENANT — upgrade do banco single-tenant (EUROVIX) para
-- MULTI-OFICINA com isolamento estrito por tenant (oficina).
--
-- Pré-requisitos: supabase/schema.sql JÁ aplicado. supabase/ADMIN-OFICINAS.sql
-- é opcional — a seção 1 recria os essenciais (oficinas/lex_admins/is_lex_admin)
-- de forma idempotente, então este arquivo é autossuficiente.
--
-- Invariante de isolamento: TODA linha operacional (clientes, veiculos, ordens,
-- eventos_log, config, staff) pertence a UMA oficina (oficina_id). Staff só
-- enxerga/escreve linhas da SUA oficina (minha_oficina()); o cliente final só
-- enxerga o que é dele (auth_user/telefone — propositalmente CROSS-oficina:
-- a mesma pessoa pode ser cliente de duas oficinas); lex_admin (suporte LexOS)
-- lê tudo. Nenhuma policy usa "is not distinct from": igualdade estrita com
-- NULL falha FECHADO — staff sem oficina vinculada não enxerga NADA.
--
-- 100% idempotente: pode ser colado e re-executado no SQL Editor sem erro.
-- Mudanças de PK/constraint são guardadas por DO blocks que consultam
-- pg_constraint antes de agir.
--
-- ATENÇÃO: se algum dia schema.sql for RE-executado depois deste upgrade, ele
-- recria as policies/RPCs single-tenant antigas — re-execute ESTE arquivo em
-- seguida para restaurar o isolamento multi-tenant.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0 · Extensões
-- pgcrypto: gen_random_uuid() e gen_random_bytes() (tokens de convite).
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ============================================================================
-- 1 · FUNDAÇÃO — registro de oficinas (tenants) + allowlist de admins LexOS
-- Recria o essencial de ADMIN-OFICINAS.sql para este arquivo ser
-- autossuficiente. Tudo "if not exists"/"or replace": rodar duas vezes é ok.
-- ============================================================================

-- oficinas: cada linha é UM tenant. O id é a chave de isolamento de todo o
-- resto do banco. `convite` (novo) é o token de ativação do DONO da oficina —
-- credencial de 128 bits enviada pelo admin LexOS (espelha clientes.convite).
create table if not exists public.oficinas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  responsavel   text,
  whatsapp      text,
  email         text,
  cidade        text,
  plano         text not null default 'Conecta',
  addon_ia      boolean not null default false,
  unidades      integer not null default 1,
  subdominio    text,
  status        text not null default 'lead',
  obs           text,
  convite       text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint oficinas_plano_chk  check (plano  in ('Conecta','Digital','Marca própria')),
  constraint oficinas_status_chk check (status in ('lead','ativando','ativa','pausada'))
);

-- bases que já rodaram ADMIN-OFICINAS.sql (sem a coluna nova):
alter table public.oficinas add column if not exists convite text;

create unique index if not exists oficinas_subdominio_uidx
  on public.oficinas (lower(subdominio))
  where subdominio is not null and subdominio <> '';

-- convite do dono é único QUANDO presente (índice parcial): duas oficinas
-- jamais compartilham o mesmo token de ativação.
create unique index if not exists oficinas_convite_uidx
  on public.oficinas (convite)
  where convite is not null and convite <> '';

-- lex_admins: allowlist (por e-mail do Auth) de quem opera a central LexOS.
-- NÃO inserimos nenhum e-mail aqui — o bootstrap é do ADMIN-OFICINAS.sql /
-- runbook, para este arquivo nunca plantar um placeholder na allowlist.
create table if not exists public.lex_admins (
  email     text primary key,
  criado_em timestamptz not null default now()
);

-- is_lex_admin(): o usuário autenticado atual é admin da central LexOS?
-- security definer para ler lex_admins sem RLS; pg_temp no fim do search_path
-- (endurece a versão do ADMIN-OFICINAS.sql, que não fixava pg_temp).
create or replace function public.is_lex_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.lex_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- atualizado_em automático da oficinas.
create or replace function public.tg_oficinas_touch()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists oficinas_touch on public.oficinas;
create trigger oficinas_touch
  before update on public.oficinas
  for each row execute function public.tg_oficinas_touch();

-- RLS de oficinas: SÓ lex_admin lê/escreve DIRETO na tabela. Staff NÃO ganha
-- SELECT nem na própria oficina DE PROPÓSITO: a linha carrega `convite` (a
-- credencial que dá papel de admin via ativar_oficina) e policy não esconde
-- coluna — um mecânico que lesse o token da própria oficina poderia tentar
-- escalar. O que o painel da oficina precisa (plano) sai por oficina_plano().
alter table public.oficinas enable row level security;

drop policy if exists oficinas_admin_all on public.oficinas;
create policy oficinas_admin_all on public.oficinas
  for all to authenticated
  using (public.is_lex_admin())
  with check (public.is_lex_admin());

-- lex_admins: nenhuma policy = ninguém lê/escreve via API (nem lex_admin);
-- a allowlist só muda pelo SQL Editor. is_lex_admin() (definer) consulta por
-- baixo do RLS.
alter table public.lex_admins enable row level security;

grant select, insert, update, delete on public.oficinas to authenticated;

-- ============================================================================
-- 2 · COLUNAS DE TENANT — oficina_id em toda tabela operacional
-- on delete cascade: apagar a oficina apaga o universo dela. Exceção prática:
-- eventos_log tem trigger de imutabilidade que bloqueia DELETE — uma oficina
-- COM histórico de auditoria não pode ser apagada (use status='pausada');
-- é intencional: auditoria não se apaga por engano de um clique.
-- As colunas ficam NULLABLE no DDL; quem garante o preenchimento é o par
-- backfill (§3) + policies/RPCs (§6..§9), que forçam oficina_id em todo INSERT.
-- ============================================================================

alter table public.clientes    add column if not exists oficina_id uuid;
alter table public.veiculos    add column if not exists oficina_id uuid;
alter table public.ordens      add column if not exists oficina_id uuid;
alter table public.eventos_log add column if not exists oficina_id uuid;
alter table public.config      add column if not exists oficina_id uuid;
alter table public.staff       add column if not exists oficina_id uuid;

-- FKs garantidas por DO block (e não inline no add column) para cobrir também
-- bases onde a coluna foi criada à mão sem FK: checa pg_constraint por uma FK
-- da coluna oficina_id apontando para oficinas e cria só se faltar.
do $$
declare
  v_tab text;
begin
  foreach v_tab in array array['clientes','veiculos','ordens','eventos_log','config','staff'] loop
    if not exists (
      select 1
        from pg_constraint c
       where c.conrelid  = ('public.' || v_tab)::regclass
         and c.contype   = 'f'
         and c.confrelid = 'public.oficinas'::regclass
         and (select array_agg(a.attname::text order by k.ord)
                from unnest(c.conkey) with ordinality as k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
             = array['oficina_id']
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (oficina_id)
           references public.oficinas (id) on delete cascade',
        v_tab, v_tab || '_oficina_id_fkey');
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- 3 · BACKFILL EUROVIX — o acervo single-tenant vira o tenant nº 1
-- Chave estável de busca: nome ilike 'EUROVIX%'. Se não existir, cria a
-- oficina (Marca própria, ativa). Depois carimba oficina_id em TODA linha
-- ainda nula. Re-execução: zero linhas nulas → no-op limpo.
-- ============================================================================
do $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.oficinas
   where nome ilike 'EUROVIX%'
   order by criado_em asc
   limit 1;

  if v_id is null then
    insert into public.oficinas (nome, responsavel, plano, status, obs)
    values ('EUROVIX', 'Paulo Victor de Almeida', 'Marca própria', 'ativa',
            'Tenant original — criado automaticamente pelo MULTI-TENANT.sql')
    returning id into v_id;
  end if;

  update public.clientes set oficina_id = v_id where oficina_id is null;
  update public.veiculos set oficina_id = v_id where oficina_id is null;
  -- nota: o UPDATE em ordens dispara os triggers da OS — versao sobe +1 e
  -- atualizado_em é carimbado UMA vez (só na 1ª execução, quando há nulos);
  -- eventos não muda de tamanho, então nada novo cai no eventos_log.
  update public.ordens   set oficina_id = v_id where oficina_id is null;
  update public.config   set oficina_id = v_id where oficina_id is null;
  update public.staff    set oficina_id = v_id where oficina_id is null;

  -- eventos_log é imutável por trigger (inclusive para 0 linhas: o trigger é
  -- por STATEMENT) — desliga só durante o backfill e religa em seguida.
  -- Se o UPDATE falhar, a transação inteira reverte (o disable junto).
  if exists (select 1 from public.eventos_log where oficina_id is null) then
    alter table public.eventos_log disable trigger trg_eventos_log_imutavel;
    update public.eventos_log set oficina_id = v_id where oficina_id is null;
    alter table public.eventos_log enable trigger trg_eventos_log_imutavel;
  end if;
end;
$$;

-- ============================================================================
-- 4 · RE-CHAVEAMENTO — as chaves globais viram chaves POR OFICINA
-- Roda DEPOIS do backfill: os ADD PRIMARY KEY abaixo exigem oficina_id
-- preenchido (PK implica NOT NULL) e o §3 garante que não sobrou nulo.
-- Cada mudança é guardada por consulta a pg_constraint: re-rodar não erra.
-- ============================================================================

-- 4.1 · veiculos: PK (vin) → (oficina_id, vin). O MESMO chassi pode ser
-- atendido por duas oficinas de forma independente (cofre/km/notas próprios).
-- Nenhuma FK aponta para veiculos (joins são por vin dentro do tenant), então
-- trocar a PK não quebra dependência. A tabela está na publication realtime:
-- a troca acontece na mesma transação, e a replica identity default passa a
-- ser a PK composta automaticamente.
do $$
declare
  v_pk   text;
  v_cols text[];
begin
  select c.conname,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(c.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
    into v_pk, v_cols
    from pg_constraint c
   where c.conrelid = 'public.veiculos'::regclass
     and c.contype  = 'p';

  if v_cols = array['oficina_id','vin'] then
    return; -- já migrado
  end if;
  if v_pk is not null then
    execute format('alter table public.veiculos drop constraint %I', v_pk);
  end if;
  alter table public.veiculos
    add constraint veiculos_pkey primary key (oficina_id, vin);
end;
$$;

-- 4.2 · clientes: derruba os uniques GLOBAIS herdados do single-tenant —
--   · unique(telefone_norm): o mesmo telefone agora pode ser cliente de N
--     oficinas → vira unique (oficina_id, telefone_norm);
--   · unique(auth_user): o mesmo login Supabase (a pessoa) pode ter UMA linha
--     de cliente POR oficina — o vínculo deixa de ser 1:1 global.
-- `convite` segue ÚNICO GLOBALMENTE (o token identifica a linha exata, em
-- qualquer oficina) — o loop abaixo é cirúrgico e NÃO toca nele.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.clientes'::regclass
       and c.contype  = 'u'
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
           in (array['telefone_norm'], array['auth_user'])
  loop
    execute format('alter table public.clientes drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.clientes'::regclass
       and c.contype  = 'u'
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
           = array['oficina_id','telefone_norm']
  ) then
    -- alvo do ON CONFLICT do checkin_os multi-tenant (§8)
    alter table public.clientes
      add constraint clientes_oficina_telefone_uk unique (oficina_id, telefone_norm);
  end if;
end;
$$;

-- 4.3 · config: de singleton (id=1) para UMA LINHA POR OFICINA.
-- Remove o CHECK (id = 1), troca a PK de (id) para (oficina_id) — que também
-- é o alvo de ON CONFLICT dos upserts de configuração. A coluna id fica como
-- vestígio inofensivo (default 1, sem unicidade); `data jsonb` permanece.
do $$
declare
  r      record;
  v_pk   text;
  v_cols text[];
begin
  -- CHECK (id = 1): procurado pela DEFINIÇÃO (não pelo nome gerado)
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.config'::regclass
       and c.contype  = 'c'
       and pg_get_constraintdef(c.oid) ~* '\mid\s*=\s*1\M'
  loop
    execute format('alter table public.config drop constraint %I', r.conname);
  end loop;

  select c.conname,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(c.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
    into v_pk, v_cols
    from pg_constraint c
   where c.conrelid = 'public.config'::regclass
     and c.contype  = 'p';

  if v_cols is distinct from array['oficina_id'] then
    if v_pk is not null then
      execute format('alter table public.config drop constraint %I', v_pk);
    end if;
    alter table public.config
      add constraint config_pkey primary key (oficina_id);
  end if;
end;
$$;

-- 4.4 · Índices de apoio por oficina_id. veiculos, clientes e config já são
-- cobertos pelos índices compostos/PK criados acima (oficina_id é a coluna
-- LÍDER de veiculos_pkey, clientes_oficina_telefone_uk e config_pkey) — criar
-- outro seria custo de escrita à toa. Faltam os três abaixo.
create index if not exists idx_ordens_oficina      on public.ordens      (oficina_id);
create index if not exists idx_eventos_log_oficina on public.eventos_log (oficina_id);
create index if not exists idx_staff_oficina       on public.staff       (oficina_id);

-- meus_telefones()/RPCs filtram clientes por auth_user em TODA avaliação de
-- policy — o índice sumiu junto com o unique(auth_user), então repõe um comum.
create index if not exists idx_clientes_auth_user  on public.clientes (auth_user);

-- ============================================================================
-- 5 · HELPERS DE TENANT
-- security definer (como is_staff/meus_telefones do schema.sql): rodam como
-- dono do schema e podem ser usados dentro das policies sem recursão.
-- ============================================================================

-- minha_oficina(): a oficina do STAFF autenticado atual. NULL para quem não é
-- staff (ou staff órfão sem oficina) — e nas policies a igualdade estrita com
-- NULL falha fechado. staff.auth_user é PK: no máximo 1 linha ⇒ 1 oficina por
-- colaborador.
create or replace function public.minha_oficina()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select oficina_id from public.staff where auth_user = auth.uid();
$$;

-- oficina_plano(): plano contratado da oficina do staff atual (Conecta /
-- Digital / Marca própria) — o app usa para ligar/desligar módulos. É a via
-- OFICIAL de o painel saber o plano, já que staff não tem SELECT em oficinas
-- (ver §1: a linha carrega o token `convite` do dono). NULL para não-staff.
create or replace function public.oficina_plano()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.plano
    from public.oficinas o
   where o.id = public.minha_oficina();
$$;

-- ============================================================================
-- 6 · RLS MULTI-TENANT — reescrita completa das policies
-- Padrão staff:  is_lex_admin() OR (is_staff() AND oficina_id = minha_oficina())
--   · is_staff() na frente GARANTE que um autenticado comum (cliente) nunca
--     entra no ramo de staff — e para staff órfão minha_oficina() é NULL,
--     a igualdade vira NULL e a linha NÃO passa (fail closed);
--   · o WITH CHECK repete a MESMA igualdade ⇒ INSERT/UPDATE só grava linha
--     com oficina_id = a oficina do executor (impossível plantar/mover linha
--     para outra oficina), exceto lex_admin (suporte com poder total);
-- Padrão cliente: continua por auth_user/telefone e é CROSS-oficina de
--   propósito — a pessoa vê os carros/OS dela em qualquer oficina onde é
--   cliente. Cliente segue SEM escrita direta (só RPCs definer).
-- anon segue sem policy nenhuma (SELECT vazio, escrita negada).
-- ============================================================================

-- Defesa em profundidade: RLS já vem ligado pelo schema.sql, mas re-afirmar é
-- grátis e idempotente — policy sem RLS ligado não filtra NADA.
alter table public.clientes    enable row level security;
alter table public.veiculos    enable row level security;
alter table public.ordens      enable row level security;
alter table public.eventos_log enable row level security;
alter table public.config      enable row level security;
alter table public.staff       enable row level security;

-- clientes -------------------------------------------------------------------
drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina())
         or auth_user = auth.uid());

drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes
  for insert to authenticated
  with check (public.is_lex_admin()
              or (public.is_staff() and oficina_id = public.minha_oficina()));

drop policy if exists clientes_update on public.clientes;
create policy clientes_update on public.clientes
  for update to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()))
  with check (public.is_lex_admin()
              or (public.is_staff() and oficina_id = public.minha_oficina()));

drop policy if exists clientes_delete on public.clientes;
create policy clientes_delete on public.clientes
  for delete to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()));

-- veiculos --------------------------------------------------------------------
drop policy if exists veiculos_select on public.veiculos;
create policy veiculos_select on public.veiculos
  for select to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina())
         or telefone_norm in (select public.meus_telefones()));

drop policy if exists veiculos_insert on public.veiculos;
create policy veiculos_insert on public.veiculos
  for insert to authenticated
  with check (public.is_lex_admin()
              or (public.is_staff() and oficina_id = public.minha_oficina()));

drop policy if exists veiculos_update on public.veiculos;
create policy veiculos_update on public.veiculos
  for update to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()))
  with check (public.is_lex_admin()
              or (public.is_staff() and oficina_id = public.minha_oficina()));

drop policy if exists veiculos_delete on public.veiculos;
create policy veiculos_delete on public.veiculos
  for delete to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()));

-- ordens ----------------------------------------------------------------------
drop policy if exists ordens_select on public.ordens;
create policy ordens_select on public.ordens
  for select to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina())
         or telefone_norm in (select public.meus_telefones()));

drop policy if exists ordens_insert on public.ordens;
create policy ordens_insert on public.ordens
  for insert to authenticated
  with check (public.is_lex_admin()
              or (public.is_staff() and oficina_id = public.minha_oficina()));

drop policy if exists ordens_update on public.ordens;
create policy ordens_update on public.ordens
  for update to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()))
  with check (public.is_lex_admin()
              or (public.is_staff() and oficina_id = public.minha_oficina()));

drop policy if exists ordens_delete on public.ordens;
create policy ordens_delete on public.ordens
  for delete to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()));

-- config: 1 linha por oficina; segue invisível para o cliente final ----------
drop policy if exists config_select on public.config;
create policy config_select on public.config
  for select to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()));

drop policy if exists config_insert on public.config;
create policy config_insert on public.config
  for insert to authenticated
  with check (public.is_lex_admin()
              or (public.is_staff() and oficina_id = public.minha_oficina()));

drop policy if exists config_update on public.config;
create policy config_update on public.config
  for update to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()))
  with check (public.is_lex_admin()
              or (public.is_staff() and oficina_id = public.minha_oficina()));

-- eventos_log: leitura escopada; segue SEM policy de escrita (quem grava é o
-- trigger definer, e o trigger de imutabilidade barra UPDATE/DELETE) ---------
drop policy if exists eventos_log_select on public.eventos_log;
create policy eventos_log_select on public.eventos_log
  for select to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()));

-- staff: cada equipe só vê a PRÓPRIA equipe; escrita segue só via RPC/definer
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff
  for select to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina()));

-- ============================================================================
-- 7 · AUDITORIA — eventos_log herda a oficina da OS
-- Sem isto, cada evento novo nasceria com oficina_id NULL e ficaria invisível
-- para o staff da própria oficina (a policy do §6 é escopada). Mesmo corpo do
-- schema.sql + carimbo de new.oficina_id. O trigger em si já existe
-- (trg_ordens_eventos_log) e continua apontando para esta função.
-- ============================================================================
create or replace function public.log_eventos_novos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes  int := 0;
  v_depois int := 0;
  v_ev     jsonb;
  v_ts     timestamptz;
begin
  if tg_op = 'UPDATE' and jsonb_typeof(old.eventos) = 'array' then
    v_antes := jsonb_array_length(old.eventos);
  end if;
  if jsonb_typeof(new.eventos) = 'array' then
    v_depois := jsonb_array_length(new.eventos);
  end if;
  if v_depois > v_antes then
    for i in v_antes .. v_depois - 1 loop
      v_ev := new.eventos -> i;
      begin
        v_ts := (v_ev ->> 'ts')::timestamptz;
      exception when others then
        v_ts := null;
      end;
      insert into public.eventos_log (oficina_id, os_numero, ts, tipo, titulo, descr, ator)
      values (
        new.oficina_id,
        new.numero,
        coalesce(v_ts, now()),
        v_ev ->> 'tipo',
        v_ev ->> 'titulo',
        coalesce(v_ev ->> 'desc', v_ev ->> 'descr'),
        v_ev ->> 'ator'
      );
    end loop;
  end if;
  return null;
end;
$$;

-- ============================================================================
-- 8 · RPCs REESCRITAS — mesmas validações do schema.sql + escopo de oficina
-- nova_os_numero / aprovar_orcamento / chat_cliente / avaliar_nps ficam COMO
-- ESTÃO (não são redefinidas aqui): a numeração é uma sequence global (ok) e
-- as três RPCs do cliente já são travadas pelo DONO da OS via meus_telefones()
-- — que é cross-oficina por desígnio e continua correto e inalterado.
-- ============================================================================

-- checkin_os: check-in completo em transação única (staff-only), agora
-- carimbando a oficina do executor em ORDEM + VEÍCULO + CLIENTE. Upserts
-- re-chaveados: veiculos por (oficina_id, vin), clientes por
-- (oficina_id, telefone_norm). Staff sem oficina vinculada NÃO abre OS.
create or replace function public.checkin_os(p_os jsonb, p_veiculo jsonb, p_cliente jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_oficina uuid;
  v_numero  int;
  v_convite text := null;
  v_token   text;
  v_vin     text;
  v_tel_cli text;
  v_tel_os  text;
  v_evento  jsonb;
begin
  if not public.is_staff() then
    raise exception 'Apenas staff pode fazer check-in de OS';
  end if;
  v_oficina := public.minha_oficina();
  if v_oficina is null then
    raise exception 'Seu usuário não está vinculado a nenhuma oficina — fale com o suporte LexOS';
  end if;
  if p_os is null or jsonb_typeof(p_os) <> 'object' then
    raise exception 'Dados da OS inválidos';
  end if;

  v_numero := nextval('public.os_numero_seq')::int;

  -- veículo (opcional): upsert com merge — campos ausentes preservam o atual.
  -- A chave agora é (oficina_id, vin): o mesmo chassi em OUTRA oficina é outra
  -- linha, com cofre/km próprios — nada vaza entre tenants.
  if p_veiculo is not null and jsonb_typeof(p_veiculo) = 'object' then
    v_vin := nullif(upper(btrim(coalesce(p_veiculo ->> 'vin', ''))), '');
    if v_vin is null then
      raise exception 'Veículo sem VIN';
    end if;
    insert into public.veiculos (oficina_id, vin, dados, placa, placa_norm, km, cliente, telefone_norm, cofre)
    values (
      v_oficina,
      v_vin,
      case when jsonb_typeof(p_veiculo -> 'dados') = 'object'
           then p_veiculo -> 'dados' else '{}'::jsonb end,
      p_veiculo ->> 'placa',
      nullif(regexp_replace(upper(coalesce(p_veiculo ->> 'placa', '')), '[^A-Z0-9]', '', 'g'), ''),
      coalesce(nullif(regexp_replace(coalesce(p_veiculo ->> 'km', ''), '\D', '', 'g'), '')::int, 0),
      p_veiculo ->> 'cliente',
      nullif(regexp_replace(coalesce(p_veiculo ->> 'telefone_norm', p_veiculo ->> 'telefone', ''), '\D', '', 'g'), ''),
      case when jsonb_typeof(p_veiculo -> 'cofre') = 'array'
           then p_veiculo -> 'cofre' else '[]'::jsonb end
    )
    on conflict (oficina_id, vin) do update set
      dados         = veiculos.dados || excluded.dados,
      placa         = case when jsonb_exists(p_veiculo, 'placa')   then excluded.placa      else veiculos.placa      end,
      placa_norm    = case when jsonb_exists(p_veiculo, 'placa')   then excluded.placa_norm else veiculos.placa_norm end,
      km            = case when jsonb_exists(p_veiculo, 'km')      then excluded.km         else veiculos.km         end,
      cliente       = case when jsonb_exists(p_veiculo, 'cliente') then excluded.cliente    else veiculos.cliente    end,
      telefone_norm = coalesce(excluded.telefone_norm, veiculos.telefone_norm),
      cofre         = case when jsonb_exists(p_veiculo, 'cofre')   then excluded.cofre      else veiculos.cofre      end;
  end if;

  -- cliente (opcional): upsert por (oficina_id, telefone_norm) preservando
  -- convite/auth_user/ativado_em da linha já existente NESTA oficina. O token
  -- de convite segue globalmente único entre TODAS as oficinas.
  if p_cliente is not null and jsonb_typeof(p_cliente) = 'object' then
    v_tel_cli := nullif(regexp_replace(coalesce(p_cliente ->> 'telefone_norm', p_cliente ->> 'telefone', ''), '\D', '', 'g'), '');
    if v_tel_cli is not null then
      -- token de convite: é a CREDENCIAL de ativação da conta do cliente —
      -- gerado com 128 bits (enumeração/colisão inviáveis); se o staff
      -- informar um, exigimos comprimento mínimo equivalente.
      v_token := nullif(btrim(coalesce(p_cliente ->> 'convite', '')), '');
      if v_token is not null and length(v_token) < 20 then
        raise exception 'Convite informado precisa ter no mínimo 20 caracteres';
      end if;
      if v_token is null then
        loop
          v_token := encode(gen_random_bytes(16), 'hex');
          exit when not exists (select 1 from public.clientes where convite = v_token);
        end loop;
      end if;
      insert into public.clientes (oficina_id, telefone_norm, telefone, nome, desde, convite)
      values (
        v_oficina,
        v_tel_cli,
        coalesce(nullif(p_cliente ->> 'telefone', ''), v_tel_cli),
        coalesce(nullif(p_cliente ->> 'nome', ''), 'Cliente'),
        coalesce(nullif(regexp_replace(coalesce(p_cliente ->> 'desde', ''), '\D', '', 'g'), '')::int, extract(year from now())::int),
        v_token
      )
      on conflict (oficina_id, telefone_norm) do update set
        nome     = case when coalesce(p_cliente ->> 'nome', '') <> ''
                        then excluded.nome else clientes.nome end,
        telefone = case when coalesce(p_cliente ->> 'telefone', '') <> ''
                        then excluded.telefone else clientes.telefone end
      returning convite into v_convite;
    end if;
  end if;

  -- ordem: nasce em 'fila', JÁ com a oficina do executor e o evento de
  -- abertura montado no servidor (o trigger copia o evento pro log com a
  -- mesma oficina_id).
  v_tel_os := nullif(regexp_replace(coalesce(p_os ->> 'telefone_norm', p_os ->> 'telefone', ''), '\D', '', 'g'), '');
  v_evento := jsonb_build_object(
    'ts',     now(),
    'tipo',   'abertura',
    'titulo', 'OS aberta',
    'desc',   'Check-in digital concluído',
    'ator',   coalesce(nullif(p_os ->> 'ator', ''), 'Recepção')
  );
  insert into public.ordens (oficina_id, numero, status, vin, veiculo, placa, cliente, telefone_norm,
                             sintoma, tecnico, consultor, checkin, eventos)
  values (
    v_oficina,
    v_numero,
    'fila',
    nullif(upper(btrim(coalesce(p_os ->> 'vin', ''))), ''),
    p_os ->> 'veiculo',
    coalesce(p_os ->> 'placa', ''),
    coalesce(nullif(p_os ->> 'cliente', ''), 'Cliente'),
    v_tel_os,
    coalesce(p_os ->> 'sintoma', ''),
    coalesce(p_os ->> 'tecnico', ''),
    coalesce(nullif(p_os ->> 'consultor', ''), ''),
    case when jsonb_typeof(p_os -> 'checkin') = 'object' then p_os -> 'checkin' else null end,
    jsonb_build_array(v_evento)
  );

  return jsonb_build_object('numero', v_numero, 'convite', v_convite);
end;
$$;

-- convite_info(p_token): dados públicos do convite para a tela de cadastro.
-- Callable por anon; sem o token exato não vaza nada (retorna null).
-- MUDANÇA multi-tenant: a prévia de veículos junta pela OFICINA DA LINHA DO
-- CLIENTE + telefone — nunca mostra carros do mesmo telefone em OUTRA oficina.
create or replace function public.convite_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cli      public.clientes%rowtype;
  v_veiculos jsonb;
begin
  if p_token is null or btrim(p_token) = '' then
    return null;
  end if;
  select * into v_cli from public.clientes where convite = btrim(p_token);
  if not found then
    return null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'modelo', v.dados ->> 'modelo',
           'placa',  v.placa,
           'cor',    v.dados ->> 'cor')), '[]'::jsonb)
    into v_veiculos
    from public.veiculos v
   where length(v_cli.telefone_norm) > 0
     and v.oficina_id = v_cli.oficina_id      -- escopo do tenant (NULL ⇒ prévia vazia, fail closed)
     and v.telefone_norm = v_cli.telefone_norm;
  return jsonb_build_object(
    'nome',     v_cli.nome,
    'telefone', v_cli.telefone,
    'veiculos', v_veiculos,
    'ativo',    v_cli.auth_user is not null
  );
end;
$$;

-- ativar_convite(p_token): vincula o convite ao usuário autenticado atual.
-- MUDANÇA multi-tenant: caiu a trava "esta conta já está vinculada a outro
-- cliente" — o MESMO login (a pessoa/telefone) pode ter uma linha de cliente
-- em VÁRIAS oficinas (o unique(auth_user) global foi removido no §4.2).
-- Permanecem: token obrigatório, idempotência para o MESMO uid e RAISE quando
-- o convite já foi usado por OUTRA conta.
create or replace function public.ativar_convite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_cli public.clientes%rowtype;
begin
  if v_uid is null then
    raise exception 'É preciso estar autenticado para ativar um convite';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Convite inválido';
  end if;
  select * into v_cli from public.clientes where convite = btrim(p_token) for update;
  if not found then
    raise exception 'Convite inválido';
  end if;
  if v_cli.auth_user is not null then
    if v_cli.auth_user = v_uid then
      return to_jsonb(v_cli); -- já ativado por este mesmo usuário: idempotente
    end if;
    raise exception 'Convite já utilizado por outra conta';
  end if;
  update public.clientes
     set auth_user = v_uid, ativado_em = now()
   where id = v_cli.id
  returning * into v_cli;
  return to_jsonb(v_cli);
end;
$$;

-- ============================================================================
-- 9 · EQUIPE POR OFICINA — staff_listar / staff_upsert / staff_remover
-- Mesmos papéis (mecanico · consultor · gestor · admin; admin = dono da
-- oficina) e mesmas regras do schema.sql, agora TODAS escopadas na oficina do
-- executor: um gestor/admin gerencia SOMENTE a própria equipe, e o invariante
-- do "último admin" é contado POR OFICINA.
-- ============================================================================

-- staff_listar(): a equipe DA MINHA oficina, com e-mail de login (join em
-- auth.users — por isso security definer). Qualquer membro da equipe vê.
create or replace function public.staff_listar()
returns table (auth_user uuid, nome text, papel text, email text, criado_em timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_staff() then
    raise exception 'Apenas a equipe pode ver a lista de colaboradores';
  end if;
  return query
    select s.auth_user, s.nome, s.papel, u.email::text, s.criado_em
      from public.staff s
      left join auth.users u on u.id = s.auth_user
     where s.oficina_id = public.minha_oficina()   -- NULL ⇒ lista vazia (fail closed)
     order by s.criado_em;
end;
$$;

-- staff_upsert(e-mail, nome, papel): cria OU edita um colaborador DA MINHA
-- oficina pelo e-mail de login (o painel cadastra o login no Auth antes).
-- Blindagens multi-tenant:
--   · executor precisa ter oficina (RAISE se órfão);
--   · um login que já é staff de OUTRA oficina não pode ser "roubado" —
--     RAISE explícito (a mensagem admite que o e-mail está em uso; o cadastro
--     público do Supabase Auth já revela existência de e-mail de toda forma,
--     então isso não abre oráculo novo);
--   · o INSERT carimba oficina_id = oficina do executor, nunca outra.
create or replace function public.staff_upsert(p_email text, p_nome text, p_papel text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exec      text := public.staff_papel();
  v_oficina   uuid := public.minha_oficina();
  v_uid       uuid;
  v_atual     text;
  v_atual_ofi uuid;
begin
  if v_exec is null or v_exec not in ('gestor', 'admin') then
    raise exception 'Apenas gestor ou admin podem gerenciar a equipe';
  end if;
  if v_oficina is null then
    raise exception 'Seu usuário não está vinculado a nenhuma oficina — fale com o suporte LexOS';
  end if;
  if p_papel is null or p_papel not in ('mecanico', 'consultor', 'gestor', 'admin') then
    raise exception 'Papel inválido — use mecanico, consultor, gestor ou admin';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Informe o nome do colaborador';
  end if;
  if coalesce(trim(p_email), '') = '' then
    raise exception 'Informe o e-mail (login) do colaborador';
  end if;

  -- serializa as escritas na staff: o invariante do "último admin" (abaixo)
  -- é checado com count(*), então duas gestões simultâneas (inclusive
  -- ativar_oficina, §10) precisam ser ordenadas. SHARE ROW EXCLUSIVE bloqueia
  -- writes concorrentes mas deixa staff_listar (SELECT) passar.
  lock table public.staff in share row exclusive mode;

  select id into v_uid from auth.users
   where lower(email) = lower(trim(p_email))
   order by created_at limit 1;
  if v_uid is null then
    raise exception 'Nenhum login encontrado para % — o painel cria o login primeiro e chama de novo', trim(p_email);
  end if;

  select s.papel, s.oficina_id into v_atual, v_atual_ofi
    from public.staff s where s.auth_user = v_uid;

  -- fronteira de tenant: staff de outra oficina (ou órfão) é intocável daqui
  if v_atual is not null and v_atual_ofi is distinct from v_oficina then
    raise exception 'Este login já pertence à equipe de outra oficina';
  end if;

  -- gestor não toca em gestores/admins (nem promove ninguém a esses papéis)
  if v_exec = 'gestor' and (p_papel in ('gestor', 'admin') or coalesce(v_atual, '') in ('gestor', 'admin')) then
    raise exception 'Somente um admin pode criar ou alterar gestores e admins';
  end if;
  -- nunca rebaixar o último admin DA OFICINA (trancaria a gestão para sempre)
  if v_atual = 'admin' and p_papel <> 'admin'
     and (select count(*) from public.staff
           where papel = 'admin' and oficina_id = v_oficina) = 1 then
    raise exception 'Este é o único admin — promova outra pessoa a admin antes de rebaixá-lo';
  end if;

  insert into public.staff (auth_user, nome, papel, oficina_id)
  values (v_uid, trim(p_nome), p_papel, v_oficina)
  on conflict (auth_user) do update
    set nome = excluded.nome, papel = excluded.papel
  -- oficina_id NÃO entra no update: já provamos acima que é a mesma
  ;

  return jsonb_build_object('auth_user', v_uid, 'nome', trim(p_nome), 'papel', p_papel);
end;
$$;

-- staff_remover(uuid): tira a pessoa DA MINHA equipe. Alvo de outra oficina
-- recebe a MESMA mensagem de "não está na equipe" — a RPC não confirma nem
-- nega que o uuid exista em outro tenant (nenhum vazamento por erro).
create or replace function public.staff_remover(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exec    text := public.staff_papel();
  v_oficina uuid := public.minha_oficina();
  v_alvo    text;
begin
  if v_exec is null or v_exec not in ('gestor', 'admin') then
    raise exception 'Apenas gestor ou admin podem gerenciar a equipe';
  end if;
  if v_oficina is null then
    raise exception 'Seu usuário não está vinculado a nenhuma oficina — fale com o suporte LexOS';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'Você não pode remover a si mesmo da equipe';
  end if;
  -- serializa com as demais gestões (ver nota em staff_upsert): garante que
  -- duas remoções simultâneas não deixem 0 admins pela corrida no count(*).
  lock table public.staff in share row exclusive mode;
  select s.papel into v_alvo
    from public.staff s
   where s.auth_user = p_usuario
     and s.oficina_id = v_oficina;          -- só enxerga alvos da MINHA oficina
  if v_alvo is null then
    raise exception 'Esta pessoa não está na equipe';
  end if;
  if v_exec = 'gestor' and v_alvo in ('gestor', 'admin') then
    raise exception 'Somente um admin pode remover gestores e admins';
  end if;
  if v_alvo = 'admin' and (select count(*) from public.staff
                            where papel = 'admin' and oficina_id = v_oficina) = 1 then
    raise exception 'Este é o único admin — promova outra pessoa a admin antes de removê-lo';
  end if;
  delete from public.staff
   where auth_user = p_usuario
     and oficina_id = v_oficina;
end;
$$;

-- ============================================================================
-- 10 · CONVITE DO DONO — onboarding de uma oficina nova
-- Fluxo: admin LexOS cadastra a oficina na central → criar_convite_oficina()
-- gera o link → dono recebe por WhatsApp, cria login (cadastro público do
-- Auth) e chama ativar_oficina(token) → vira o PRIMEIRO admin da oficina e o
-- status pula para 'ativa'. Espelha o ativar_convite do cliente.
-- ============================================================================

-- criar_convite_oficina(p_oficina_id): SÓ lex_admin. Token de 128 bits em hex.
-- Política escolhida (documentada): REUSA o token existente se houver — o
-- admin LexOS pode re-consultar o mesmo link quantas vezes precisar sem
-- invalidar o que já foi enviado ao dono. Para ROTACIONAR/revogar, o admin
-- limpa a coluna (update public.oficinas set convite = null where id = ...;
-- ele tem UPDATE direto via policy do §1) e chama de novo.
create or replace function public.criar_convite_oficina(p_oficina_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ofi   public.oficinas%rowtype;
  v_token text;
begin
  if not public.is_lex_admin() then
    raise exception 'Apenas administradores LexOS podem gerar convite de oficina';
  end if;
  if p_oficina_id is null then
    raise exception 'Informe a oficina';
  end if;
  select * into v_ofi from public.oficinas where id = p_oficina_id for update;
  if not found then
    raise exception 'Oficina não encontrada';
  end if;
  -- reuso: token já emitido (e com o tamanho mínimo de segurança) volta como está
  if v_ofi.convite is not null and length(btrim(v_ofi.convite)) >= 32 then
    return v_ofi.convite;
  end if;
  loop
    v_token := encode(gen_random_bytes(16), 'hex');   -- 128 bits: enumeração inviável
    exit when not exists (select 1 from public.oficinas where convite = v_token);
  end loop;
  update public.oficinas set convite = v_token where id = p_oficina_id;
  return v_token;
end;
$$;

-- ativar_oficina(p_token): o DONO cria o próprio acesso a partir do link.
-- Segurança/semântica (documentadas):
--   · posse do token = identidade do dono (mesmo modelo de confiança do
--     convite de cliente); o token NÃO é limpo após o uso — o estado "gasto"
--     é "a oficina JÁ TEM um admin", checado sob lock:
--       - já tem admin e o chamador É um admin dela  → sucesso idempotente
--         (re-clicar o link após falha de rede não assusta o dono);
--       - já tem admin e o chamador NÃO é           → 'Convite já utilizado'
--         (um mecânico que roubasse o token NÃO escala para admin; um segundo
--         dispositivo do atacante idem);
--   · um login que já é staff de OUTRA oficina não pode ativar esta (staff é
--     1:1 com oficina — auth_user é PK);
--   · status: 'lead'/'ativando' → 'ativa'. 'pausada' NÃO reativa por token —
--     pausa é decisão comercial do LexOS e só o LexOS desfaz.
--   · para trocar o dono (suporte), o LexOS remove o admin atual da staff e
--     rotaciona o convite; aí o novo dono ativa normalmente.
create or replace function public.ativar_oficina(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_ofi       public.oficinas%rowtype;
  v_staff     public.staff%rowtype;
  v_tem_linha boolean := false;   -- o chamador já tem linha em staff?
  v_nome      text;
begin
  if v_uid is null then
    raise exception 'É preciso estar autenticado para ativar a oficina';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Convite inválido';
  end if;
  -- lock da linha da oficina + lock da staff: serializa duas ativações
  -- simultâneas do mesmo link e também corre em fila com staff_upsert/remover
  -- (mesma ordem de aquisição oficinas→staff em todas as RPCs: sem deadlock).
  select * into v_ofi from public.oficinas where convite = btrim(p_token) for update;
  if not found then
    raise exception 'Convite inválido';
  end if;
  lock table public.staff in share row exclusive mode;

  select * into v_staff from public.staff where auth_user = v_uid;
  v_tem_linha := found;   -- congelado AQUI: nada abaixo depende do FOUND implícito

  if exists (select 1 from public.staff
              where oficina_id = v_ofi.id and papel = 'admin') then
    -- token gasto: só o(s) admin(s) já ativado(s) recebem o "ok" idempotente
    if v_tem_linha and v_staff.oficina_id = v_ofi.id and v_staff.papel = 'admin' then
      return jsonb_build_object('oficina_id', v_ofi.id, 'nome', v_ofi.nome,
                                'papel', 'admin', 'ja_ativada', true);
    end if;
    raise exception 'Convite já utilizado por outra conta';
  end if;

  -- primeiro admin: o chamador não pode pertencer a OUTRA oficina
  if v_tem_linha and v_staff.oficina_id is not null and v_staff.oficina_id <> v_ofi.id then
    raise exception 'Esta conta já pertence à equipe de outra oficina';
  end if;

  v_nome := coalesce(
    nullif(btrim(coalesce(v_ofi.responsavel, '')), ''),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'Proprietário'
  );

  if v_tem_linha then
    -- linha pré-existente (plantada pelo suporte ou órfã do backfill) DESTA
    -- oficina/sem oficina: promove a admin e cola na oficina do token
    update public.staff
       set papel = 'admin', oficina_id = v_ofi.id
     where auth_user = v_uid;
  else
    insert into public.staff (auth_user, nome, papel, oficina_id)
    values (v_uid, v_nome, 'admin', v_ofi.id);
  end if;

  update public.oficinas
     set status = 'ativa'
   where id = v_ofi.id
     and status in ('lead', 'ativando');

  return jsonb_build_object('oficina_id', v_ofi.id, 'nome', v_ofi.nome,
                            'papel', 'admin', 'ja_ativada', false);
end;
$$;

-- ============================================================================
-- 11 · GRANTs — nega tudo primeiro, depois concede o mínimo (padrão §7 do
-- schema.sql: default privileges do Supabase dão EXECUTE a anon/authenticated
-- em função NOVA, então o REVOKE explícito vem antes de todo GRANT).
-- ============================================================================

revoke all on function public.is_lex_admin()                    from public, anon;
revoke all on function public.minha_oficina()                   from public, anon;
revoke all on function public.oficina_plano()                   from public, anon;
revoke all on function public.checkin_os(jsonb, jsonb, jsonb)   from public, anon;
revoke all on function public.convite_info(text)                from public, anon;
revoke all on function public.ativar_convite(text)              from public, anon;
revoke all on function public.staff_listar()                    from public, anon;
revoke all on function public.staff_upsert(text, text, text)    from public, anon;
revoke all on function public.staff_remover(uuid)               from public, anon;
revoke all on function public.criar_convite_oficina(uuid)       from public, anon;
revoke all on function public.ativar_oficina(text)              from public, anon;

-- is_lex_admin também para anon (paridade com ADMIN-OFICINAS.sql: a tela de
-- login da central consulta; para anon o jwt é nulo ⇒ sempre false).
grant execute on function public.is_lex_admin()                  to authenticated, anon;

-- helpers usados pelas policies (avaliados com o papel do chamador)
grant execute on function public.minha_oficina()                 to authenticated;
grant execute on function public.oficina_plano()                 to authenticated;

-- convite_info segue a ÚNICA RPC pública (tela de cadastro, antes do login)
grant execute on function public.convite_info(text)              to anon, authenticated;

-- RPCs de cliente/staff logado (as próprias funções validam papel/oficina)
grant execute on function public.ativar_convite(text)            to authenticated;
grant execute on function public.checkin_os(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.staff_listar()                  to authenticated;
grant execute on function public.staff_upsert(text, text, text)  to authenticated;
grant execute on function public.staff_remover(uuid)             to authenticated;

-- onboarding de oficina: criar_convite valida is_lex_admin() por dentro;
-- ativar_oficina é para o dono recém-logado.
grant execute on function public.criar_convite_oficina(uuid)     to authenticated;
grant execute on function public.ativar_oficina(text)            to authenticated;

-- ============================================================================
-- Fim — banco multi-tenant. Checklist do que este arquivo garante:
--   · toda tabela operacional tem oficina_id (FK oficinas, cascade);
--   · dados EUROVIX pré-existentes viraram o tenant nº 1 (backfill);
--   · veiculos PK (oficina_id, vin) · clientes unique (oficina_id,
--     telefone_norm) e SEM unique global de auth_user · config PK oficina_id;
--   · staff só lê/escreve a PRÓPRIA oficina (policies + RPCs; INSERT sempre
--     com with check de oficina_id = minha_oficina());
--   · cliente final continua enxergando SÓ o que é dele (cross-oficina por
--     telefone/auth_user, por desígnio) e escrevendo SÓ via RPC definer;
--   · lex_admin (suporte) lê tudo; anon não lê nada além de convite_info;
--   · nova_os_numero/aprovar_orcamento/chat_cliente/avaliar_nps intactas.
-- Re-executar este arquivo é sempre seguro.
-- ============================================================================


-- ============================================================================
-- 12 · CORREÇÃO DE ISOLAMENTO — visão do cliente por (oficina, telefone)
-- ----------------------------------------------------------------------------
-- Falha encontrada e provada em Postgres real: o "arm do cliente" das policies
-- (e as 3 RPCs legadas do cliente) casavam a OS/veículo só por telefone_norm.
-- Como QUALQUER oficina pode cadastrar um cliente com QUALQUER telefone e emitir
-- o convite dele, um login malicioso ligado a esse telefone via a oficina B
-- passava a LER (e aprovar/chatear) as OS do mesmo telefone na oficina A.
-- Correção: casar por PAR (oficina_id, telefone_norm). O cliente legítimo, que
-- ativou convites nas duas oficinas, tem as duas chaves e continua vendo ambas;
-- o invasor tem só a chave da oficina que o cadastrou. security definer p/ não
-- recursar no RLS de clientes (mesmo padrão de meus_telefones()).
-- ============================================================================
create or replace function public.minhas_chaves()
returns table (oficina_id uuid, telefone_norm text)
language sql stable security definer set search_path = public, pg_temp
as $MC$
  select oficina_id, telefone_norm from public.clientes where auth_user = auth.uid();
$MC$;

drop policy if exists ordens_select on public.ordens;
create policy ordens_select on public.ordens
  for select to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina())
         or (oficina_id, telefone_norm) in (select oficina_id, telefone_norm from public.minhas_chaves()));

drop policy if exists veiculos_select on public.veiculos;
create policy veiculos_select on public.veiculos
  for select to authenticated
  using (public.is_lex_admin()
         or (public.is_staff() and oficina_id = public.minha_oficina())
         or (oficina_id, telefone_norm) in (select oficina_id, telefone_norm from public.minhas_chaves()));

-- RPCs legadas do cliente reescritas: dono da OS agora é o PAR (oficina, telefone)
create or replace function public.aprovar_orcamento(p_numero int, p_decisoes jsonb, p_aceite jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_os        public.ordens%rowtype;
  v_itens     jsonb;
  v_dec       jsonb;
  v_id        text;
  v_apr       text;
  v_nivel     text;
  v_item      jsonb;
  v_achou     boolean;
  v_aprovados int;
  v_total     int;
  v_nome      text;
  v_evento    jsonb;
begin
  -- dono da OS (mesma mensagem para "não existe" e "não é sua": não vaza nada)
  select * into v_os from public.ordens where numero = p_numero for update;
  if not found then
    raise exception 'OS não encontrada ou acesso negado';
  end if;
  if v_os.telefone_norm is null
     or (v_os.oficina_id, v_os.telefone_norm) not in
        (select oficina_id, telefone_norm from public.minhas_chaves()) then
    raise exception 'OS não encontrada ou acesso negado';
  end if;
  -- status exigido
  if v_os.status <> 'aprovacao' then
    raise exception 'A OS % não está aguardando aprovação (status atual: %)', p_numero, v_os.status;
  end if;
  -- shape das decisões e do aceite
  if p_decisoes is null or jsonb_typeof(p_decisoes) <> 'array' then
    raise exception 'Decisões inválidas: envie um array de {id, aprovacao, nivelEscolhido}';
  end if;
  if jsonb_array_length(p_decisoes) = 0 then
    raise exception 'Decisões inválidas: o array está vazio';
  end if;
  if jsonb_array_length(p_decisoes) > 200 then
    raise exception 'Decisões inválidas: máximo de 200 itens por aprovação';
  end if;
  if p_aceite is null or jsonb_typeof(p_aceite) <> 'object' then
    raise exception 'Aceite inválido: envie um objeto com os dados do aceite';
  end if;
  if length(p_aceite::text) > 8000 then
    raise exception 'Aceite excede o tamanho máximo';
  end if;

  v_itens := coalesce(v_os.itens, '[]'::jsonb);
  if jsonb_typeof(v_itens) <> 'array' then
    raise exception 'Itens da OS % inválidos', p_numero;
  end if;

  -- aplica cada decisão no item correspondente (por id)
  for v_dec in select value from jsonb_array_elements(p_decisoes) loop
    if jsonb_typeof(v_dec) <> 'object' then
      raise exception 'Decisão inválida: cada decisão deve ser um objeto {id, aprovacao, nivelEscolhido}';
    end if;
    v_id    := v_dec ->> 'id';
    v_apr   := v_dec ->> 'aprovacao';
    v_nivel := v_dec ->> 'nivelEscolhido';
    if v_id is null or v_id = '' then
      raise exception 'Decisão sem id de item';
    end if;
    if v_apr is null or v_apr not in ('aprovado', 'recusado') then
      raise exception 'Aprovação inválida para o item %: use aprovado ou recusado', v_id;
    end if;
    if v_apr = 'aprovado' and v_nivel is null then
      raise exception 'Item % aprovado sem nível de peça: use original, oem ou aftermarket', v_id;
    end if;
    if v_nivel is not null and v_nivel not in ('original', 'oem', 'aftermarket') then
      raise exception 'Nível inválido para o item %: use original, oem ou aftermarket', v_id;
    end if;

    v_achou := false;
    for i in 0 .. jsonb_array_length(v_itens) - 1 loop
      if (v_itens -> i ->> 'id') = v_id then
        if coalesce(v_itens -> i ->> 'severidade', '') = 'ok' then
          raise exception 'O item % não é orçável (severidade ok)', v_id;
        end if;
        v_item := v_itens -> i;
        v_item := jsonb_set(v_item, '{aprovacao}', to_jsonb(v_apr));
        if v_nivel is not null then
          v_item := jsonb_set(v_item, '{nivelEscolhido}', to_jsonb(v_nivel));
        end if;
        v_itens := jsonb_set(v_itens, array[i::text], v_item);
        v_achou := true;
        exit;
      end if;
    end loop;
    if not v_achou then
      raise exception 'Item % não encontrado na OS %', v_id, p_numero;
    end if;
  end loop;

  -- totais pós-decisão (itens "ok" ficam fora do orçamento)
  select
    count(*) filter (where coalesce(e.value ->> 'severidade', '') <> 'ok'
                       and e.value ->> 'aprovacao' = 'aprovado'),
    count(*) filter (where coalesce(e.value ->> 'severidade', '') <> 'ok')
    into v_aprovados, v_total
    from jsonb_array_elements(v_itens) e;

  select nome into v_nome from public.clientes where auth_user = auth.uid() and oficina_id = v_os.oficina_id limit 1;
  v_nome := coalesce(v_nome, v_os.cliente, 'Cliente');

  v_evento := jsonb_build_object(
    'ts',     now(),
    'tipo',   'aceite',
    'titulo', case when v_aprovados > 0 then 'Orçamento aprovado' else 'Orçamento recusado' end,
    'desc',   format('Cliente aprovou %s de %s itens', v_aprovados, v_total),
    'ator',   v_nome
  );

  update public.ordens
     set itens       = v_itens,
         aceite      = p_aceite,
         aprovado_em = now(),
         eventos     = eventos || jsonb_build_array(v_evento),
         status      = case when v_aprovados > 0 then 'execucao' else status end
   where numero = p_numero
  returning * into v_os;

  return to_jsonb(v_os);
end;
$$;

create or replace function public.chat_cliente(p_numero int, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_os     public.ordens%rowtype;
  v_nome   text;
  v_msg    jsonb;
  v_evento jsonb;
begin
  if p_texto is null or btrim(p_texto) = '' then
    raise exception 'Mensagem vazia';
  end if;
  if char_length(p_texto) > 500 then
    raise exception 'Mensagem excede 500 caracteres';
  end if;
  select * into v_os from public.ordens where numero = p_numero for update;
  if not found then
    raise exception 'OS não encontrada ou acesso negado';
  end if;
  if v_os.telefone_norm is null
     or (v_os.oficina_id, v_os.telefone_norm) not in
        (select oficina_id, telefone_norm from public.minhas_chaves()) then
    raise exception 'OS não encontrada ou acesso negado';
  end if;
  if jsonb_array_length(coalesce(v_os.chat, '[]'::jsonb)) >= 500 then
    raise exception 'Limite de mensagens desta OS atingido — fale com a oficina pelo WhatsApp';
  end if;

  select nome into v_nome from public.clientes where auth_user = auth.uid() and oficina_id = v_os.oficina_id limit 1;
  v_nome := coalesce(v_nome, v_os.cliente, 'Cliente');

  v_msg := jsonb_build_object('ts', now(), 'de', v_nome, 'texto', p_texto);
  v_evento := jsonb_build_object(
    'ts',     now(),
    'tipo',   'chat',
    'titulo', 'Mensagem de ' || v_nome,
    'desc',   left(p_texto, 80),
    'ator',   v_nome
  );

  update public.ordens
     set chat    = coalesce(chat, '[]'::jsonb) || jsonb_build_array(v_msg),
         eventos = eventos || jsonb_build_array(v_evento)
   where numero = p_numero
  returning * into v_os;

  return to_jsonb(v_os);
end;
$$;

create or replace function public.avaliar_nps(p_numero int, p_nota int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_os     public.ordens%rowtype;
  v_nome   text;
  v_evento jsonb;
begin
  if p_nota is null or p_nota < 0 or p_nota > 10 then
    raise exception 'Nota NPS inválida: use um inteiro de 0 a 10';
  end if;
  select * into v_os from public.ordens where numero = p_numero for update;
  if not found then
    raise exception 'OS não encontrada ou acesso negado';
  end if;
  if v_os.telefone_norm is null
     or (v_os.oficina_id, v_os.telefone_norm) not in
        (select oficina_id, telefone_norm from public.minhas_chaves()) then
    raise exception 'OS não encontrada ou acesso negado';
  end if;
  if v_os.status <> 'entregue' then
    raise exception 'A OS % ainda não foi entregue', p_numero;
  end if;
  if v_os.nps is not null then
    raise exception 'A OS % já foi avaliada', p_numero;
  end if;

  select nome into v_nome from public.clientes where auth_user = auth.uid() and oficina_id = v_os.oficina_id limit 1;
  v_nome := coalesce(v_nome, v_os.cliente, 'Cliente');

  v_evento := jsonb_build_object(
    'ts',     now(),
    'tipo',   'nps',
    'titulo', 'Avaliação NPS',
    'desc',   format('Nota %s/10', p_nota),
    'ator',   v_nome
  );

  update public.ordens
     set nps     = p_nota,
         eventos = eventos || jsonb_build_array(v_evento)
   where numero = p_numero
  returning * into v_os;

  return to_jsonb(v_os);
end;
$$;

revoke all on function public.minhas_chaves() from public, anon;
grant execute on function public.minhas_chaves() to authenticated;
-- (as 3 RPCs mantêm os grants já concedidos no schema.sql; create or replace preserva ACL)
