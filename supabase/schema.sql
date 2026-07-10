-- ============================================================================
-- EUROVIX · WERK OS — Schema da nuvem (Supabase / Postgres)
-- Espelha o modelo local de assets/js/werk-data.js (Fase 1: itens, chat e
-- eventos ficam embutidos em jsonb dentro de ordens — paridade 1:1 com a
-- interface WERK; normalização é Fase 2).
-- 100% idempotente: pode ser colado e re-executado no SQL Editor sem erro.
-- Produção nasce VAZIA — nenhum dado de demonstração é criado aqui.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0 · Extensões
-- pgcrypto: gen_random_uuid() para ids e aleatoriedade dos tokens de convite.
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1 · Tabelas
-- ----------------------------------------------------------------------------

-- clientes: donos de veículo com acesso ao app (convite → telefone + senha).
-- telefone_norm = telefone só dígitos (normTel). auth_user liga ao Supabase
-- Auth quando o convite é ativado (e-mail sintético c<telefone_norm>@...).
create table if not exists public.clientes (
  id            uuid primary key default gen_random_uuid(),
  telefone_norm text unique not null,
  telefone      text not null,
  nome          text not null,
  desde         int,
  convite       text unique not null,
  ativado_em    timestamptz,
  auth_user     uuid unique references auth.users (id) on delete set null,
  criado_em     timestamptz default now()
);

-- veiculos: frota conhecida da oficina. dados = campos do decodeVIN
-- (modelo, motor, cambio, familia, anoModelo, planta, sa) + extras da UI
-- (ex.: cor). cofre = lista de documentos do "cofre" do veículo.
create table if not exists public.veiculos (
  vin           text primary key,
  dados         jsonb not null default '{}'::jsonb,
  placa         text,
  placa_norm    text,
  km            int default 0,
  cliente       text,
  telefone_norm text,
  cofre         jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- ordens: a OS completa. eventos é append-only (triggers abaixo) e versao
-- sobe +1 a cada UPDATE — guarda otimista usada pelo adaptador de nuvem.
create table if not exists public.ordens (
  numero        int primary key,
  criada        timestamptz not null default now(),
  status        text not null check (status in
                  ('fila','diagnostico','aprovacao','peca','execucao',
                   'qc','lavagem','pronto','entregue')),
  vin           text,
  veiculo       text,
  placa         text,
  cliente       text,
  telefone_norm text,
  sintoma       text,
  tecnico       text,
  consultor     text,
  checkin       jsonb,
  dtcs          jsonb not null default '[]'::jsonb,
  itens         jsonb not null default '[]'::jsonb,
  qc            jsonb,
  pagamento     jsonb,
  nf            jsonb,
  nps           int check (nps between 0 and 10),
  aceite        jsonb,
  aprovado_em   timestamptz,
  chat          jsonb not null default '[]'::jsonb,
  eventos       jsonb not null default '[]'::jsonb,
  versao        int not null default 0,
  atualizado_em timestamptz not null default now()
);

-- eventos_log: auditoria IMUTÁVEL — cópia linha a linha de cada evento novo
-- empurrado em ordens.eventos (a chave jsonb "desc" vira a coluna "descr").
create table if not exists public.eventos_log (
  id         bigserial primary key,
  os_numero  int not null,
  ts         timestamptz not null,
  tipo       text,
  titulo     text,
  descr      text,
  ator       text,
  gravado_em timestamptz default now()
);

-- config: linha única (id = 1) com a configuração da oficina
-- (getConfig/saveConfig — valorHora, margens, oficina, técnicos etc.).
create table if not exists public.config (
  id            int primary key default 1 check (id = 1),
  data          jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz default now()
);

-- staff: quem opera o WERK OS. Escrita só via SQL Editor/service role (runbook).
create table if not exists public.staff (
  auth_user uuid primary key references auth.users (id) on delete cascade,
  nome      text not null,
  papel     text not null default 'consultor',
  criado_em timestamptz default now()
);

-- Índices de apoio: as policies e a hidratação filtram por telefone_norm e
-- ordenam por criada desc; o log é consultado por OS. Sem efeito funcional.
create index if not exists idx_ordens_telefone_norm   on public.ordens (telefone_norm);
create index if not exists idx_ordens_criada          on public.ordens (criada desc);
create index if not exists idx_veiculos_telefone_norm on public.veiculos (telefone_norm);
create index if not exists idx_eventos_log_os_numero  on public.eventos_log (os_numero);

-- ----------------------------------------------------------------------------
-- 2 · Numeração de OS
-- Produção começa em 2000 — não colide com os números 12xx do modo demo local.
-- ----------------------------------------------------------------------------
create sequence if not exists public.os_numero_seq start with 2000;

-- ----------------------------------------------------------------------------
-- 3 · Helpers de segurança
-- security definer: rodam como dono do schema (enxergam as tabelas sem RLS),
-- por isso podem ser usados dentro das próprias policies sem recursão.
-- ----------------------------------------------------------------------------

-- is_staff(): o usuário autenticado atual pertence à equipe?
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.staff where auth_user = auth.uid());
$$;

