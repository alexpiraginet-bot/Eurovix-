-- ============================================================
-- LexOS · Central Admin — registro de OFICINAS contratantes (tenants)
-- ------------------------------------------------------------
-- Cole este arquivo UMA VEZ no SQL Editor do projeto Supabase.
-- Antes, no painel Supabase → Authentication → Users → "Add user",
-- crie SEU usuário admin (e-mail + senha). Depois troque o e-mail no
-- BOOTSTRAP lá embaixo pelo mesmo e-mail e rode tudo.
-- Idempotente: pode rodar de novo sem quebrar nada.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tabela de oficinas (tenants) ----------
create table if not exists public.oficinas (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  responsavel  text,
  whatsapp     text,
  email        text,
  cidade       text,
  plano        text not null default 'Conecta',
  addon_ia     boolean not null default false,
  unidades     integer not null default 1,
  subdominio   text,
  status       text not null default 'lead',
  obs          text,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint oficinas_plano_chk  check (plano  in ('Conecta','Digital','Marca própria')),
  constraint oficinas_status_chk check (status in ('lead','ativando','ativa','pausada'))
);
create unique index if not exists oficinas_subdominio_uidx
  on public.oficinas (lower(subdominio))
  where subdominio is not null and subdominio <> '';

-- ---------- Allowlist de admins LexOS (por e-mail do Auth) ----------
create table if not exists public.lex_admins (
  email     text primary key,
  criado_em timestamptz not null default now()
);

create or replace function public.is_lex_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lex_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_lex_admin() to authenticated, anon;

-- ---------- atualizado_em automático ----------
create or replace function public.tg_oficinas_touch() returns trigger
  language plpgsql as $$
begin new.atualizado_em = now(); return new; end $$;
drop trigger if exists oficinas_touch on public.oficinas;
create trigger oficinas_touch before update on public.oficinas
  for each row execute function public.tg_oficinas_touch();

-- ---------- RLS: só admins LexOS leem/gravam ----------
alter table public.oficinas enable row level security;
drop policy if exists oficinas_admin_all on public.oficinas;
create policy oficinas_admin_all on public.oficinas
  for all to authenticated
  using (public.is_lex_admin())
  with check (public.is_lex_admin());

grant select, insert, update, delete on public.oficinas to authenticated;

-- ============================================================
-- BOOTSTRAP — troque o e-mail abaixo pelo do SEU usuário admin
-- (o mesmo criado em Authentication → Users) e rode.
-- ============================================================
insert into public.lex_admins (email) values ('SEU-EMAIL@dominio.com')
  on conflict (email) do nothing;

-- Conferência:  select * from public.lex_admins;
--               select public.is_lex_admin();  -- true logado como admin
