# EUROVIX — Ecossistema Digital + WERK OS

**Oficina Especializada BMW · Vitória/ES**

## 🌐 Demo publicada (ao vivo)

- **Painel Mestre (todos os acessos):** https://raw.githack.com/alexpiraginet-bot/Eurovix-/claude/html-scope-elaboration-jrxef5/painel.html
- **Site:** https://raw.githack.com/alexpiraginet-bot/Eurovix-/claude/html-scope-elaboration-jrxef5/index.html
- **App do cliente:** https://raw.githack.com/alexpiraginet-bot/Eurovix-/claude/html-scope-elaboration-jrxef5/app.html
- **WERK OS (painel da oficina):** https://raw.githack.com/alexpiraginet-bot/Eurovix-/claude/html-scope-elaboration-jrxef5/werkos.html

Servido via githack (CDN sobre o GitHub, público) — os links do branch refletem cada push. Para URL definitiva (`alexpiraginet-bot.github.io/Eurovix-/`): habilitar **Settings → Pages → Source: GitHub Actions** uma vez e rodar o workflow `Deploy GitHub Pages` (manual — o token de CI não tem permissão para criar o site do Pages). Há também um mirror pronto para Vercel em `deploy/vercel-mirror/`.

Este repositório evoluiu em duas camadas:

1. **Camada cliente/marketing** — site premium, agendamento online e app do cliente (do brand board original).
2. **WERK OS** — o sistema operacional completo da oficina: check-in digital com blindagem jurídica, DVI em 3 cores, motor de peças por chassi, orçamento por AW, aprovação item a item com validade jurídica, kanban de 8 etapas, QC com dupla assinatura, checkout com Pix, documentos em PDF e gestão (DRE/comissão/ABC).

Tudo em HTML/CSS/JS puro sobre `localStorage` — **demo funcional da Fase 1** com as interfaces desenhadas para receber as integrações reais (Supabase, PartsLink24, TecDoc, Mercado Pago/Stone, NFS-e) sem retrabalho de UI.

## 🚀 Como rodar

```bash
python3 -m http.server 8080    # ou npx serve .
```

**Roteiro de demonstração (5 min):**
1. Abra `werkos.html` (painel) e `app.html` (cliente demo) **lado a lado em duas abas**.
2. No app: entre com a conta demo → aba **OS** → OS #1258 → aprove o orçamento **item a item** (escolha níveis, desmarque as pastilhas, assine).
3. Veja o painel refletir na hora (evento de storage = realtime da demo). Avance a OS: micro-update → QC (dupla assinatura) → lavagem → pronto → **checkout Pix** → entrega.
4. De volta ao app: NPS pós-entrega, garantias com contagem regressiva no perfil e a pastilha adiada virando **pendência futura** no início.
5. No painel: **Novo Check-in** (VIN com dígito verificador validado em tempo real), fotos, mapa de danos, assinatura → **Termo de Entrada em PDF**.

## 📄 Superfícies

| Página | O que é |
|---|---|
| `index.html` | Site premium (hero, pilares, 6 serviços, performance, processo, depoimentos, FAQ, contato). |
| `agendamento.html` | Agendamento em 4 passos com protocolo e WhatsApp (Etapa 0 — pré-chegada). |
| `app.html` | App do cliente: dashboard, rastreamento estilo encomenda, **aprovação item a item com 3 níveis + assinatura + hash/IP/timestamp**, chat com consultor, pendências, garantia por item com contagem, NPS, cofre digital. |
| `werkos.html` | **Painel da oficina**: kanban 8 etapas, check-in digital, DVI, motor de peças, orçamento AW, QC, checkout Pix/NF, veículos & prontuário por VIN, gestão (DRE, comissão por AW, curva ABC, exports CSV), configurações. |
| `documento.html` | Gerador de documentos: Termo de Entrada, DVI, Orçamento, OS, Fatura, Certificado de Garantia, **Prontuário vitalício por VIN** — todos imprimíveis (`?tipo=…&os=…` / `?tipo=prontuario&vin=…`). |
| `apresentacao.html` | Deck original de 9 slides do escopo. |

Conta demo do app: `demo@eurovix.com.br` · `bmw2026` (ou o botão de conta demo). Reset da demo: **Configurações → Resetar demo** no painel.

## 🔩 WERK OS — cobertura da especificação

