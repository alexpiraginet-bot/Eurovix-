-- ============================================================================
-- EUROVIX · WERK OS — AGENDA (agendamentos do site → fila da oficina)
-- ----------------------------------------------------------------------------
-- Rode DEPOIS de schema.sql + MULTI-TENANT.sql. Idempotente.
-- Fluxo: o cliente agenda no SITE (anônimo) → agendar_publico() grava na fila
-- da oficina certa → a recepção vê no calendário/cronograma do WERK OS,
-- confirma e transforma em check-in/OS. Isolado por oficina (RLS).
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.agendamentos (
  id            uuid primary key default gen_random_uuid(),
  oficina_id    uuid not null references public.oficinas (id) on delete cascade,
  protocolo     text,
  nome          text not null,
  telefone      text,
  telefone_norm text,
  veiculo       text,          -- modelo informado
  placa         text,
  servico       text,          -- id do serviço
  servico_nome  text,          -- rótulo do serviço
  data          date,
  hora          text,
  obs           text,
  status        text not null default 'novo'
                  check (status in ('novo','confirmado','cancelado','convertido')),
  os_numero     int,           -- preenchido quando vira OS
  origem        text not null default 'site',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_agendamentos_oficina on public.agendamentos (oficina_id, data);
create index if not exists idx_agendamentos_status  on public.agendamentos (oficina_id, status);

-- atualizado_em automático (reusa a função da base)
drop trigger if exists trg_agendamentos_touch on public.agendamentos;
create trigger trg_agendamentos_touch before update on public.agendamentos
  for each row execute function public.set_atualizado_em();

-- RLS: staff vê/escreve os da SUA oficina; lex-admin tudo; anon NADA direto
-- (o site insere só pela RPC security definer abaixo).
alter table public.agendamentos enable row level security;
drop policy if exists agendamentos_all on public.agendamentos;
create policy agendamentos_all on public.agendamentos
  for all to authenticated
  using (public.is_lex_admin() or (public.is_staff() and oficina_id = public.minha_oficina()))
  with check (public.is_lex_admin() or (public.is_staff() and oficina_id = public.minha_oficina()));
grant select, insert, update on public.agendamentos to authenticated;

-- agendar_publico(p_dados, p_oficina): o SITE (cliente ANÔNIMO) cria um
-- agendamento. security definer: valida, resolve a oficina (por subdomínio ou a
-- primeira 'ativa' = piloto) e insere com status 'novo'. Não lê nem devolve dado
-- de ninguém — só confirma o protocolo. Anti-abuso mínimo (tamanho + nome).
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

  -- resolve a oficina: por subdomínio (se informado) ou a primeira ativa (piloto)
  if p_oficina is not null and btrim(p_oficina) <> '' then
    select id into v_ofi from public.oficinas where lower(subdominio) = lower(btrim(p_oficina)) limit 1;
  end if;
  if v_ofi is null then
    select id into v_ofi from public.oficinas where status = 'ativa' order by criado_em asc limit 1;
  end if;
  if v_ofi is null then
    return jsonb_build_object('ok', false, 'erro', 'Nenhuma oficina disponível para agendamento');
  end if;

  -- data só se vier no formato ISO (não derruba o insert por data ruim)
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

-- Realtime (guardado contra re-execução / ambiente sem a publication)
do $$
begin
  begin alter publication supabase_realtime add table public.agendamentos;
  exception when duplicate_object or undefined_object then null; end;
end;
$$;

-- ============================================================================
-- Conferência:
--   select public.agendar_publico('{"nome":"Teste","telefone":"27999998888","veiculo":"BMW X1","servico_nome":"Revisão","data":"2026-07-20","hora":"09:00"}'::jsonb);
--   -- (rode como anon/no site) → {"ok":true,"protocolo":"AG-XXXXXX",...}
--   select nome, servico_nome, data, hora, status from public.agendamentos order by criado_em desc;
-- ============================================================================
