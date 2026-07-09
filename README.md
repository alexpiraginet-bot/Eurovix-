# EUROVIX — Ecossistema Digital

**Oficina Especializada BMW · Vitória/ES**

Este repositório materializa o escopo aprovado na apresentação de identidade & ecossistema digital da EUROVIX — e o elabora além do conceito: em vez de mockups estáticos, aqui estão o **site premium**, o **fluxo de agendamento online** e o **app do cliente** como produtos navegáveis, construídos sobre a identidade oficial da marca.

## 🚀 Como rodar

Não há build nem dependências — é HTML/CSS/JS puro.

```bash
# Opção 1: abrir direto
abra index.html no navegador

# Opção 2: servidor local (recomendado)
npx serve .
# ou
python3 -m http.server 8080
```

Hospedagem: qualquer estático (GitHub Pages, Netlify, Vercel).

## 📄 Páginas

| Página | O que é |
|---|---|
| `index.html` | **Site premium** — hero, 5 pilares, sobre, 6 linhas de serviço, performance (stages), processo em 6 etapas, seção do app com mockup, depoimentos, FAQ, CTA de frotas e contato. |
| `agendamento.html` | **Agendamento online** em 4 passos (veículo → serviço → data/hora → confirmação), com validação, protocolo `EVX-XXXXXX` e confirmação via WhatsApp. Aceita pré-seleção via `?servico=id`. |
| `app.html` | **App do cliente** (demo navegável) — splash, login, dashboard do veículo, saúde dos itens, serviços, **ordens de serviço ao vivo** com linha do tempo e **aprovação de orçamento**, agenda integrada, notificações e perfil. |
| `apresentacao.html` | O deck original de 9 slides que definiu o escopo (preservado). |

## 🧪 Conta demo do app

- **E-mail:** `demo@eurovix.com.br` · **Senha:** `bmw2026` (ou o botão "entrar com a conta demo")
- Qualquer e-mail válido + senha de 4+ caracteres também entra (modo demonstração).
- A **OS #1257 evolui em tempo real** enquanto o app está aberto (1 etapa a cada ~20s). Na etapa *Aguardando aprovação*, o fluxo só continua depois que você toca em **Aprovar orçamento** — o mesmo mecanismo do produto final.
- Agendamentos feitos em `agendamento.html` aparecem na aba **Agenda** do app (localStorage compartilhado, chaves `evx.*`). Para resetar a demo: limpe o localStorage do navegador.

## 🎨 Identidade

Extraída do brand board oficial (`assets/img/brand/brandboard.png`):

| Token | Valor | Uso |
|---|---|---|
| Vermelho competição | `#E63928` | Ação, destaque, assinatura do "X" |
| Azul BMW | `#1E4FA0` (claro `#4A7FD4`) | Contraponto técnico |
| Cinza | `#A9A9A9` | Apoio |
| Grafite | `#222428` | Superfícies |
| Preto profundo | `#0A0A0A` | Fundo base |
| Azul-noite | `#0D1117` | Fundo alternativo |

- **Tipografia:** Montserrat (títulos/destaques). O board especifica **DIN Next** para texto — fonte licenciada; na web usamos **Barlow** como stand-in até a licença ser adquirida.
- **Símbolo:** engrenagem vermelha + arco de velocímetro azul + "X" com agulha, recriado em vetor (`assets/img/logo-simbolo.svg`, `assets/img/favicon.svg`).
- Tokens centralizados em `assets/css/tokens.css`; ícones do kit de UI como sprite SVG inline.

## 🗂 Estrutura

```
├── index.html · agendamento.html · app.html · apresentacao.html
├── manifest.webmanifest          # PWA (app instalável)
└── assets/
    ├── css/  tokens.css · site.css · app.css
    ├── js/   data.js (catálogo/OS/persistência) · site.js · agendamento.js · app.js
    └── img/  logo-simbolo.svg · favicon.svg · brand/ (ativos do board)
```

## 🗺 Roadmap (fases do escopo)

1. **Fase 1 — Identidade** ✅ aplicada em código (tokens, símbolo vetorial, wordmark).
2. **Fase 2 — Site no ar** ✅ landing + agendamento prontos para publicar; próximo passo: domínio, analytics e integração do agendamento com backend/CRM.
3. **Fase 3 — App em produção** 🔜 este demo define UX e regras (aprovação de orçamento, timeline de OS); próximo passo: backend real (OS, push notifications) e publicação nas lojas.

## ⚠️ Notas

- Dados de contato, endereço, depoimentos e métricas são **placeholders realistas** para validação — substituir pelos oficiais antes do go-live.
- BMW e MINI são marcas registradas de BMW AG; a EUROVIX é oficina independente (disclaimer presente no rodapé).
