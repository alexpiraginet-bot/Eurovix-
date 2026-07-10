# EUROVIX na nuvem — guia de instalação passo a passo

> **Para quem é este guia:** o dono da oficina. Não precisa saber programar — só seguir
> os passos na ordem, sem pular nenhum.
> **Tempo total:** 10 a 15 minutos. **Custo:** zero (plano Free do Supabase, sem cartão).

---

## 0. O que é isto e o que muda

**Hoje** o site roda em *modo demonstração*: os dados (OS, clientes, veículos) ficam
guardados dentro do navegador de cada computador. Cada máquina vê os próprios dados de
exemplo, e limpar o navegador apaga tudo.

**Este guia** liga o site a um banco de dados de verdade na nuvem, usando o
**Supabase** (serviço de banco de dados hospedado). Depois de concluído:

- `werkos.html` (o painel da oficina) passa a **exigir login da equipe**;
- cada check-in cria uma **OS real no banco**, visível de qualquer computador ou celular;
- o cliente entra pelo **link de convite** gerado no check-in, cria a própria senha e
  **só enxerga os próprios carros e OS**;
- painel e app do cliente se atualizam **sozinhos, em tempo real**;
- os dados de exemplo da demonstração **não vão junto** — a produção começa vazia.

O visual e o funcionamento das telas continuam exatamente iguais. Sobre o custo: o
plano Free do Supabase tem limites folgados para o volume de uma oficina; se um dia
o uso crescer além deles, o próprio painel do Supabase avisa.

**O que você precisa em mãos antes de começar:**

- acesso à conta do **GitHub** onde está o código do site (você vai editar 1 arquivo no passo 5);
- um **e-mail seu** (para criar a conta do Supabase e o seu usuário de equipe).

---

## 1. Criar a conta e o projeto no Supabase

1. Abra **https://supabase.com** e clique em **Sign in** (ou **Start your project**).
   Entre com a conta do **GitHub** (recomendado — é a mesma conta do código) ou crie
   uma conta com seu e-mail.
2. Clique em **New project**.
3. Preencha o formulário:
   - **Organization**: em contas novas pode aparecer ANTES uma tela própria para criar a
     organização (nome + tipo + plano) — preencha um nome qualquer, escolha o plano **Free**
     ali e continue; senão, aceite a organização que o Supabase sugerir.
   - **Project name**: `eurovix` (ou outro nome — só identifica o projeto).
   - **Database password**: clique em **Generate a password** (ou crie uma senha longa).
     **GUARDE ESTA SENHA** num gerenciador de senhas ou papel seguro. Ela é a senha do
     banco de dados (não é a senha de login de ninguém), é raramente usada, e o
     Supabase **não mostra de novo** depois. Se perder, dá para redefinir em
     *Project Settings → Database*, mas é melhor não perder.
   - **Region**: **South America (São Paulo)** — código `sa-east-1`.
     Importante: deixa os dados no Brasil e o sistema mais rápido para vocês.
   - **Plan / Pricing**: **Free** (se o seletor não aparecer aqui, é porque o plano já foi
     escolhido na tela da organização — tudo certo).
4. Clique em **Create new project** e aguarde 1 a 2 minutos enquanto aparece
   "Setting up project".

**O que você deve ver no final:** o painel do projeto, com um menu na lateral esquerda
contendo itens como **Table Editor**, **SQL Editor** e **Authentication**. É nesse menu
que os próximos passos acontecem.

---

## 2. Criar as tabelas do banco (colar o schema)

O repositório do site já traz um arquivo que cria tudo no banco: tabelas, regras de
segurança e travas de auditoria. Ele foi feito para ser **re-executável**: rodar duas,
três, dez vezes nunca estraga nada — pode colar sem medo.

1. No **GitHub**, abra o repositório do site → pasta **`supabase`** → arquivo **`schema.sql`**.
2. Copie o conteúdo **inteiro**: use o botão de copiar do GitHub (ícone de duas
   folhas, "Copy raw file", no topo do arquivo) — ou clique em **Raw**, selecione tudo
   (Ctrl+A) e copie (Ctrl+C).
3. No **Supabase**, clique em **SQL Editor** no menu lateral.
4. Clique em **New query** (pode aparecer como um botão **+**).
5. Cole tudo na caixa de texto (Ctrl+V).
6. Clique em **Run** (ou pressione Ctrl+Enter).

