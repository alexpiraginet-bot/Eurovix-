-- ============================================================
-- LexOS · CORREÇÃO — agendamentos do site não apareciam na agenda
-- ------------------------------------------------------------
-- SINTOMA: o cliente agenda no site, a linha É criada em
-- public.agendamentos, mas nenhuma oficina vê o agendamento.
--
-- CAUSA: agendar_publico() resolvia a oficina como "a primeira ATIVA
-- por data de criação". Se esse registro mais antigo não tiver NENHUM
-- membro em public.staff (cadastro órfão/legado), o agendamento cai
-- numa oficina que ninguém opera — e a RLS (que filtra pela oficina do
-- usuário) esconde a linha de todo mundo. A fila fica "vazia".
--
-- CORREÇÃO (2 partes, idempotente — pode rodar mais de uma vez):
--   1. a resolução passa a exigir oficina ATIVA **com equipe**;
--   2. os agendamentos já presos em oficinas sem equipe são movidos
--      para a oficina resolvida (nada é apagado).
--
-- Como rodar: Supabase → SQL Editor → cole tudo → Run.
-- ============================================================

-- 1 ·  Resolução da oficina agora exige EQUIPE ---------------------------
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

  -- por subdomínio (se o site informar) …
  if p_oficina is not null and btrim(p_oficina) <> '' then
    select id into v_ofi from public.oficinas where lower(subdominio) = lower(btrim(p_oficina)) limit 1;
  end if;
  -- … senão, a primeira ATIVA **QUE TENHA EQUIPE** (alguém precisa poder atender)
  if v_ofi is null then
    select o.id into v_ofi
      from public.oficinas o
     where o.status = 'ativa'
       and exists (select 1 from public.staff s where s.oficina_id = o.id)
     order by o.criado_em asc
     limit 1;
  end if;
  -- instalação nova (ninguém cadastrado ainda): mantém o comportamento antigo
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

-- 2 ·  Resgata os agendamentos presos em oficinas SEM equipe -------------
--     (move para a oficina ativa com equipe mais antiga — nada é apagado)
with destino as (
  select o.id
    from public.oficinas o
   where o.status = 'ativa'
     and exists (select 1 from public.staff s where s.oficina_id = o.id)
   order by o.criado_em asc
   limit 1
)
update public.agendamentos a
   set oficina_id = (select id from destino)
 where (select id from destino) is not null
   and a.oficina_id is distinct from (select id from destino)
   and not exists (select 1 from public.staff s where s.oficina_id = a.oficina_id);

-- 3 ·  Confere o resultado ----------------------------------------------
select o.nome as oficina, count(a.id) as agendamentos,
       (select count(*) from public.staff s where s.oficina_id = o.id) as equipe
  from public.oficinas o
  left join public.agendamentos a on a.oficina_id = o.id
 group by o.id, o.nome
 order by agendamentos desc;
