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
| **5.2 Recepção** | Checklist de entrada; **até 5 fotos por O.S.**, no banco, com botão de câmera no celular (foto tirada na hora e reduzida no navegador antes de enviar); diagnóstico e observações do mecânico | OS-03, 04, 05 | ✅ |
| **5.3 Execução** | Mecânico por serviço, tela do mecânico (`/minhas-ordens-servico`), confirmação de execução por serviço, conclusão só com os serviços executados, solicitação de peça pelo mecânico | OS-10, 18, 21 (sem estoque), 22 | ✅ |
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
  └───────────────┴──── (já aprovada pelo cliente) ─────────────────────►┤
                                      └──► recusada                      └──► concluida ──► entregue (onda 5.4)
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
| Concluir | `em_execucao` | `concluida` | Nenhum item pendente do cliente, todo serviço aprovado com execução confirmada e nenhuma solicitação de peça sem resposta (§11); grava quem e quando. Terminal até a entrega |
| Entregar | | | Onda 5.4 |

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

## 10. Recepção e diagnóstico (onda 5.2)

Registram quem altera a O.S. (§7; o mecânico vinculado, com "O.S. editar"), enquanto ela está **em aberto**. Não
dependem da aprovação comercial pendente (que só trava itens e ações): o mecânico diagnostica mesmo com o desconto
em análise. Cada registro grava um evento no histórico e usa a versão lida (409 se outra pessoa salvou antes).

- **Checklist de entrada (OS-03):** lista de itens com o estado (**presente, ausente, avariado, não se aplica**) e
  observação opcional, mais o **nível de combustível** (reserva, 1/4, 1/2, 3/4, cheio) e as **avarias na entrada**
  (texto). A primeira vez começa com os itens sugeridos (`ITENS_CHECKLIST_PADRAO`: estepe, macaco, chave de roda,
  triângulo, rádio/som, tapetes, documento, calotas, antena, manual); dá para tirar e incluir outros, até 40, sem
  repetir nome. Cada registro regrava a lista inteira (`os_checklist`) e marca quando foi feito (`checklist_em`); o
  histórico resume o que faltou ou veio avariado. Lista configurável por oficina fica para quando houver pedido.
- **Fotos (OS-04):** **até 5 por O.S.** (decisão de 26/09/2026), com categoria **entrada, avaria ou execução**
  (entrega vem na onda 5.4). No celular, "Tirar foto" abre a câmera traseira; "Escolher foto" abre a galeria. O
  navegador reduz a foto para no máximo 1600 px em JPEG (nítida para mostrar uma avaria, em geral 200–500 KB) antes de
  enviar. A API valida o tipo pelos bytes (PNG, JPEG ou WebP), aceita até 1 MB e guarda no banco (`os_fotos`,
  `bytea`, como o logo; ARQUITETURA §9). O limite é contado com a O.S. travada: dois envios ao mesmo tempo não passam
  de 5. A imagem só é servida a quem vê a O.S. (o mecânico, só nas vinculadas). Remover apaga a foto e registra no
  histórico.
- **Diagnóstico (OS-05):** texto do diagnóstico técnico e das observações do mecânico (até 4000 caracteres), na
  própria O.S.; o histórico guarda o começo de cada versão.
- **API:** `PUT /:id/checklist`, `PUT /:id/diagnostico`, `POST /:id/fotos?categoria=&versao=` (a imagem no corpo),
  `GET /:id/fotos/:fotoId`, `DELETE /:id/fotos/:fotoId?versao=`.
- **Tela:** o detalhe da O.S. passa a ter abas: Serviços e produtos, Recepção (checklist), Fotos, Diagnóstico, Dados e
  mecânicos, Histórico.

## 11. Execução (onda 5.3)

- **Confirmação de execução por serviço (OS-22):** quem altera a O.S. (em geral o mecânico vinculado, com "O.S.
  editar") confirma cada serviço **aprovado** como executado, com a O.S. em execução ou aguardando peça; fica
  registrado quem e quando. "Desfazer" volta o serviço a executar (engano ou retrabalho), com registro no histórico.
  Serviço executado **não muda nem sai** na gravação dos itens (409): para corrigir, desfaz-se a execução antes. Produto
  não tem execução.
- **Mecânicos por serviço (OS-10):** um ou mais por serviço, entre os usuários ativos com função de mecânico.
  Atribuir um mecânico que ainda não está na O.S. também o vincula a ela (e ele passa a vê-la). Desvincular o mecânico
  da O.S. tira-o dos serviços dela. Regravar os itens mantém as atribuições dos serviços que continuam.
- **Solicitação de peça (OS-21, sem estoque nesta fase):** quem altera a O.S. pede a peça (descrição livre,
  quantidade e observação). Quem tem **"Peças na O.S." em Editar** (Atendente, Almoxarife, Administrador) responde:
  **atende** (e inclui a peça nos itens da O.S., pela aba Serviços e produtos) ou **recusa** com o motivo. O mecânico
  não responde. A ligação com o catálogo e a baixa no estoque vêm na Fase 6; "aguardando peça" continua manual.
- **Conclusão (OS-R11):** só de `em_execucao`, sem item pendente de aprovação do cliente, com ao menos um serviço,
  todos os serviços aprovados executados e nenhuma solicitação de peça pendente. A O.S. devolve a lista do que falta
  (`pendenciasConclusao`), a mesma que a API confere ao concluir (409 com o motivo). Concluída, sai das "em aberto" e
  nada mais muda até a entrega (onda 5.4).
- A aprovação comercial pendente (desconto) **não trava** a execução: confirmar serviço, atribuir mecânico e pedir
  peça continuam; só itens e mudanças de situação esperam a decisão.
- **Tela do mecânico (OS-18):** menu **Minhas O.S.** (`/minhas-ordens-servico`, só para o mecânico): as O.S. em
  aberto vinculadas a ele, em cartões grandes para o celular (número, situação, placa, cliente, previsão e peças
  pedidas). O cartão abre a O.S. já na aba **Execução**: um cartão por serviço (confirmar, desfazer, mecânicos) e as
  peças solicitadas. Para quem não é mecânico, a aba Execução fica ao lado de Serviços e produtos.
- **Lista de O.S.:** filtro "Com peça solicitada" e o selo de peças pedidas em cada O.S.
- **API:** `POST /:id/itens/:itemId/executar`, `POST /:id/itens/:itemId/desfazer-execucao`,
  `PUT /:id/itens/:itemId/mecanicos`, `POST /:id/solicitacoes-peca`,
  `POST /:id/solicitacoes-peca/:solicitacaoId/atender` e `.../recusar`, `POST /:id/concluir`; filtros `abertas` e
  `pecaPendente` na lista.
