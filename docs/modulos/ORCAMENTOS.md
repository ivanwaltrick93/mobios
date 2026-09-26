# Orçamentos (VEN-02)

Menu **Orçamentos**. Regras definidas com o dono do produto em 24/09/2026. Código: `packages/shared/src/orcamentos.ts`
(contas e schemas), `apps/api/src/modules/orcamentos/` (rotas e regras), `apps/web/src/pages/Orcamento*.tsx`.

## 1. Cabeçalho

| Campo | Regra |
|---|---|
| Número | `ORC-0000000001`: sequencial por oficina (contador `orcamentos`, na mesma transação; falhou, não consome). Imutável (trigger). |
| Versão | 1, 2, 3… Cada versão é um registro com o mesmo número (ver §4). |
| Cliente | Obrigatório. **Inativo ou com cadastro incompleto é aceito** (só no orçamento), com ícone de alerta ao lado do nome. A partir da **versão 2** o cliente não pode ser trocado (é o do orçamento original). |
| Veículo | Opcional (venda de peça no balcão). Se informado, precisa ser do cliente. |
| Vendedor | Obrigatório e **ativo** (manter o que o rascunho já tinha é permitido, mas a emissão exige ativo). |
| Tabela de preço | Obrigatória; vazia = a **tabela padrão** da oficina (já vem escolhida). Sem tabela padrão, não há orçamento. |
| Validade | Livre no rascunho. Na emissão: vazia = **7 dias**; de hoje até no máximo **30 dias**. |
| Observações | Opcional. |

A oportunidade (Fase 2) e a conversão em O.S. ou pedido de venda ainda não existem.

## 2. Itens

- **Material:** ativo e com "Permite venda". **Serviço:** ativo.
- Só entra item **com preço na tabela no dia** (vigência ou preço padrão). Sem preço, aparece na busca, mas não pode ser incluído.
- Código, descrição, unidade, múltiplo e preço de tabela ficam guardados no item (snapshot): mudar o cadastro ou a tabela depois não altera o orçamento, exceto pelos recálculos do §3.
- **Quantidade** arredondada **para cima**:
  - material: até o **múltiplo de venda** (caixa master); unidade inteira (UN, PC…) é sempre inteira; unidade fracionada (L, KG, M) com múltiplo 1 aceita a fração digitada (até 3 casas);
  - serviço de **preço fechado**: número inteiro;
  - serviço de **valor-hora**: horas:minutos em múltiplos das horas do serviço (serviço de 1:30 → 1:30, 3:00, 4:30…); o preço da tabela é o da hora.
  - na tela, botões **− e +** ao lado do campo sobem e descem de um múltiplo em um múltiplo (nunca abaixo de um; para tirar, a lixeira); o campo também aceita digitação, arredondada ao sair;
  - incluir um item que **já está** no orçamento soma um múltiplo à linha existente, em vez de criar outra.
- **Negociação só de material** (serviço não aceita):
  - por **percentual** (até 2 casas, até 100%): o desconto em centavos é arredondado **para cima** (a favor do cliente). Ex.: 10% de R$ 123,45 = R$ 12,35 → R$ 111,10;
  - ou digitando o **preço**, que só pode ficar **abaixo** do preço de tabela (ou igual);
  - a tela mostra o preço de tabela riscado, o negociado e o percentual: ~~R$ 125,00~~ R$ 112,50 −10%.
- Sem desconto no total do orçamento. **Alçada de desconto** (desde 25/09/2026): o desconto total acima da alçada de quem emite leva o orçamento à aprovação comercial (ver §4 e `docs/modulos/APROVACAO_COMERCIAL.md`). A cada gravação, o histórico registra quais descontos mudaram (*Descontos alterados*).
- Totais: bruto = preço de tabela × quantidade; total = preço negociado × quantidade (arredondado ao centavo); desconto = a diferença. A API sempre recalcula; o banco confere (CHECKs).
- O orçamento **não reserva estoque** (é só intenção de compra).

## 3. Recálculos de preço

