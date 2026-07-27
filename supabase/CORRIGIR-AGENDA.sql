-- ============================================================
-- LexOS · CORREÇÃO + CONFIGURAÇÃO — destino dos agendamentos do site
-- ------------------------------------------------------------
-- SINTOMA 1: o cliente agenda no site, a linha É criada em
--   public.agendamentos, mas a oficina não vê nada na agenda.
-- SINTOMA 2: o agendamento chega na oficina ERRADA.
--
-- CAUSA: agendar_publico() escolhia a oficina "no chute" — a primeira
--   ATIVA por data de criação. Se esse registro for um cadastro órfão
--   (sem ninguém em public.staff), o agendamento cai numa oficina que
--   ninguém opera e a RLS esconde a linha de todos.
--
-- SOLUÇÃO: passa a existir uma CONFIGURAÇÃO EXPLÍCITA —
--   oficinas.recebe_agendamentos. Você marca no Central Admin qual
--   oficina recebe os agendamentos do site (botão "📅 recebe") e
--   acabou o chute.
--
-- Ordem de decisão do destino:
--   1) subdomínio, quando o site informar (multi-tenant futuro);
--   2) a oficina marcada com recebe_agendamentos = true;   ← a config
--   3) a primeira ativa QUE TENHA EQUIPE (fallback seguro);
--   4) a primeira ativa (instalação nova, ninguém cadastrado ainda).
--
-- Idempotente: pode rodar quantas vezes quiser.
-- Como rodar: Supabase → SQL Editor → cole tudo → Run.
-- ============================================================

-- 1 ·  Configuração: qual oficina recebe os agendamentos do site --------
alter table public.oficinas
  add column if not exists recebe_agendamentos boolean not null default false;

comment on column public.oficinas.recebe_agendamentos is
  'true na ÚNICA oficina que recebe os agendamentos do site (marcada no Central Admin).';

-- só uma oficina pode estar marcada por vez
create unique index if not exists oficinas_recebe_agendamentos_unica
  on public.oficinas ((true)) where recebe_agendamentos;

-- 2 ·  Resolução do destino (config → equipe → primeira ativa) ----------
create or replace function public.agendar_publico(p_dados jsonb, p_oficina text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ofi   uuid;
  v_id    uuid;
  v_proto text;
  v_nome  text;
  v_data  date;
begin
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    return jsonb_build_object('ok', false, 'erro', 'Dados inválidos');
  end if;
  if length(p_dados::text) > 4000 then
    return jsonb_build_object('ok', false, 'erro', 'Dados muito grandes');
  end if;
  v_nome := nullif(btrim(coalesce(p_dados ->> 'nome', '')), '');
  if v_nome is null then
    return jsonb_build_object('ok', false, 'erro', 'Informe o nome');
  end if;

  -- (1) por subdomínio, se o site informar
  if p_oficina is not null and btrim(p_oficina) <> '' then
    select id into v_ofi from public.oficinas where lower(subdominio) = lower(btrim(p_oficina)) limit 1;
  end if;
  -- (2) a oficina CONFIGURADA no Central Admin
  if v_ofi is null then
    select id into v_ofi from public.oficinas
     where recebe_agendamentos and status = 'ativa' limit 1;
  end if;
  -- (3) fallback: primeira ativa COM EQUIPE (alguém precisa poder atender)
  if v_ofi is null then
    select o.id into v_ofi from public.oficinas o
     where o.status = 'ativa'
       and exists (select 1 from public.staff s where s.oficina_id = o.id)
     order by o.criado_em asc limit 1;
  end if;
  -- (4) instalação nova: primeira ativa
  if v_ofi is null then
    select id into v_ofi from public.oficinas where status = 'ativa' order by criado_em asc limit 1;
  end if;
  if v_ofi is null then
    return jsonb_build_object('ok', false, 'erro', 'Nenhuma oficina disponível para agendamento');
  end if;

  v_data := case when coalesce(p_dados ->> 'data', '') ~ '^\d{4}-\d{2}-\d{2}$'
                 then (p_dados ->> 'data')::date else null end;
  v_proto := coalesce(nullif(btrim(coalesce(p_dados ->> 'protocolo', '')), ''),
                      'AG-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6)));

  insert into public.agendamentos
    (oficina_id, protocolo, nome, telefone, telefone_norm, veiculo, placa, servico, servico_nome, data, hora, obs, origem)
  values (
    v_ofi, v_proto, v_nome,
    nullif(p_dados ->> 'telefone', ''),
    nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), ''),
    nullif(p_dados ->> 'veiculo', ''),
    nullif(upper(p_dados ->> 'placa'), ''),
    nullif(p_dados ->> 'servico', ''),
    nullif(p_dados ->> 'servico_nome', ''),
    v_data,
    nullif(p_dados ->> 'hora', ''),
    left(nullif(p_dados ->> 'obs', ''), 500),
    'site'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'protocolo', v_proto, 'id', v_id);
