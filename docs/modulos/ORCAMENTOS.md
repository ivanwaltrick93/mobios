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
- Sem desconto no total do orçamento; sem limite de desconto por enquanto (a alçada virá depois).
- Totais: bruto = preço de tabela × quantidade; total = preço negociado × quantidade (arredondado ao centavo); desconto = a diferença. A API sempre recalcula; o banco confere (CHECKs).
- O orçamento **não reserva estoque** (é só intenção de compra).

## 3. Recálculos de preço

- **Troca de tabela** (rascunho com itens): a tela pede confirmação numa janela e salva em seguida. Todos os itens vão ao **preço cheio da nova tabela** (a negociação é desfeita); itens **sem preço** nela são **removidos**, com aviso.
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
```

- Só o **rascunho** é editável. Depois de emitido, os itens não mudam (a API recusa e o trigger `orcamento_itens_so_no_rascunho` garante).
- **Vencido** não é gravado: emitido ou enviado vence sozinho **depois do dia seguinte ao da validade** (validade 30/09 → aprovável até 01/10, 23:59 de Brasília; vencido a partir de 02/10). Vencido não é alterado, aprovado nem reaberto: faz-se um orçamento novo.
- **Nova versão:** só de emitido ou enviado (não vencido). Cria um rascunho com o **mesmo número**, versão + 1, ligado ao anterior, com os mesmos itens e validade em branco; o anterior é **cancelado** ("Substituído pela versão N"). Só existe uma versão "viva" por número (índice `orcamentos_uma_versao_viva`), logo só a última pode ser aprovada. Recusado, vencido, cancelado e aprovado não geram versão.
- **Aprovação** e **recusa** (módulo *Aprovar orçamentos*): de emitido ou enviado, dentro da validade. Grava data, hora e o usuário; a recusa aceita um motivo (opcional). O canal da aprovação não é registrado.
- **Cancelamento:** de rascunho, emitido ou enviado, com motivo opcional.
- Todas as ações usam a versão do registro (409 se outra pessoa mudou antes) e ficam no **histórico** (`orcamentos_eventos`).
- Os estados não são parametrizáveis nesta fase.

## 5. Permissões

| Módulo | Nível | O que libera |
|---|---|---|
| Orçamentos | Consultar | Lista e detalhe |
| Orçamentos | Editar | Criar, alterar rascunho, recalcular, emitir, marcar como enviado, nova versão, cancelar |
| Aprovar orçamentos | Editar | Aprovar e recusar |

Padrão: Administrador, Atendente e Financeiro editam e aprovam; Mecânico e Almoxarife consultam. Ser vendedor não dá permissão (vale só a matriz). As buscas da tela (clientes, veículos, vendedores, tabelas, itens com preço) ficam em `/api/orcamentos/apoio/*`, para não exigir acesso aos módulos Clientes, Preços ou à Equipe.

## 6. Fora desta fase

Impressão/PDF, link público para o cliente aprovar, WhatsApp, reserva de estoque, alçada de desconto, oportunidade (Fase 2), conversão em O.S. (peças e/ou serviços) ou em pedido de venda (só peças).
