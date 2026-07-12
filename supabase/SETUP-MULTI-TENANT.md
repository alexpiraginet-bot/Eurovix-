# Multi-tenant (várias oficinas num só Supabase) — passo a passo

O que muda: hoje a nuvem é de **uma oficina** (a EUROVIX). Esta migração transforma
o banco em **multi-tenant** — o **LexOS** cadastra oficinas, cada oficina só enxerga
o que é dela (RLS por `oficina_id`), a **EUROVIX vira a oficina nº 1** (seus dados
atuais são migrados automaticamente) e você, como **admin LexOS**, enxerga todas
para dar suporte.

> **Provado num Postgres real**: 70/70 casos de isolamento + um ataque de colisão de
> telefone bloqueado nos dois sentidos + revisão adversarial. A migração é
> **idempotente** (pode rodar de novo sem quebrar).

---

## ⚠️ ORDEM IMPORTA (para não quebrar nada)

O app foi feito para funcionar **antes e depois** da migração (ele detecta sozinho se
o banco já é multi-tenant). Ainda assim, siga esta ordem:

### 1) Deixe o app novo entrar no ar primeiro
Ele já sobe automático na Vercel quando o PR é mergeado. O app novo, rodando contra o
banco **ainda antigo**, se comporta exatamente como antes (modo legado) — nada quebra.

### 2) Rode a migração no Supabase
1. Abra **supabase.com → seu projeto → SQL Editor**.
2. (Se ainda não rodou alguma vez) cole e rode `supabase/schema.sql` — é a base do WERK OS.
3. Cole **todo** o `supabase/MULTI-TENANT.sql` → **Run**. Idempotente: pode rodar 2×.
4. Confira o e-mail admin LexOS: em `Authentication → Users` você já tem seu usuário;
   garanta que ele está na allowlist (o `ADMIN-OFICINAS.sql`/`MULTI-TENANT.sql` já cria
   `lex_admins` — se o seu e-mail não estiver lá, rode:
   `insert into public.lex_admins(email) values ('SEU-EMAIL') on conflict do nothing;`).
5. **Authentication → Providers → Email → "Confirm email": OFF** (para o dono da oficina
   ativar o acesso na hora, sem esperar e-mail).

### 3) Recarregue o painel
Quem já estava logado no WERK OS: dê um **F5**. O app detecta o modo multi-tenant e passa
a carimbar `oficina_id` nas gravações.

---

## Cadastrar uma NOVA oficina (fluxo do dia a dia)

1. Entre no **Central Admin**: `/admin.html` (seu login LexOS).
2. **+ Nova oficina** → preencha nome, responsável, WhatsApp, cidade, **plano**
   (Conecta / Digital / Marca própria) e o add-on de IA se for o caso → **Salvar**.
3. Na linha da oficina, clique **🔗 acesso** → o **link de ativação é copiado**
   (e, se houver WhatsApp, abre a conversa com a mensagem pronta).
4. Envie o link ao dono. Ele abre → **cria a própria senha** → entra direto no WERK OS
   já como **administrador da oficina dele** (papel `admin`, só vê os dados dele).
5. Dali pra frente o dono monta a **equipe** dele pela própria tela 👥 Equipe do WERK OS
   (papéis: mecânico / consultor / gestor / admin).

> O link usa a página `ativar-oficina.html?convite=<token>`. O token é **secreto** e de
> uso único: depois que a oficina tem um admin, o mesmo link não cria outro. Para trocar
> o dono (suporte), remova o admin atual e gere um novo link.

---

## Permissões (o que o plano e o papel liberam)

- **Plano** (definido por você no Admin) → quais **módulos** a oficina tem.
- **Papel** (definido pelo dono na Equipe) → o que cada pessoa **faz** dentro deles.
- Isolamento é garantido no **banco** (RLS), não só na tela: mesmo que alguém chame a API
  direto, só recebe os dados da própria oficina.

---

## Checklist de validação (faça depois de rodar o SQL)

- [ ] `/admin.html` abre com seu login LexOS e lista as oficinas (a EUROVIX aparece).
- [ ] Cadastrar uma oficina de teste → **🔗 acesso** copia um link `ativar-oficina.html?convite=…`.
- [ ] Abrir o link numa aba anônima → criar senha → cai no `/werkos.html` como admin.
- [ ] Nessa oficina de teste, fazer um check-in → a OS aparece **só** para ela.
- [ ] Entrar como a EUROVIX (login da equipe atual) → vê **só** as OS da EUROVIX, não as da teste.
- [ ] Excluir a oficina de teste no Admin quando terminar.

---

## Reverter (se precisar)

A migração **adiciona** coluna/nova regra; não apaga dados. Para voltar ao comportamento
antigo, o caminho seguro é restaurar o backup do projeto (Supabase → Database → Backups).
Não “desfaça” colunas na mão com dados reais em cima.

---

## Nunca faça
- Colar a chave **service_role** no site (só a `anon` vai no `env.js` — o RLS protege).
- Rodar `schema.sql` **depois** do `MULTI-TENANT.sql` (o `schema.sql` recria as policies
  single-tenant). Se rodar por engano, rode o `MULTI-TENANT.sql` de novo por cima.

---

## 📅 Módulo Agenda (fila do site → WERK OS)

Depois do multi-tenant, ative a Agenda:
1. **SQL Editor** → cole e rode `supabase/AGENDAMENTOS.sql` (idempotente). Cria a
   tabela `agendamentos` (por oficina) + a função pública `agendar_publico`.
2. Pronto: quando o cliente agenda no **site** (`/agendamento.html`), o pedido cai
   na **fila da oficina ativa**; a recepção vê em **WERK OS → 📅 Agenda**
   (calendário + cronograma), **confirma/cancela** e converte em **check-in** num
   clique (dados já pré-preenchidos). Cada oficina só vê a própria fila (RLS).

Sem rodar esse SQL, o site segue funcionando (localStorage + WhatsApp, como antes)
e a Agenda no painel roda com dados de demonstração — nada quebra.