| Módulo da spec | Status na demo | O que falta p/ produção |
|---|---|---|
| **Etapa 0** Pré-chegada | ✅ agendamento + sintoma texto | áudio/vídeo do sintoma; reserva automática de box |
| **Etapa 1** Check-in digital | ✅ VIN ISO 3779 validado, checklist, fotos 360°, mapa de danos, assinatura, **Termo PDF** | OCR real de placa/painel (Claude API — Fase 3) |
| **Etapa 2** Diagnóstico DVI | ✅ 3 cores, DTC import, **mídia obrigatória (regra dura)** | import direto ISTA/Autel |
| **Etapa 3** Orçamento | ✅ item→linha automático, **AW × valor-hora**, margem por nível, **3 níveis por item** | tabela AW oficial completa |
| **Etapa 4** Aprovação | ✅ item a item no app, níveis selecionáveis, **assinatura + IP + timestamp + hash**, recusados → pendências com régua | push/WhatsApp reais |
| **Etapa 5** Execução | ✅ kanban 8 colunas, timeline de encomenda, micro-updates, status "aguardando peça" com tracking, **chat in-app** | fotos/vídeos reais do box (storage) |
| **Etapa 6** QC | ✅ checklist obrigatório + test-drive km + **dupla assinatura — sem QC não há checkout** | — |
| **Etapa 7** Checkout | ✅ fatura, **Pix BR Code EMV com CRC16 real**, parcelamento, NF automática (simulada), janela de retirada | Orders API MP/Stone + NFS-e municipal |
| **Etapa 8** Pós-serviço | ✅ relatório PDF, **garantia digital por item com countdown**, NPS 24h (na entrega), pendências reapresentadas | régua de e-mail/push agendada |
| **Motor de Peças** | ✅ 4 camadas simuladas com interface fiel: VIN→ETK→part number→cross-ref (Lemförder/Sachs/Mahle/Brembo…)→cotação 5 fornecedores (preço × prazo) | assinaturas PartsLink24 + TecDoc + conectores B2B |
| **Banco de dados** | ✅ entidades espelhadas em `localStorage`: VEICULO (VIN pk), OS→ITEM_DIAG→ITEM_ORC, GARANTIA, MIDIA (thumb), **EVENTO_TIMELINE imutável**, PAGAMENTO | Postgres/Supabase (schema já desenhado pelas entidades) |
| **Nuvem & mídia** | ⚠ thumbnails em localStorage (limite do navegador) | S3/R2 com lifecycle, indexação por VIN, LGPD |
| **Documentos** | ✅ 7 PDFs via print + **exports CSV** (DRE, ABC) | geração server-side |
| **Extras** | ✅ comissão por AW, DRE por OS, **recall por VIN no check-in**, cofre digital, gestão margem | curva de risco por motor (dados próprios), cortesia/Uber |

## 🧱 Arquitetura

```
assets/js/
├── data.js        # marca, catálogo de serviços, notificações, sessão (camada cliente)
├── werk-data.js   # WERK OS: modelo de dados, VIN, motor de peças, Pix EMV, seeds, event log
├── site.js · agendamento.js
├── app.js         # app do cliente — consome o MESMO store do painel
├── werkos.js      # painel da oficina (kanban, check-in, OS, gestão…)
└── documento.js   # renderizador dos 7 documentos
```

- **Um único store** (`evx.werk.*`): o app e o painel leem/escrevem as mesmas OS — eventos de `storage` fazem o realtime entre abas (em produção: Supabase Realtime no mesmo papel).
- **Log imutável**: todo evento (status, aceite, QC, pagamento) é append-only em `EVENTO_TIMELINE` com ator e timestamp — a auditoria da spec.
- **Regras duras implementadas**: item 🔴/🟡 sem mídia não entra no DVI; sem aprovação não há execução; sem QC duplo-assinado não há checkout.
- Pix: payload **BR Code EMV com CRC16-CCITT real** (copia-e-cola válido); QR ilustrativo na demo.

## 🎨 Identidade & tema visual

- **Superfícies do cliente** (site, agendamento, app, painel mestre) seguem a **linguagem visual do bmw.com.br**: fundo branco, texto grafite `#262626`, **azul BMW `#1C69D4`** como única cor de ação, cantos quase retos, hairlines `#E6E6E6`, teasers escuros de campanha e tipografia neo-grotesca (**Inter** como stand-in web do BMW Type Next). Tema aplicado via `body.theme-bmw` em `tokens.css`.
- **WERK OS** (ferramenta interna da oficina) permanece no tema escuro técnico.
- **Logos**: somente arte oficial da marca — recortes em alta do brand board em `assets/img/brand/` (`logo-principal-dark.png`, `logo-light.png`, `app-icon-dark.png`, `favicon.png`). Nenhum logo renderizado por código. O vermelho EUROVIX vive dentro da arte do logo; a UI usa o azul BMW.
- BMW e MINI são marcas registradas de BMW AG — a EUROVIX é oficina independente (disclaimer no rodapé); a semelhança é de linguagem de design, sem uso do roundel ou de ativos da fabricante.

## 🗺 Fases (da spec)

- **Fase 1 (60–90 dias)** — check-in fotográfico + OS + orçamento com aprovação por link + kanban + tracking + PDFs → **é exatamente o que esta demo cobre de ponta a ponta**; falta plugar Supabase (auth/realtime/storage) por trás das interfaces já prontas.
- **Fase 2** — motor de peças real (PartsLink24 + TecDoc + cotação B2B), pagamento in-app (Orders API), NF automática.
- **Fase 3** — IA de visão (OCR placa/painel/danos via Claude API), preditivo por dados próprios, comissionamento avançado, cortesia/Uber.

## ⚠️ Notas

- Part numbers, preços, fornecedores, contatos e depoimentos são **placeholders realistas** para validação de UX — os reais entram com as integrações.
- BMW e MINI são marcas registradas de BMW AG; a EUROVIX é oficina independente.
