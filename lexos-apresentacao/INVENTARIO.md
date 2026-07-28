# Inventário das telas usadas na apresentação

23 capturas reais, tiradas do sistema em modo demonstração sob a oficina fictícia
*Oficina Modelo*. Situação: **F** funcional na demonstração · **P** estrutura preparada ·
**D** depende de integração externa.

| Tela | Módulo | Rota | Perfil | O que resolve | Situação | Slide |
|---|---|---|---|---|---|---|
| painel-quadro | Quadro da Oficina | `werkos.html#/kanban` | oficina | onde está cada carro e em que etapa | F | 5 |
| painel-agenda | Agenda | `werkos.html#/agenda` | oficina | pedido do cliente vira fila e check-in | F | 6 |
| painel-checkin-1 | Check-in · etapa 1 | `werkos.html#/checkin` | oficina | identificação do veículo por placa e chassi | D (consulta de placa) | 7 |
| painel-checkin-2 | Check-in · etapa 2 | `werkos.html#/checkin` | oficina | tour 360°, checklist e mapa de avarias | D (leitura por IA) | 8 |
| painel-os | Ordem de Serviço | `werkos.html#/os/:n` | oficina | diagnóstico, orçamento e linha do tempo | F | 9 |
| painel-pecas | Motor de Peças | `werkos.html#/pecas` | oficina | catálogo, equivalentes e fornecedor | P | 10 |
| painel-veiculos | Veículos & Prontuário | `werkos.html#/veiculos` | oficina | histórico por chassi, transferível | F | 11 |
| painel-clientes | Clientes & Acesso | `werkos.html#/clientes` | oficina | convite do aplicativo por cliente | F | 12 |
| painel-mecanico | Equipe · papéis | `werkos.html?papel=mecanico` | mecânico | menu reduzido ao operacional | P | 13 |
| painel-equipe | Equipe | `werkos.html#/equipe` | gestor | criar, editar e remover acessos | F | — |
| painel-gestao | Gestão & DRE | `werkos.html#/gestao` | gestor | margem por OS, comissão, curva ABC | F | 14 |
| painel-config | Configurações | `werkos.html#/config` | admin | identidade, margens, garantia, Pix | F | 15 |
| painel-mobile | Painel no celular | `werkos.html#/kanban` | oficina | operação na mão | F | — |
| painel-checkin-mobile | Check-in no celular | `werkos.html#/checkin` | oficina | check-in em pé ao lado do carro | F | 16 |
| app-login | App · entrada | `app.html` | cliente | telefone + senha + biometria | F | 17 |
| app-inicio | App · início | `app.html` | cliente | estado do veículo e ação prioritária | F | 18 |
| app-os | App · ordens de serviço | `app.html` | cliente | acompanhamento e aprovação item a item | F | 19 |
| app-perfil | App · perfil e garagem | `app.html` | cliente | documentos, garantias, prontuário | F | 20 |
| app-agenda | App · agenda | `app.html` | cliente | marcar o próximo serviço | F | 21 |
| app-servicos | App · serviços | `app.html` | cliente | catálogo da oficina | F | — |
| doc-termo | Documento · termo de entrada | `documento.html?tipo=termo` | ambos | condição de entrada com foto e assinatura | F | 22 |
| doc-orcamento | Documento · orçamento | `documento.html?tipo=orcamento` | ambos | itens, alternativas e total | F | 23 |
| doc-os | Documento · OS completa | `documento.html?tipo=os` | ambos | histórico completo do serviço | F | — |

As telas sem número de slide entram no deck como material de apoio: estão capturadas,
prontas para uso, mas a narrativa comercial não abre um slide dedicado para elas.

## Fora do inventário

| Tela | Motivo |
|---|---|
| Raiz da plataforma (`index.html`) | cita a oficina-piloto como caso ao vivo |
| Land page do cliente (`oficina.html`) | contato da oficina-piloto fixo em `data.js` |
| Agendamento público (`agendamento.html`) | mesmo contato fixo |
| Painel central de administração (`admin.html`) | ferramenta interna, fora do discurso comercial |

As três primeiras voltam ao deck quando o contato virar white-label por oficina — item já
listado em "o que falta para produção", dentro da apresentação.
