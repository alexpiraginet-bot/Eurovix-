/* ============================================================
   EUROVIX · env.js — credenciais públicas do Supabase (produção)
   ------------------------------------------------------------
   Este arquivo é COMMITADO DE PROPÓSITO. A "anon key" do Supabase
   é pública por design: ela identifica o projeto, mas quem protege
   os dados é o RLS (Row Level Security) definido em
   supabase/schema.sql — nunca o sigilo desta chave.
   ⚠ O que NUNCA pode aparecer aqui é a chave "service_role".

   Como preencher (passo a passo completo em SETUP-NUVEM.md):
     1. supabase.com → seu projeto → Settings → API
     2. Copie "Project URL"        → SUPABASE_URL
     3. Copie a chave "anon public" → SUPABASE_ANON_KEY
     4. Commit + push (a Vercel publica sozinha)

   Vazio (como está) = MODO DEMONSTRAÇÃO LOCAL: o site roda 100%
   no navegador, com dados de exemplo em localStorage e sem nuvem.
   ============================================================ */
window.EVX_ENV = {
  SUPABASE_URL: 'https://olfqtvncorwhjrjjzmer.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_2GhJjTqPP8r5p8-zJNr0uQ_I7zyjdOs',
};
