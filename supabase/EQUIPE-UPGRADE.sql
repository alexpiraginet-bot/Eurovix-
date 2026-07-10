-- ============================================================================
-- EUROVIX · EQUIPE-UPGRADE.sql — habilita a view 👥 Equipe do WERK OS
-- ----------------------------------------------------------------------------
-- PARA QUEM JÁ TEM O BANCO NO AR (schema.sql já executado antes desta página):
-- cole este arquivo INTEIRO no SQL Editor do Supabase e clique em Run. UMA vez
-- só — e re-executar é seguro (create or replace + bootstrap idempotente).
-- Instalações novas não precisam dele: o schema.sql completo já inclui tudo.
-- ============================================================================

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