**O que você deve ver:** a mensagem **"Success. No rows returned"** na área de
resultado. É isso mesmo — o comando cria estruturas, não devolve linhas.

**Se aparecer erro:** quase sempre é cópia incompleta do arquivo. Repita do item 2,
garantindo que copiou do primeiro ao último caractere, e rode de novo.

**Conferência (opcional):** clique em **Table Editor** no menu lateral. Devem aparecer
as tabelas `clientes`, `veiculos`, `ordens`, `eventos_log`, `config` e `staff` — todas
**vazias**. Vazias é o correto: a produção começa do zero, sem dados de demonstração.

---

## 3. Ajustar o login por e-mail (1 configuração que não pode faltar)

1. No menu lateral, clique em **Authentication**.
2. Entre em **Sign In / Providers** (dependendo da versão do painel, pode aparecer
   como **Providers** ou dentro de **Sign In / Up**).
3. Clique em **Email** e confira duas chaves:
   - **Enable Email provider** (habilitar login por e-mail): **LIGADO** — normalmente já vem assim.
   - **Confirm email** (exigir confirmação de e-mail): **DESLIGADO**.
4. Clique em **Save**.

**Por que desligar o "Confirm email"?** Quando um cliente ativa o convite e cria a
senha, o sistema registra para ele um login interno com um e-mail *sintético* — algo
como `c27999000000@clientes.eurovix.app`. Esse endereço não existe de verdade e **não
recebe mensagens**. Se a confirmação ficar ligada, o Supabase espera o cliente clicar
num e-mail de confirmação que nunca vai chegar — e o cliente fica trancado para fora
com o erro "Email not confirmed". A segurança do acesso do cliente não depende dessa
confirmação: ela vem da senha que ele mesmo cria e das regras de acesso que o passo 2
instalou dentro do banco.

---

## 4. Criar o seu usuário da equipe (staff)

São duas partes: **criar o login** e **marcar esse login como equipe**. Sem a segunda
parte, a pessoa até loga, mas o sistema não mostra nada a ela (de propósito).

### 4a. Criar o login

1. **Authentication** → **Users**.
2. Clique em **Add user** → **Create new user**.
3. Preencha:
   - **Email address**: o seu e-mail **real** (ex.: o e-mail que você usa na oficina).
   - **Password**: uma senha **forte** (12 caracteres ou mais). **Guarde-a**: é a senha
     que você usará todo dia para entrar no WERK OS.
   - Se aparecer a opção **Auto Confirm User**, deixe **marcada**.
4. Clique em **Create user**. O usuário aparece na lista.

### 4b. Marcar como equipe

1. **SQL Editor** → **New query**.
2. Cole o comando abaixo, trocando o e-mail (tem que ser **idêntico** ao do passo 4a)
   e o nome:

   ```sql
   insert into public.staff (auth_user, nome)
   values (
     (select id from auth.users where email = 'voce@exemplo.com.br'),
     'Seu Nome Completo'
   )
   on conflict (auth_user) do update set nome = excluded.nome;
   ```

3. Clique em **Run**. Deve aparecer "Success".

**Se der o erro** `null value in column "auth_user"`: o e-mail entre aspas não bate
com o e-mail do usuário criado no 4a (erro de digitação é a causa nº 1). Corrija e
rode de novo — repetir é seguro.

**Conferência:** rode esta consulta; ela deve listar você:

```sql
select s.nome, u.email
  from public.staff s
  join auth.users u on u.id = s.auth_user;
```

**Mais pessoas na equipe?** Repita 4a e 4b para cada uma, cada qual com o próprio
e-mail e senha.

---

## 5. Ligar o site ao banco (editar o env.js)

### 5a. Copiar as duas informações do Supabase

1. No Supabase, clique em **Project Settings** (ícone de engrenagem, no fim do menu
   lateral) → **API**. Em projetos novos, isso pode aparecer dividido em duas páginas:
   **Data API** (onde fica a URL) e **API Keys** (onde ficam as chaves).
2. Copie, uma de cada vez:
   - **Project URL** — parece com `https://xxxxxxxxxxxx.supabase.co`;
   - a chave **anon public** — um código muito longo que começa com `eyJ`.
     Em projetos novos a tela pode mostrar em destaque uma chave **Publishable**
     (começa com `sb_publishable_...`): **pode usar essa** — ela cumpre o mesmo papel
     da anon e é igualmente pública; a anon `eyJ...` fica em **Legacy API keys**
     (se a tela mostrar uma seção **Legacy API keys**, a anon fica dentro dela).