- **Troca de tabela** (rascunho com itens): a tela pede confirmação numa janela e salva em seguida. No **orçamento novo, ainda não gravado**, a confirmação tira os itens (que são incluídos de novo com os preços da nova tabela). Todos os itens vão ao **preço cheio da nova tabela** (a negociação é desfeita); itens **sem preço** nela são **removidos**, com aviso.
- **Rascunho aberto em outro dia** (`precos_em` anterior a hoje): ao abrir, a tela chama `POST /orcamentos/:id/recalcular` com os preços do dia, na mesma tabela:
  - material que **ficou mais caro**: o preço de tabela passa a ser o novo, mas o cliente **mantém o valor que tinha**, com desconto (~~R$ 110,00~~ R$ 100,00 −9,09%);
  - material que **ficou mais barato**: fica o preço novo;
  - (nos dois casos vale o menor entre o valor que o cliente tinha e o preço novo);
  - **serviço**: sempre o preço novo, mais caro ou mais barato;
  - item **sem preço** no dia: removido;
  - a tela mostra o que mudou. Antes de recalcular, o rascunho não é alterado nem emitido (409).
- Orçamento emitido **nunca** é recalculado.

## 4. Situações e versões

```text
rascunho → emitido → enviado → aprovado
                   ↘        ↘ recusado
                     ↘        ↘ vencido (automático)
rascunho, emitido, enviado → cancelado

rascunho ─Emitir, desconto acima da alçada→ aguardando aprovação comercial
    aguardando → emitido (aprovado) | reprovado comercialmente (reprovado) | rascunho (pedido retirado) | cancelado
    reprovado comercialmente → nova versão | cancelado
```

- **Aprovação comercial** (`docs/modulos/APROVACAO_COMERCIAL.md`): ao emitir, se o desconto total (÷ subtotal) passa da alçada de quem emite, o orçamento fica *Aguardando aprovação comercial* (itens congelados) e só é emitido quando alguém com alçada aprova; a validade conta da aprovação. Reprovado, corrige-se com uma nova versão. Só quem pediu retira o pedido (volta a rascunho).

- Só o **rascunho** é editável. Depois de emitido, os itens não mudam (a API recusa e o trigger `orcamento_itens_so_no_rascunho` garante).
- **Vencido** não é gravado: emitido ou enviado vence sozinho **depois do dia seguinte ao da validade** (validade 30/09 → aprovável até 01/10, 23:59 de Brasília; vencido a partir de 02/10). Vencido não é alterado, aprovado nem reaberto: faz-se um orçamento novo.
- **Nova versão:** só de emitido ou enviado (não vencido). Cria um rascunho com o **mesmo número**, versão + 1, ligado ao anterior, com os mesmos itens e validade em branco; o anterior é **cancelado** ("Substituído pela versão N"). Só existe uma versão "viva" por número (índice `orcamentos_uma_versao_viva`), logo só a última pode ser aprovada. Recusado, vencido, cancelado e aprovado não geram versão.
- **Aprovação** e **recusa** (módulo *Aprovar orçamentos*): de emitido ou enviado, dentro da validade. Grava data, hora e o usuário; a recusa aceita um motivo (opcional). O canal da aprovação não é registrado.
- **Cancelamento:** de rascunho, emitido ou enviado, com motivo opcional.
- Todas as ações usam a versão do registro (409 se outra pessoa mudou antes) e ficam no **histórico** (`orcamentos_eventos`).
- Os estados não são parametrizáveis nesta fase.

## 5. Quem vê e quem altera (decisão de 25/09/2026)

| Usuário | Vê | Cria, edita, emite, envia, nova versão, cancela | Aprova e recusa | Vendedor do orçamento | Início (KPIs de orçamento) |
|---|---|---|---|---|---|
| **Administrador** | Todos | Sim | Todos | Escolhe; filtro por vendedor livre | Oficina inteira |
| **Vendedor ativo** (cadastro em Equipe → Vendedores, não Administrador) | Só os próprios | Sim, nos próprios, **seja qual for a função** | Só os próprios, se a função tiver *Aprovar orçamentos* | Fixo nele (não escolhe); filtro fixo nele | Só os próprios |
| **Demais** (ex.: Financeiro, Mecânico, Atendente sem cadastro de vendedor) | Todos, se a função consulta *Orçamentos* | **Não** (só consultam, mesmo com "Editar" na matriz) | Todos, se a função tiver *Aprovar orçamentos* | — | Oficina inteira |

