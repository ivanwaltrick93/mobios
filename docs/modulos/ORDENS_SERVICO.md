# Ordens de Serviço (Fase 5 — OS-01 a OS-23)

Especificação de origem: `docs/roadmap/FASE-5-ORDEM-DE-SERVICO.md` (MOB-OS-01) e o adendo de conversão
(MOB-OS-01-ADENDO-CONVERSAO, regras CV em [ORCAMENTOS.md §6](ORCAMENTOS.md)). **Este documento registra as decisões
do dono do produto (26/09/2026) e prevalece sobre a especificação onde elas divergem.**

A O.S. é o registro operacional durável da passagem do veículo pela oficina: preserva cliente, veículo, vendedor,
orçamento de origem e o retrato dos itens, mesmo que os cadastros mudem depois.

## 1. Ondas

A Fase 5 é entregue em ondas, cada uma fechada e testada. Para começar a próxima, basta pedir "pode começar a onda N".

| Onda | Conteúdo | Entregáveis | Situação |
|---|---|---|---|
| **5.1 Núcleo** | Tabelas, número, abertura no balcão, conversão do orçamento, itens (catálogo e avulsos) com negociação e alçada, situações e histórico, vínculo de mecânicos, lista e detalhe, "O.S. em aberto" no Início | OS-01, 02, 06, 08 (total), 09, 23; vínculo de OS-10 | ✅ |
| **5.2 Recepção** | Checklist de entrada; **até 5 fotos por O.S.**, no banco, com botão de câmera no celular (foto tirada na hora e reduzida no navegador antes de enviar); diagnóstico e observações do mecânico | OS-03, 04, 05 | ⚪ |
| **5.3 Execução** | Mecânico por serviço, tela do mecânico (`/minhas-ordens-servico`), confirmação de execução por serviço, conclusão só com os serviços executados, solicitação de peça pelo mecânico | OS-10, 18, 21 (sem estoque), 22 | ⚪ |
| **5.4 Entrega e documentos** | Entrega com km de saída e termo; **PDF gerado no servidor** (pdfmake, MIT; fonte Inter, SIL OFL) em layout moderno; previsão de entrega e O.S. atrasadas; orçamento adicional dentro da O.S. (OS-12) | OS-12, 13, 14, 17 | ⚪ |

Fora da Fase 5: reserva e baixa de estoque (Fase 6), compras (Fase 7), financeiro, garantia, apontamento de horas,
kanban e assinatura digital.

## 2. Decisões de 26/09/2026

| Tema | Decisão |
|---|---|
| Aprovação | **Total.** O orçamento é aprovado inteiro; a O.S. aprovada pelo cliente aprova todos os itens pendentes. Aprovação parcial por item fica para depois (a coluna `aprovacao` de `os_itens` já existe; `recusado` fica reservado). |
| O.S. convertida | Nasce **aberta**, com os itens do orçamento já **aprovados** (o cliente aprovou o orçamento). |
| Itens novos | Numa O.S. já aprovada pelo cliente (convertida, ou aprovada depois de aberta no balcão), itens novos **entram direto, aprovados**. Na O.S. aberta no balcão, antes da aprovação do cliente, entram **pendentes**. |
| Tabela de preço | A do orçamento de origem; na O.S. aberta no balcão, a **padrão** da oficina. Não se troca depois. |
| Negociação e alçada | Como no orçamento: desconto só em produto do catálogo, nunca acima do preço de tabela, e **alçada por item**, decidida na mesma tela de Aprovações comerciais, que mostra o tipo do documento (**Orçamento** ou **O.S.**). |
| Avulsos | **Só na O.S.** (o orçamento continua só com catálogo). Ver §5. |
| Mecânico | Função com o parâmetro **MECÂNICO** (Configurações → Funções), como o VENDEDOR. A função padrão Mecânico já vem com ele. |
| Visibilidade | Administrador e **qualquer vendedor** veem todas as O.S.; o **mecânico** (sem ser Administrador nem vendedor) vê **só as vinculadas a ele**; os demais, todas, conforme o módulo O.S. |
| Vendedor | Converte **só os próprios** orçamentos; o Administrador converte qualquer um. O vendedor **edita a O.S.** de que é o vendedor, mesmo sem "O.S. editar" na função. |