exception when others then
  return jsonb_build_object('ok', false, 'erro', 'Não foi possível agendar agora');
end;
$$;

revoke all on function public.agendar_publico(jsonb, text) from public;
grant execute on function public.agendar_publico(jsonb, text) to anon, authenticated;

-- 3 ·  Marca um destino inicial se nenhum estiver configurado -----------
--      (a primeira ativa COM equipe — você pode trocar depois no admin)
update public.oficinas set recebe_agendamentos = true
 where id = (
   select o.id from public.oficinas o
    where o.status = 'ativa'
      and exists (select 1 from public.staff s where s.oficina_id = o.id)
    order by o.criado_em asc limit 1)
   and not exists (select 1 from public.oficinas where recebe_agendamentos);

-- 4 ·  Resgata agendamentos presos em oficina sem equipe ----------------
--      (move para o destino configurado — nada é apagado)
update public.agendamentos a
   set oficina_id = (select id from public.oficinas where recebe_agendamentos limit 1)
 where exists (select 1 from public.oficinas where recebe_agendamentos)
   and a.oficina_id is distinct from (select id from public.oficinas where recebe_agendamentos limit 1)
   and not exists (select 1 from public.staff s where s.oficina_id = a.oficina_id);

-- 5 ·  Confere ----------------------------------------------------------
select o.nome as oficina,
       o.recebe_agendamentos as recebe_do_site,
       (select count(*) from public.staff s where s.oficina_id = o.id) as equipe,
       (select count(*) from public.agendamentos a where a.oficina_id = o.id) as agendamentos
  from public.oficinas o
 order by o.recebe_agendamentos desc, o.criado_em;

-- ============================================================
-- 6 ·  EXCLUIR OFICINA x AUDITORIA IMUTÁVEL
-- ------------------------------------------------------------
-- eventos_log é append-only (trg_eventos_log_imutavel). Como
-- eventos_log.oficina_id tem FK "on delete cascade", excluir uma oficina
-- disparava o gatilho e a exclusão inteira era cancelada:
--   "eventos_log é imutável (auditoria append-only): DELETE bloqueado"
--
-- O log continua imutável para TODA operação normal. A única exceção é a
-- purga deliberada de uma oficina pela RPC excluir_oficina(), que valida
-- is_lex_admin() e liga a flag apenas dentro daquela transação.
-- ============================================================
create or replace function public.bloquear_mutacao_log()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.purga_oficina', true), '') = 'on' then
    return null;   -- gatilho de STATEMENT: não cancela, apenas deixa seguir
  end if;
  raise exception 'eventos_log é imutável (auditoria append-only): % bloqueado', tg_op;
end;
$$;

create or replace function public.excluir_oficina(p_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_nome text; v_n integer;
begin
  if not public.is_lex_admin() then
    raise exception 'Apenas administradores LexOS podem excluir oficinas';
  end if;
  if p_id is null then return jsonb_build_object('ok', false, 'erro', 'Informe a oficina'); end if;
  select nome into v_nome from public.oficinas where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'erro', 'Oficina não encontrada'); end if;
  perform set_config('app.purga_oficina', 'on', true);   -- só nesta transação
  delete from public.oficinas where id = p_id;
  get diagnostics v_n = row_count;
  perform set_config('app.purga_oficina', 'off', true);
  return jsonb_build_object('ok', v_n > 0, 'nome', v_nome, 'excluidas', v_n);
end;
$$;
revoke all on function public.excluir_oficina(uuid) from public;
grant execute on function public.excluir_oficina(uuid) to authenticated;