-- meus_telefones(): telefones normalizados dos registros de cliente vinculados
-- ao usuário autenticado atual — define o "dono" em veiculos/ordens.
create or replace function public.meus_telefones()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select telefone_norm from public.clientes where auth_user = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 4 · Triggers
-- ----------------------------------------------------------------------------

-- set_atualizado_em(): carimbo automático em todo UPDATE (ordens/veiculos/config).
create or replace function public.set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- ordens_versao_eventos(): BEFORE UPDATE de ordens —
--   · versao = OLD.versao + 1 (guarda otimista do adaptador);
--   · ordens.eventos é append-only: o array NUNCA pode encolher.
create or replace function public.ordens_versao_eventos()
returns trigger
language plpgsql
as $$
declare
  v_antes int;
begin
  if jsonb_typeof(new.eventos) is distinct from 'array' then
    raise exception 'ordens.eventos deve ser um array jsonb (OS %)', new.numero;
  end if;
  v_antes := case when jsonb_typeof(old.eventos) = 'array'
                  then jsonb_array_length(old.eventos) else 0 end;
  if jsonb_array_length(new.eventos) < v_antes then
    raise exception 'ordens.eventos é append-only: o histórico da OS % não pode encolher (de % para % eventos)',
      old.numero, v_antes, jsonb_array_length(new.eventos);
  end if;
  -- append-only de CONTEÚDO: eventos já gravados não podem ser reescritos in-place
  for i in 0 .. v_antes - 1 loop
    if (new.eventos -> i) is distinct from (old.eventos -> i) then
      raise exception 'ordens.eventos é append-only: o evento % da OS % não pode ser alterado', i, old.numero;
    end if;
  end loop;
  new.versao := old.versao + 1;
  return new;
end;
$$;