3. **NÃO copie** a chave `service_role` (também chamada de "secret") que aparece na
   mesma tela — veja o passo 7.

### 5b. Editar o arquivo no GitHub

1. Abra **github.com** → o repositório do site → pasta **`assets`** → **`js`** →
   arquivo **`env.js`**.
2. Clique no ícone de **lápis** ("Edit this file"), no canto superior direito do arquivo.
3. No fim do arquivo, o trecho está assim (**ANTES** — vazio, modo demonstração):

   ```js
   window.EVX_ENV = {
     SUPABASE_URL: '',
     SUPABASE_ANON_KEY: '',
   };
   ```

4. Preencha os dois valores **dentro das aspas**. Vai ficar assim
   (**DEPOIS** — os valores abaixo são de EXEMPLO, ilustrativos; use os SEUS, copiados no 5a):

   ```js
   window.EVX_ENV = {
     SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.EXEMPLO-ILUSTRATIVO.nao-use-este-valor',
   };
   ```

   Cuidados ao colar:
   - os valores ficam **entre as aspas**, sem espaços sobrando;
   - **não apague as vírgulas** no fim das linhas;
   - a chave anon é enorme e vai **inteira, numa linha só** — cole tudo, mesmo que
     pareça "cortada" na tela.

5. Clique em **Commit changes...** e confirme (pode aceitar a mensagem sugerida).

### 5c. Esperar o site atualizar

A Vercel publica o site sozinha a cada alteração no GitHub — leva cerca de 1 minuto.
Para conferir: **vercel.com** → o projeto do site → aba **Deployments** → o item do
topo da lista deve ficar com o status **Ready**. Depois disso, abra o site e recarregue
forçando (Ctrl+Shift+R).

---

## 6. Conferir que tudo funcionou (checklist de 5 minutos)

Faça na ordem — cada item prova uma parte do sistema:

1. **Login da equipe.** Abra `https://eurovix.vercel.app/werkos.html`. Deve aparecer a
   tela **"WERK OS — acesso da equipe"** pedindo e-mail e senha (antes, em modo demo,
   ia direto para o kanban). Entre com o e-mail e a senha do passo 4a. O kanban abre
   **vazio** — correto, ainda não há OS.
2. **Primeira OS real.** Faça um **Novo check-in** completo (pode ser com um carro da
   oficina). A OS criada será a de número **2000** — a numeração da nuvem começa aí,
   para não confundir com os números 12xx da demonstração. Prova de que foi para o
   banco: no Supabase, **Table Editor → ordens** deve mostrar 1 linha.
3. **Convite do cliente.** No fim do check-in, no card **"Acesso do cliente ao app"**,
   clique em **copiar link** (o mesmo link também fica no menu **Clientes & Acesso** do painel).
   Abra uma **janela anônima** do navegador (Ctrl+Shift+N no Chrome) e cole o link:
   a página pede para o cliente **criar a própria senha** e, ao concluir, mostra o
   veículo e a OS dele — e nada além disso. Nas próximas vezes ele entra com
   **telefone + senha**.
4. **Tempo real.** Deixe as duas janelas lado a lado (painel logado + app do cliente).
   No painel, avance o status da OS. O app do cliente deve atualizar **sozinho**, em
   poucos segundos, sem recarregar a página.

Passou nos 4? O sistema está em produção. Daqui em diante: a equipe entra pelo
`werkos.html`, os clientes entram pelos convites gerados nos check-ins.

---

## 7. Avisos de segurança e cuidados contínuos

**NUNCA cole a `service_role` no site.**
Na mesma tela de API do Supabase existe uma segunda chave, chamada `service_role`
(ou "secret"). Ela **ignora todas as regras de proteção do banco**: quem tiver essa
chave lê, altera e apaga tudo — de todos os clientes. Ela **nunca** pode aparecer no
`env.js`, no GitHub, no site ou em qualquer lugar público. A única chave que vai para
o site é a **anon public**, que é pública por design: ela só identifica o projeto, e
quem protege os dados são as regras instaladas dentro do banco no passo 2.

**O projeto pode "dormir" (plano Free).**
No plano Free, o Supabase **pausa o projeto após cerca de 7 dias sem uso** — o site
então volta a não conectar. Para despausar: entre em **supabase.com**, o projeto
aparecerá marcado como pausado ("Paused"); clique em **Restore project** (pode aparecer
como "Restore" ou "Resume") e aguarde alguns minutos. O uso normal do dia a dia da
oficina já conta como atividade e evita a pausa.

