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
     2. Copie "Project URL"              → SUPABASE_URL
     3. Copie a chave pública do projeto → SUPABASE_ANON_KEY
        (vale a "anon public" eyJ… OU a "Publishable" sb_publishable_…;
         as duas cumprem o mesmo papel — use a do MESMO projeto da URL)
     4. Commit + push (a Vercel publica sozinha)

   Preenchido (como está) = MODO NUVEM: o site conversa com o Supabase.
   Para voltar ao modo demonstração local (dados de exemplo no navegador,
   sem nuvem), basta deixar os dois valores como '' de novo.
   ============================================================ */
window.EVX_ENV = {
  SUPABASE_URL: 'https://olfqtvncorwhjrjjzmer.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_2GhJjTqPP8r5p8-zJNr0uQ_I7zyjdOs',
};