## 3. Situações

```text
aberta ──► em_diagnostico ──► aguardando_aprovacao ──► aprovada ──► em_execucao ◄──► aguardando_peca
  │               │                   │                                  │
  └───────────────┴──── (já aprovada pelo cliente) ─────────────────────►┘          concluida ──► entregue
                                      └──► recusada                                   (ondas 5.3 e 5.4)
Qualquer situação em aberto ──► cancelada (motivo obrigatório)
```

| Ação | De | Para | Regra |
|---|---|---|---|
| Abrir no balcão / converter | — | `aberta` | §4 e ORCAMENTOS §6 |
| Iniciar diagnóstico | `aberta` | `em_diagnostico` | |
| Solicitar aprovação do cliente | `aberta`, `em_diagnostico` | `aguardando_aprovacao` | Há itens pendentes; sem aprovação comercial pendente |
| Aprovar (cliente) | `aguardando_aprovacao` | `aprovada` | Todos os itens pendentes ficam aprovados; grava quem e quando |
| Recusar (cliente) | `aguardando_aprovacao` | `recusada` | Motivo opcional. Terminal |
| Iniciar execução | `aberta`, `em_diagnostico`, `aprovada` | `em_execucao` | Ao menos um item; nenhum pendente; sem aprovação comercial pendente |
| Aguardar peça / retomar | `em_execucao` ↔ `aguardando_peca` | | Manual nesta onda (compras virão na Fase 7) |
| Cancelar | qualquer em aberto | `cancelada` | Motivo obrigatório; cancela a aprovação comercial pendente. Terminal |
| Concluir / entregar | | | Ondas 5.3 e 5.4 |

Toda mudança grava um evento no histórico da O.S. (`os_eventos`, que o banco impede de alterar ou apagar), com
situação anterior e nova, quem e quando. Transição inválida: 409, mesmo que a tela não mostre a ação.

## 4. Abertura no balcão (OS-02)

Cliente, veículo do cliente (obrigatório), km de entrada (obrigatório, inteiro ≥ 0), relato do cliente, vendedor
(opcional; o vendedor logado já vem escolhido) e previsão de entrega (opcional). Bloqueios (400, com o motivo):
cliente inativo, cadastro do cliente incompleto, veículo de outro cliente, veículo vendido ou inativo, veículo com
cadastro incompleto, vendedor inativo. Ao abrir, o veículo recebe `ultima_visita` = hoje e `km_atual` = o maior entre
o atual e o de entrada. Número sequencial por oficina (`OS-000001`), gerado no banco na mesma transação (contador
`ordens_servico`); duas aberturas simultâneas nunca repetem número.

## 5. Itens

- **Do catálogo:** serviço ativo; produto ativo com **"Permite uso em O.S."**. Preço da tabela da O.S. no dia da
  inclusão, guardado como retrato (código, descrição, unidade, múltiplo, quantidade ou horas, preço de tabela, preço
  negociado, desconto, totais e PMC congelado). Quantidade arredondada ao múltiplo, como no orçamento. Negociação só de
  produto, por percentual ou preço digitado, nunca acima da tabela.
- **Avulsos** (item digitado na hora, sem cadastro):
  - **Serviço avulso:** descrição, forma de preço (fechado ou por hora) e preço digitado (por hora: horas e valor-hora).
  - **Peça avulsa:** descrição, unidade, quantidade e preço digitado.
  - Sem desconto nem alçada (o preço digitado é o final), sem estoque, PMC ou margem.
- **Quem inclui:** quem altera a O.S. (§7). Produto do catálogo e peça avulsa exigem também **"Peças na O.S." em
  Editar** (OS-R16); o Administrador pode tudo.