- Orçamento de outro vendedor responde como inexistente (404) para o vendedor, em qualquer rota.
- A sessão (`GET /api/auth/sessao`) informa `vendedorId`; a tela usa `usePerfilOrcamento()` (`lib/sessao.ts`) só para esconder o que a API já bloqueia.
- Vendedor inativado deixa de atuar como vendedor: passa à regra dos "demais".
- As buscas da tela (clientes, veículos, vendedores, tabelas, itens com preço) ficam em `/api/orcamentos/apoio/*`, para não exigir acesso aos módulos Clientes, Preços ou à Equipe.
- **Escolha do cliente:** janela que já abre listando os clientes **ativos** (10 por página), com colunas Nome, Tipo, CPF/CNPJ, Telefone, Cidade, Placas e Situação; filtros Situação e Tipo; busca por nome, CPF/CNPJ, telefone ou placa. Clicar na linha escolhe. Com a busca vazia, mostra no topo até 5 **recentes**: os clientes dos últimos orçamentos do vendedor (da oficina, para o Administrador), calculados dos orçamentos (`GET /orcamentos/apoio/clientes/recentes`).
- **Card do cliente** (novo orçamento e edição, decisão de 25/09/2026): iniciais, nome com os alertas, tipo, CPF/CNPJ e cidade/UF; resumo com o **último orçamento aprovado** (data e valor), cliente desde e contato. Ações: 👁 **Visualizar cliente** (gaveta lateral, sem sair do orçamento: identificação, contato, endereço principal, veículos e os 5 últimos orçamentos, com link para o cadastro completo só para quem acessa Clientes) e **Alterar**. Dados de `GET /orcamentos/apoio/clientes/:id/contexto`; para o vendedor, orçamentos e último aprovado são só os dele. **Limite de crédito e última compra não existem no MobiOS** (virão com o Financeiro e as vendas); o cliente não tem código.
- **Jornada do orçamento** (decisões de 25/09/2026): três etapas com um indicador no topo (etapa atual; concluídas com ✓ e clicáveis; cada uma com o seu resumo: o cliente, "2 itens · total"):
  1. **Cliente** — card do cliente, veículo, vendedor, tabela, validade e observações. No orçamento novo, **"Continuar para produtos" cria o rascunho** (POST, com o número ORC) e abre a edição dele (`/orcamentos/:id/editar`); rascunho abandonado fica na lista e pode ser cancelado.
  2. **Produtos e serviços** — filtro **Todos | Materiais | Serviços** (campo `tipo` do catálogo; parâmetro `tipo` de `/orcamentos/apoio/itens`; só da tela), busca (a partir de 2 letras; preço de tabela e, no material, o **estoque livre** somado dos depósitos) e a tabela de itens, na largura toda. Serviço mostra "— Não negociável". "Revisar orçamento →" exige **ao menos um item** (regra só da tela) e negociação válida.
  3. **Revisão** — cliente, itens, condições comerciais e valores. **"Finalizar"** leva ao resumo; o orçamento **continua rascunho** (a emissão, com a avaliação da alçada, é no resumo).
  - **Resumo em faixa** entre as etapas e os itens: cliente, itens, subtotal, descontos, **total**, o aviso da alçada do desconto total e o estado da gravação.
  - **Gravação automática do rascunho**: cada alteração (cliente, cabeçalho, incluir, quantidade, negociação, remover) é gravada com o `PUT` do rascunho — incluir e remover na hora; digitação após ~0,8 s de pausa —, uma gravação por vez, sempre com a versão lida (409 se outra pessoa gravou antes). Os ids devolvidos passam às linhas (nada é criado duas vezes). Linha com negociação inválida ou sem quantidade espera ser corrigida ("Corrija a negociação para salvar"). Estado: "Salvando…", "Salvo às hh:mm" ou "Não foi possível salvar — Tentar de novo". Com `automatico: true` a API não registra "Alterado" no histórico (seriam dezenas), mas continua registrando **"Descontos alterados"**. Atualizar a página ou voltar ao orçamento recupera tudo; sair com gravação pendente pede confirmação.
  - **Troca de tabela com itens**: confirmação; a API reprecifica ao gravar (preço cheio; sem preço, sai) e a jornada mostra os avisos.
- **Resumo e edição** mostram no topo: data de emissão ("Não emitido" no rascunho), validade, tabela de preço, veículo e vendedor.

## 6. Fora desta fase

Impressão/PDF, link público para o cliente aprovar, WhatsApp, reserva de estoque, oportunidade (Fase 2), conversão em O.S. (peças e/ou serviços) ou em pedido de venda (só peças).