**Backups são limitados no plano Free — exporte um CSV de vez em quando.**
O plano Free não guarda cópias de segurança automáticas de longo prazo. Crie o hábito
(1x por mês, ou depois de uma semana cheia): no Supabase, abra o **Table Editor**,
entre em cada tabela importante (`ordens`, `clientes`, `veiculos`) e use a opção de
**exportar/baixar CSV**. Se não encontrar o botão na sua versão do painel, o caminho
alternativo sempre funciona: **SQL Editor** → `select * from public.ordens;` → **Run** →
botão de **Export/Download CSV** na área de resultado (repita trocando o nome da
tabela). Guarde os arquivos num lugar seguro (Drive, pen drive).

**Senhas para guardar:** a senha do **banco** (passo 1, raramente usada) e a senha
**staff** de cada pessoa da equipe (passo 4a, usada todo dia). Se alguém da equipe
esquecer a senha: em **Authentication → Users**, abra o usuário e use a opção de
redefinir a senha — ou apague o usuário, crie de novo (4a) e repita o 4b.

---

## 8. Problemas comuns e soluções

| Sintoma | Causa provável | Solução |
|---|---|---|
| Cliente não consegue entrar; aparece **"Email not confirmed"** | O **"Confirm email"** ficou ligado (passo 3) | Refaça o **passo 3** (desligar e salvar). Se algum cliente já tinha tentado e travou: em **Authentication → Users**, apague o usuário sintético dele (`c…@clientes.eurovix.app`) e peça para ele abrir o **link de convite** de novo. |
| Ativação de convite falha com **"email rate limit exceeded"** | Consequência do mesmo **"Confirm email"** ligado: cada tentativa de cadastro tenta enviar um e-mail de confirmação (para um endereço sintético que não existe) e o limite de envios do plano Free esgota rápido | Desligue o **Confirm email** (passo 3) — sem ele, nenhum e-mail é enviado e o limite deixa de ser tocado. O contador do limite zera sozinho em cerca de 1 hora; depois disso as ativações voltam a funcionar. |
| A pessoa da equipe tenta logar e vê o aviso de que **não foi cadastrada como staff** — ou entra e **não vê nada** | Faltou o INSERT do **passo 4b** (o login existe, mas não está marcado como equipe) | Rode o comando do **4b** com o e-mail exato da pessoa e faça login de novo. |
| O site mostra erro **"Invalid API key"** | A chave colada no `env.js` está errada: era a `service_role`, veio incompleta, ou a URL/chave são de **outro projeto** | Refaça o **5a/5b**: copie a **anon public** (`eyJ...`) OU a **Publishable** (`sb_publishable_...`) inteira e a **Project URL** do MESMO projeto, cole com cuidado e faça o commit. |
| A página **continua em modo demonstração** (dados de exemplo, `werkos.html` sem pedir login) | O `env.js` não foi salvo/commitado, o deploy não rodou, ou o navegador está com a versão antiga | Confira no GitHub que `assets/js/env.js` mostra os valores preenchidos; na **Vercel → Deployments**, veja se o deploy mais recente está **Ready**; recarregue com **Ctrl+Shift+R**. Conferência direta: abra `https://eurovix.vercel.app/assets/js/env.js` e veja se os valores aparecem preenchidos. |
| **Dados antigos da demonstração** aparecem misturados na tela | É o cache local que sobrou da fase demo naquele navegador (não está no banco) | No WERK OS: **Configurações → "Limpar cache local"** (se a página ainda estiver em modo demo, o mesmo botão aparece como **"Resetar demo"**). Uma vez por navegador/dispositivo resolve. |
| Depois de alguns dias sem usar, **nada conecta** / erro de rede | O projeto Free foi **pausado** por inatividade | Veja o **passo 7**: supabase.com → **Restore project** e aguarde alguns minutos. |
| Cliente abre o link e vê **"Convite inválido"** | O link foi **cortado** no envio (cópia parcial, quebra no WhatsApp) — ou é um convite antigo da demonstração | No painel, menu **Clientes & Acesso** → **copiar link** de novo e envie o link **inteiro**. Convites da fase demo não valem na nuvem. |

---

Fim do guia. Para entender como a nuvem se encaixa no código, veja a seção
**"Nuvem (produção)"** no README do repositório.