- A conversão copia os itens do orçamento como estão (retrato), mesmo que o produto não tenha "Permite uso em O.S.".
- **Alçada** (decisão de implementação, ver §2): avaliada ao **salvar os itens**, para os itens cujo desconto
  **mudou** e passou da alçada de quem salvou. Os itens são gravados, e a O.S. fica com um pedido de **aprovação
  comercial** pendente (tipo O.S.): enquanto ele não é decidido, nenhum item muda e nenhuma ação anda (só cancelar).
  Aprovado: segue. Reprovado: os itens acima da alçada de quem pediu **voltam ao preço de tabela**, com registro no
  histórico. O retrato do pedido tem a O.S., os itens e a margem, como no orçamento.

## 6. Mecânicos

Um ou mais mecânicos por O.S. (`os_mecanicos`), escolhidos entre os usuários ativos com uma função ativa que tem o
parâmetro MECÂNICO. Vincular e desvincular: quem altera a O.S. O mecânico só vê (e só altera, se a função tiver
"O.S. editar") as O.S. vinculadas a ele. Mecânico por serviço e a tela do mecânico: onda 5.3.

## 7. Quem vê e quem altera

| Usuário | Vê | Abre no balcão | Altera (itens, mecânicos, situação) | Converte orçamento |
|---|---|---|---|---|
| Administrador | Todas | Sim | Todas | Qualquer um |
| Vendedor ativo | Todas | Com "O.S. editar" | As em que é o vendedor; as demais, com "O.S. editar" | Só os próprios |
| Mecânico (parâmetro MECÂNICO, sem ser Administrador nem vendedor) | Só as vinculadas | Com "O.S. editar" | As vinculadas, com "O.S. editar" | Não |
| Demais | Todas, com "O.S." | Com "O.S. editar" | Com "O.S. editar" | Não |

O.S. que o usuário não pode ver responde 404 em qualquer rota. A API é a autoridade; a tela só esconde.

## 8. API (onda 5.1)

- `GET /api/ordens-servico` (paginada; filtros `q` — número, cliente ou placa —, `situacao`, `clienteId`,
  `veiculoId`, `vendedorId`, `mecanicoId`, `desde`, `ate`), `GET /:id`, `POST /` (abertura), `PUT /:id` (cabeçalho:
  relato, observações, previsão, vendedor), `PUT /:id/itens` (itens, com a versão lida).
- Ações (`POST /:id/<ação>`, com a versão lida): `iniciar-diagnostico`, `solicitar-aprovacao`, `aprovar`, `recusar`,
  `iniciar-execucao`, `aguardar-peca`, `retomar`, `cancelar`.
- Mecânicos: `POST /:id/mecanicos`, `DELETE /:id/mecanicos/:usuarioId`; apoio: `GET /apoio/mecanicos`,
  `GET /apoio/itens` (catálogo com o preço da tabela da O.S.).
- Conversão: `POST /api/orcamentos/:id/converter` → `{ destino: 'ordem_servico', ordemServicoId }`.

## 9. Telas (onda 5.1)

- **Lista** (`/os`): número, cliente, placa, vendedor, mecânicos, situação, previsão, total e data; busca e filtros
  no padrão das listas.
- **Nova O.S.** (`/os/nova`): cliente e veículo → km e relato → confirmar.
- **Detalhe** (`/os/:id`): cabeçalho (número, cliente, placa, situação, previsão, total, orçamento de origem),
  ações conforme a situação e as permissões, itens (catálogo com negociação e avulsos, salvar explícito), mecânicos
  e histórico.
- **Orçamento aprovado:** "Converter em O.S." (janela para o veículo, se faltar, o km e o relato); convertido, vira
  link para a O.S.
- **Aprovações comerciais:** coluna e selo do tipo de documento (Orçamento ou O.S.).
- **Início:** "O.S. em aberto" (as que o usuário vê, fora concluídas, entregues, recusadas e canceladas).
