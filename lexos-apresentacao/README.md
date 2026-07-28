# LexOS — apresentação navegável

Apresentação comercial do **LexOS**, montada com **telas reais do sistema** capturadas do
modo de demonstração. Abre no navegador, navega por teclado/clique/gesto e exporta em PDF.

```
lexos-apresentacao/
├── index.html                 apresentação inteira (HTML + CSS + JS, sem dependência externa)
├── lexos-apresentacao.pdf     export com um slide por página
├── INVENTARIO.md              catálogo das telas usadas, com módulo, rota e situação
├── vercel.json                cabeçalhos de cache para publicação
└── assets/
    ├── marca.svg              símbolo LexOS
    └── telas/*.webp           23 capturas reais (1600px desktop · 1170px celular)
```

## Como abrir

Qualquer servidor estático serve. Na raiz do repositório:

```bash
python3 -m http.server 8080
# depois: http://localhost:8080/lexos-apresentacao/
```

Publicada, fica em `/lexos-apresentacao/`.

## Controles

| Tecla | Ação |
|---|---|
| `→` `espaço` `PageDown` | próximo slide |
| `←` `PageUp` | slide anterior |
| `Home` / `End` | primeiro / último |
| `M` | abrir e fechar o sumário |
| `F` | tela cheia |
| `Esc` | fechar o sumário |

No celular, deslizar para o lado troca de slide. Cada slide tem URL própria (`#s12`),
então dá para mandar o link já apontando para um trecho.

## Exportar em PDF

O `lexos-apresentacao.pdf` do repositório já está gerado (297 × 167 mm, um slide por página,
fundos preservados, sem controles). Para regerar depois de editar:

`Ctrl/Cmd + P` → papel paisagem → "Gráficos de segundo plano" ligado → salvar em PDF.

## Regras de conteúdo

**Marca.** A apresentação usa exclusivamente **LexOS**. A oficina que aparece nas telas é
fictícia (*Oficina Modelo Porsche & Audi*), assim como clientes, placas, telefones e valores. O nome da
oficina-piloto não aparece em lugar nenhum — nem em texto, nem em imagem, nem em metadado.
O script de captura aborta se detectar a marca proibida em qualquer tela antes de fotografar.

Para conferir a qualquer momento:

```bash
MARCA=<nome-da-oficina-piloto>
grep -RniE "$MARCA" lexos-apresentacao/ | wc -l                       # precisa dar 0
for f in lexos-apresentacao/assets/telas/*.webp; do strings "$f" | grep -i "$MARCA"; done
```

(o nome não é escrito aqui de propósito: a verificação acima daria falso positivo
por causa do próprio texto deste arquivo)

**Status.** Nenhuma funcionalidade é apresentada como pronta sem qualificação. Todo slide de
tela carrega um dos quatro selos:

| Selo | Significado |
|---|---|
| Funcional na demonstração | roda hoje, com dados fictícios |
| Estrutura preparada | a tela e o modelo existem; falta a fonte de dados real |
| Depende de integração | precisa de provedor/credencial externa para operar |
| Planejado no roadmap | ainda não construído |

Não há métrica de mercado, depoimento, cliente ou resultado financeiro inventado.

## Telas que ficaram de fora, e por quê

A **land page do cliente** e o **agendamento público** ainda trazem WhatsApp e Instagram fixos
da oficina-piloto (contato hardcoded em `assets/js/data.js`), e a **raiz da plataforma** cita
essa oficina como caso ao vivo. As três ficaram fora do deck até virarem white-label de
verdade — está na lista "o que falta para produção", dentro da própria apresentação.

## Como as capturas foram feitas

Playwright sobre o sistema rodando localmente em modo demonstração, com a identidade da
oficina fictícia gravada pela própria configuração do produto (o white-label funcionando,
não uma edição de imagem). Desktop em 1440 × 900 com fator de escala 2; celular no perfil
iPhone 390 × 844. As capturas saem em PNG e são convertidas para WebP (qualidade 82),
o que reduziu 8,3 MB para 1,4 MB sem perda visível.