-- log_eventos_novos(): AFTER INSERT OR UPDATE de ordens — copia para
-- eventos_log SOMENTE os eventos novos (delta de comprimento do array).
-- security definer: o log não tem policy de INSERT, então o trigger precisa
-- gravar como dono mesmo quando quem escreve na OS é o staff via RLS.
-- ts inválido no evento não aborta a escrita: cai para now().
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
      insert into public.eventos_log (os_numero, ts, tipo, titulo, descr, ator)
      values (
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

-- bloquear_mutacao_log(): eventos_log é imutável — UPDATE/DELETE/TRUNCATE são
-- rejeitados para qualquer papel (inclusive no SQL Editor).
create or replace function public.bloquear_mutacao_log()
returns trigger
language plpgsql
as $$
begin
  raise exception 'eventos_log é imutável (auditoria append-only): % bloqueado', tg_op;
end;
$$;

-- Vínculo dos triggers (drop + create = idempotente).
drop trigger if exists trg_ordens_atualizado_em on public.ordens;
create trigger trg_ordens_atualizado_em
  before update on public.ordens
  for each row execute function public.set_atualizado_em();

drop trigger if exists trg_veiculos_atualizado_em on public.veiculos;
create trigger trg_veiculos_atualizado_em
  before update on public.veiculos
  for each row execute function public.set_atualizado_em();

drop trigger if exists trg_config_atualizado_em on public.config;
create trigger trg_config_atualizado_em
  before update on public.config
  for each row execute function public.set_atualizado_em();

drop trigger if exists trg_ordens_versao_eventos on public.ordens;
create trigger trg_ordens_versao_eventos
  before update on public.ordens
  for each row execute function public.ordens_versao_eventos();

drop trigger if exists trg_ordens_eventos_log on public.ordens;
create trigger trg_ordens_eventos_log
  after insert or update on public.ordens
  for each row execute function public.log_eventos_novos();

drop trigger if exists trg_eventos_log_imutavel on public.eventos_log;
create trigger trg_eventos_log_imutavel
  before update or delete or truncate on public.eventos_log
  for each statement execute function public.bloquear_mutacao_log();

-- ----------------------------------------------------------------------------
-- 5 · RLS — habilitado em TODAS as tabelas
-- Policies escopadas em "to authenticated": anon não tem policy alguma
-- (SELECT devolve vazio, escrita é negada). O cliente NUNCA escreve direto —
-- toda escrita de cliente passa pelas RPCs security definer da seção 6.
-- ----------------------------------------------------------------------------

alter table public.clientes    enable row level security;
alter table public.veiculos    enable row level security;
alter table public.ordens      enable row level security;
alter table public.eventos_log enable row level security;
alter table public.config      enable row level security;
alter table public.staff       enable row level security;

-- clientes: staff vê/escreve tudo; cliente só SE ENXERGA (auth_user = uid).
drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated
  using (public.is_staff() or auth_user = auth.uid());

drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists clientes_update on public.clientes;
create policy clientes_update on public.clientes
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists clientes_delete on public.clientes;
create policy clientes_delete on public.clientes
  for delete to authenticated
  using (public.is_staff());

-- veiculos: staff tudo; cliente vê os veículos dos SEUS telefones.
drop policy if exists veiculos_select on public.veiculos;
create policy veiculos_select on public.veiculos
  for select to authenticated
  using (public.is_staff() or telefone_norm in (select public.meus_telefones()));

drop policy if exists veiculos_insert on public.veiculos;
create policy veiculos_insert on public.veiculos
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists veiculos_update on public.veiculos;
create policy veiculos_update on public.veiculos
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists veiculos_delete on public.veiculos;
create policy veiculos_delete on public.veiculos
  for delete to authenticated
  using (public.is_staff());

-- ordens: staff tudo; cliente vê as OS dos SEUS telefones (escrita só por RPC).
drop policy if exists ordens_select on public.ordens;
create policy ordens_select on public.ordens
  for select to authenticated
  using (public.is_staff() or telefone_norm in (select public.meus_telefones()));

drop policy if exists ordens_insert on public.ordens;
create policy ordens_insert on public.ordens
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists ordens_update on public.ordens;
create policy ordens_update on public.ordens
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists ordens_delete on public.ordens;
create policy ordens_delete on public.ordens
  for delete to authenticated
  using (public.is_staff());

-- config: só staff (o app do cliente não precisa — preços já congelados nos itens).
drop policy if exists config_select on public.config;
create policy config_select on public.config
  for select to authenticated
  using (public.is_staff());

drop policy if exists config_insert on public.config;
create policy config_insert on public.config
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists config_update on public.config;
create policy config_update on public.config
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- eventos_log: staff só lê; NENHUMA policy de escrita (grava só o trigger definer).
drop policy if exists eventos_log_select on public.eventos_log;
create policy eventos_log_select on public.eventos_log
  for select to authenticated
  using (public.is_staff());

-- staff: staff só lê; escrita apenas via SQL Editor/service role (runbook).
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff
  for select to authenticated
  using (public.is_staff());

-- ----------------------------------------------------------------------------
-- 6 · RPCs (security definer + validação server-side)
-- São a ÚNICA via de escrita do cliente. Staff usa nova_os_numero/checkin_os.
-- ----------------------------------------------------------------------------

-- nova_os_numero(): próximo número de OS. Staff-only (RAISE para quem não é).
create or replace function public.nova_os_numero()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_staff() then
    raise exception 'Apenas staff pode gerar número de OS';
  end if;
  return nextval('public.os_numero_seq')::int;
end;
$$;

-- convite_info(p_token): dados públicos do convite para a tela de cadastro.
-- Callable por anon; sem o token exato não vaza nada (retorna null).
-- Shape: {nome, telefone, veiculos: [{modelo, placa, cor}], ativo}.
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
-- Valida token existente e ainda não usado; idempotente para o MESMO uid.
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
  if exists (select 1 from public.clientes where auth_user = v_uid and id <> v_cli.id) then
    raise exception 'Esta conta já está vinculada a outro cliente';
  end if;
  update public.clientes
     set auth_user = v_uid, ativado_em = now()
   where id = v_cli.id
  returning * into v_cli;
  return to_jsonb(v_cli);
end;
$$;

-- aprovar_orcamento(p_numero, p_decisoes, p_aceite): decisão do cliente sobre
-- o orçamento. Só o DONO da OS, só com status='aprovacao'.
-- p_decisoes = array de {id, aprovacao: aprovado|recusado,
--                        nivelEscolhido: original|oem|aftermarket}.
-- Grava aceite + aprovado_em, empurra evento e move para 'execucao'
-- se ao menos 1 item foi aprovado. Retorna a OS atualizada.
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
     or v_os.telefone_norm not in (select public.meus_telefones()) then
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

  select nome into v_nome from public.clientes where auth_user = auth.uid() limit 1;
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

-- chat_cliente(p_numero, p_texto): mensagem do cliente no chat da OS.
-- Só o dono; texto obrigatório com no máximo 500 caracteres.
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
     or v_os.telefone_norm not in (select public.meus_telefones()) then
    raise exception 'OS não encontrada ou acesso negado';
  end if;
  if jsonb_array_length(coalesce(v_os.chat, '[]'::jsonb)) >= 500 then
    raise exception 'Limite de mensagens desta OS atingido — fale com a oficina pelo WhatsApp';
  end if;

  select nome into v_nome from public.clientes where auth_user = auth.uid() limit 1;
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

-- avaliar_nps(p_numero, p_nota): nota NPS do cliente (0 a 10).
-- Só o dono, só com OS entregue e ainda sem avaliação.
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
     or v_os.telefone_norm not in (select public.meus_telefones()) then
    raise exception 'OS não encontrada ou acesso negado';
  end if;
  if v_os.status <> 'entregue' then
    raise exception 'A OS % ainda não foi entregue', p_numero;
  end if;
  if v_os.nps is not null then
    raise exception 'A OS % já foi avaliada', p_numero;
  end if;

  select nome into v_nome from public.clientes where auth_user = auth.uid() limit 1;
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

-- checkin_os(p_os, p_veiculo, p_cliente): check-in completo em transação única
-- (staff-only): número da sequence + upsert do veículo + upsert do cliente
-- (preservando convite/auth_user/ativado_em) + insert da ordem em 'fila' com o
-- evento de abertura. p_veiculo/p_cliente podem ser null.
-- Retorna {numero, convite} (convite = null quando não há cliente com telefone).
create or replace function public.checkin_os(p_os jsonb, p_veiculo jsonb, p_cliente jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
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
  if p_os is null or jsonb_typeof(p_os) <> 'object' then
    raise exception 'Dados da OS inválidos';
  end if;

  v_numero := nextval('public.os_numero_seq')::int;

  -- veículo (opcional): upsert com merge — campos ausentes preservam o atual
  if p_veiculo is not null and jsonb_typeof(p_veiculo) = 'object' then
    v_vin := nullif(upper(btrim(coalesce(p_veiculo ->> 'vin', ''))), '');
    if v_vin is null then
      raise exception 'Veículo sem VIN';
    end if;
    insert into public.veiculos (vin, dados, placa, placa_norm, km, cliente, telefone_norm, cofre)
    values (
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
    on conflict (vin) do update set
      dados         = veiculos.dados || excluded.dados,
      placa         = case when jsonb_exists(p_veiculo, 'placa')   then excluded.placa      else veiculos.placa      end,
      placa_norm    = case when jsonb_exists(p_veiculo, 'placa')   then excluded.placa_norm else veiculos.placa_norm end,
      km            = case when jsonb_exists(p_veiculo, 'km')      then excluded.km         else veiculos.km         end,
      cliente       = case when jsonb_exists(p_veiculo, 'cliente') then excluded.cliente    else veiculos.cliente    end,
      telefone_norm = coalesce(excluded.telefone_norm, veiculos.telefone_norm),
      cofre         = case when jsonb_exists(p_veiculo, 'cofre')   then excluded.cofre      else veiculos.cofre      end;
  end if;

  -- cliente (opcional): upsert por telefone_norm preservando convite/auth/ativação
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
      insert into public.clientes (telefone_norm, telefone, nome, desde, convite)
      values (
        v_tel_cli,
        coalesce(nullif(p_cliente ->> 'telefone', ''), v_tel_cli),
        coalesce(nullif(p_cliente ->> 'nome', ''), 'Cliente EUROVIX'),
        coalesce(nullif(regexp_replace(coalesce(p_cliente ->> 'desde', ''), '\D', '', 'g'), '')::int, extract(year from now())::int),
        v_token
      )
      on conflict (telefone_norm) do update set
        nome     = case when coalesce(p_cliente ->> 'nome', '') <> ''
                        then excluded.nome else clientes.nome end,
        telefone = case when coalesce(p_cliente ->> 'telefone', '') <> ''
                        then excluded.telefone else clientes.telefone end
      returning convite into v_convite;
    end if;
  end if;

  -- ordem: nasce em 'fila' com o evento de abertura montado no servidor
  v_tel_os := nullif(regexp_replace(coalesce(p_os ->> 'telefone_norm', p_os ->> 'telefone', ''), '\D', '', 'g'), '');
  v_evento := jsonb_build_object(
    'ts',     now(),
    'tipo',   'abertura',
    'titulo', 'OS aberta',
    'desc',   'Check-in digital concluído',
    'ator',   coalesce(nullif(p_os ->> 'ator', ''), 'Recepção')
  );
  insert into public.ordens (numero, status, vin, veiculo, placa, cliente, telefone_norm,
                             sintoma, tecnico, consultor, checkin, eventos)
  values (
    v_numero,
    'fila',
    nullif(upper(btrim(coalesce(p_os ->> 'vin', ''))), ''),
    p_os ->> 'veiculo',
    coalesce(p_os ->> 'placa', ''),
    coalesce(nullif(p_os ->> 'cliente', ''), 'Cliente EUROVIX'),
    v_tel_os,
    coalesce(p_os ->> 'sintoma', ''),
    coalesce(p_os ->> 'tecnico', ''),
    coalesce(nullif(p_os ->> 'consultor', ''), 'Paulo Victor de Almeida'),
    case when jsonb_typeof(p_os -> 'checkin') = 'object' then p_os -> 'checkin' else null end,
    jsonb_build_array(v_evento)
  );

  return jsonb_build_object('numero', v_numero, 'convite', v_convite);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7 · GRANTs — nega tudo primeiro, depois concede o mínimo
-- O Supabase concede EXECUTE a anon/authenticated por default privileges,
-- então o REVOKE explícito é obrigatório antes dos GRANTs.
-- ----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select, insert, update on table public.clientes to authenticated;
grant select, insert, update on table public.veiculos to authenticated;
grant select, insert, update on table public.ordens   to authenticated;
grant select, insert, update on table public.config   to authenticated;
grant select on table public.eventos_log              to authenticated;
grant select on table public.staff                    to authenticated;

revoke all on function public.is_staff()                           from public, anon;
revoke all on function public.meus_telefones()                     from public, anon;
revoke all on function public.nova_os_numero()                     from public, anon;
revoke all on function public.convite_info(text)                   from public, anon;
revoke all on function public.ativar_convite(text)                 from public, anon;
revoke all on function public.aprovar_orcamento(int, jsonb, jsonb) from public, anon;
revoke all on function public.chat_cliente(int, text)              from public, anon;
revoke all on function public.avaliar_nps(int, int)                from public, anon;
revoke all on function public.checkin_os(jsonb, jsonb, jsonb)      from public, anon;
revoke all on sequence public.os_numero_seq                        from public, anon, authenticated;

-- convite_info é a única RPC pública (tela de cadastro, antes do login)
grant execute on function public.convite_info(text) to anon, authenticated;

-- RPCs do cliente logado
grant execute on function public.ativar_convite(text)                 to authenticated;
grant execute on function public.aprovar_orcamento(int, jsonb, jsonb) to authenticated;
grant execute on function public.chat_cliente(int, text)              to authenticated;
grant execute on function public.avaliar_nps(int, int)                to authenticated;

-- RPCs de staff: GRANT para authenticated, mas a própria função valida
-- is_staff() e dá RAISE para quem não for da equipe.
grant execute on function public.nova_os_numero()                to authenticated;
grant execute on function public.checkin_os(jsonb, jsonb, jsonb) to authenticated;

-- helpers usados pelas policies (avaliados com o papel do chamador)
grant execute on function public.is_staff()       to authenticated;
grant execute on function public.meus_telefones() to authenticated;

-- ----------------------------------------------------------------------------
-- 8 · Realtime — tabelas que o adaptador assina via postgres_changes
-- Guardado contra re-execução (duplicate_object) e contra ambientes sem a
-- publication supabase_realtime (undefined_object).
-- Nota: DELETEs em postgres_changes transmitem apenas a PK do registro antigo
-- (comportamento do Postgres/Supabase) — nenhuma tela apaga linhas hoje, e as
-- PKs (numero/vin/uuid) não carregam dado sensível. `config` fica FORA da
-- publication de propósito: é staff-only e o adaptador a busca na hidratação.
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.ordens;
  exception when duplicate_object or undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.veiculos;
  exception when duplicate_object or undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.clientes;
  exception when duplicate_object or undefined_object then null;
  end;
  begin -- idempotência: remove config da publication se uma versão anterior a adicionou
    alter publication supabase_realtime drop table public.config;
  exception when undefined_object or undefined_table then null;
  end;
end;
$$;

-- ============================================================================
-- 9 · EQUIPE — gestão de colaboradores pelo próprio painel (view 👥 Equipe)
-- Sem service_role no navegador: o painel cria o LOGIN via cadastro público
-- (supabase-js, cliente paralelo) e estas RPCs cuidam do vínculo e do papel na
-- tabela staff, com as regras aplicadas AQUI, no servidor.
-- Papéis: mecanico · consultor · gestor · admin
--   admin  → gerencia todo mundo
--   gestor → cria/edita/remove apenas mecânicos e consultores
--   demais → só visualizam a equipe
-- ============================================================================

-- staff_papel(): papel do usuário autenticado atual (null se não é da equipe)
create or replace function public.staff_papel()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select papel from public.staff where auth_user = auth.uid();
$$;

-- staff_listar(): equipe completa com o e-mail de login (join em auth.users —
-- por isso security definer). Qualquer membro da equipe pode ver.
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
     order by s.criado_em;
end;
$$;

-- staff_upsert(e-mail, nome, papel): cria OU edita um colaborador pelo e-mail
-- de login. O login precisa existir no auth — o painel cadastra antes de chamar.
create or replace function public.staff_upsert(p_email text, p_nome text, p_papel text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exec  text := public.staff_papel();
  v_uid   uuid;
  v_atual text;
begin
  if v_exec is null or v_exec not in ('gestor', 'admin') then
    raise exception 'Apenas gestor ou admin podem gerenciar a equipe';
  end if;
  if p_papel is null or p_papel not in ('mecanico', 'consultor', 'gestor', 'admin') then
    raise exception 'Papel inválido — use mecanico, consultor, gestor ou admin';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Informe o nome do colaborador';
  end if;

  select id into v_uid from auth.users
   where lower(email) = lower(trim(p_email))
   order by created_at limit 1;
  if v_uid is null then
    raise exception 'Nenhum login encontrado para % — o painel cria o login primeiro e chama de novo', trim(p_email);
  end if;

  select s.papel into v_atual from public.staff s where s.auth_user = v_uid;

  -- gestor não toca em gestores/admins (nem promove ninguém a esses papéis)
  if v_exec = 'gestor' and (p_papel in ('gestor', 'admin') or coalesce(v_atual, '') in ('gestor', 'admin')) then
    raise exception 'Somente um admin pode criar ou alterar gestores e admins';
  end if;
  -- nunca rebaixar o último admin (trancaria a gestão da equipe para sempre)
  if v_atual = 'admin' and p_papel <> 'admin'
     and (select count(*) from public.staff where papel = 'admin') = 1 then
    raise exception 'Este é o único admin — promova outra pessoa a admin antes de rebaixá-lo';
  end if;

  insert into public.staff (auth_user, nome, papel)
  values (v_uid, trim(p_nome), p_papel)
  on conflict (auth_user) do update set nome = excluded.nome, papel = excluded.papel;

  return jsonb_build_object('auth_user', v_uid, 'nome', trim(p_nome), 'papel', p_papel);
end;
$$;

-- staff_remover(uuid): tira a pessoa da equipe. O login continua existindo no
-- auth, mas sem linha em staff o painel fecha na hora (is_staff() = false).
create or replace function public.staff_remover(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exec text := public.staff_papel();
  v_alvo text;
begin
  if v_exec is null or v_exec not in ('gestor', 'admin') then
    raise exception 'Apenas gestor ou admin podem gerenciar a equipe';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'Você não pode remover a si mesmo da equipe';
  end if;
  select s.papel into v_alvo from public.staff s where s.auth_user = p_usuario;
  if v_alvo is null then
    raise exception 'Esta pessoa não está na equipe';
  end if;
  if v_exec = 'gestor' and v_alvo in ('gestor', 'admin') then
    raise exception 'Somente um admin pode remover gestores e admins';
  end if;
  if v_alvo = 'admin' and (select count(*) from public.staff where papel = 'admin') = 1 then
    raise exception 'Este é o único admin — promova outra pessoa a admin antes de removê-lo';
  end if;
  delete from public.staff where auth_user = p_usuario;
end;
$$;

-- Bootstrap: instalações feitas antes desta página (INSERT manual do runbook,
-- papel padrão 'consultor') ainda não têm NENHUM admin — promove os membros
-- atuais (hoje, o dono). Idempotente: havendo um admin, não faz nada.
update public.staff set papel = 'admin'
 where not exists (select 1 from public.staff where papel = 'admin');

-- permissões (mesmo padrão da seção 7: revoke primeiro, grant mínimo depois;
-- as próprias funções validam papel e dão RAISE para quem não pode)
revoke all on function public.staff_papel()                  from public, anon;
revoke all on function public.staff_listar()                 from public, anon;
revoke all on function public.staff_upsert(text, text, text) from public, anon;
revoke all on function public.staff_remover(uuid)            from public, anon;
grant execute on function public.staff_papel()                  to authenticated;
grant execute on function public.staff_listar()                 to authenticated;
grant execute on function public.staff_upsert(text, text, text) to authenticated;
grant execute on function public.staff_remover(uuid)            to authenticated;

-- ============================================================================
-- Fim — schema pronto. Produção nasce vazia; o PRIMEIRO staff é criado via
-- runbook (SETUP-NUVEM.md); os demais, pela view 👥 Equipe do próprio painel.
-- Re-executar este arquivo é sempre seguro.
-- ============================================================================
