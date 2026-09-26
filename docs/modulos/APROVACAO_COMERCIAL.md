# Aprovação comercial por alçada (Fase 6)

Menus **Aprovações comerciais** e **Configurações → Alçadas de desconto**. Regras definidas com o dono do produto em
25/09/2026 (todas as recomendações da análise da Fase 6 aceitas). Código: `packages/shared/src/aprovacoes.ts` (contas e
schemas), `apps/api/src/lib/aprovacao-comercial.ts` (motor), `apps/api/src/modules/aprovacoes-comerciais/` e
`apps/api/src/modules/alcadas/` (rotas), `apps/api/src/modules/orcamentos/aprovacao.ts` (adaptador do Orçamento),
`apps/web/src/pages/AprovacoesComerciais.tsx`, `AprovacaoComercialDetalhe.tsx` e `Alcadas.tsx`.

> **Pedido de Venda e O.S. ainda não existem no MobiOS.** Nesta fase só o **Orçamento** está ligado ao motor. A alçada,
> as tabelas, as rotas, as permissões e a tela já são genéricas (tipo de documento): quando o Pedido de Venda e a O.S.
> forem construídos, eles se ligam ao motor com um **adaptador** próprio (§10), sem mudar o motor nem as regras.
> Os critérios de aceite que pedem Pedido de Venda e O.S. usando o motor ficam **adiados** para essas fases.

**Fora do escopo** (não há nada disso no código): autorização de serviço pelo cliente, aprovação de execução de O.S.,
aceite técnico, aprovação pública ou pelo cliente, assinatura eletrônica, aprovação de compra, financeira ou de estoque
e workflow genérico de outros tipos de aprovação. A aprovação e a recusa **do cliente** no Orçamento (módulo
*Aprovar orçamentos*) continuam como estavam e não têm relação com este módulo.

## 1. Arquitetura

```text
 Documento (hoje: Orçamento)             Motor (lib/aprovacao-comercial.ts)          Tela
 ───────────────────────────             ─────────────────────────────────           ────
 Emitir ── percentual × alçada ──┐
                                 ├─ dentro → emite normalmente
                                 └─ acima → solicitarAprovacao() ──► aprovacoes_comerciais (retrato)
                                            (bloqueia se ninguém         └─ eventos (linha do tempo)
                                             tem alçada)                          │
 Adaptador do documento  ◄── decidirAprovacao() ◄── POST /aprovar | /reprovar ◄── Aprovações comerciais
 (conferir, aoAprovar, aoReprovar)
```

- O **motor** não conhece regra de documento: calcula a alçada do usuário, cria a solicitação com o retrato, cancela,
  confere quem pode decidir e registra a decisão.
- Cada **documento** avalia a alçada na própria ação (no Orçamento, a emissão), pede a aprovação ao motor e fornece um
  **adaptador** para conferir o documento e aplicar a decisão (§10).
- Tudo roda na transação da ação, com as travas descritas em §13.

## 2. Modelo ER

```text
funcoes 1 ──── 0..1 alcadas_desconto                (percentual em centésimos, ativa; sem linha = 0%)
funcoes 1 ──── * alcadas_desconto_eventos           (antes/depois, quem, quando; só inclusão)

orcamentos 1 ── * aprovacoes_comerciais             (uma por emissão acima da alçada; no máximo 1 pendente)
                    ├── documento: tipo_documento + orcamento_id (depois: pedido_venda_id, os_id)
                    ├── documento_numero, documento_versao, cliente_nome
                    ├── subtotal, desconto, total, percentual
                    ├── solicitante_id, solicitante_funcao, alcada_solicitante
                    ├── status, decidido_por, decisor_funcao, alcada_decisor, decidido_em, justificativa
                    ├── snapshot jsonb (retrato)
                    └── versao (concorrência)
aprovacoes_comerciais 1 ── * aprovacoes_comerciais_eventos   (linha do tempo; só inclusão)
```

- **Uma coluna por tipo de documento**, e não um id genérico, para manter a FK composta `(tenant_id, x_id)` exigida em
  todo o projeto. O CHECK `aprovacoes_comerciais_documento` garante exatamente um documento.
- **Retrato numa coluna jsonb** da própria solicitação (1:1), e os valores principais em colunas, para filtrar e
  ordenar.
- **Tabelas novas** (todas com `tenant_id` e RLS): `alcadas_desconto`, `alcadas_desconto_eventos`,
  `aprovacoes_comerciais` e `aprovacoes_comerciais_eventos`. Migração `0025_aprovacao_comercial`.

## 3. Máquina de estados

**Solicitação:**

```text
pendente ──► aprovada     (quem tem alçada ≥ percentual e a permissão; nunca o solicitante)
         ├─► reprovada    (idem, com justificativa obrigatória)
         └─► cancelada    (o solicitante retira; o documento é cancelado)
```

Decidida (aprovada, reprovada ou cancelada), não muda mais.

**Orçamento** (as situações novas estão marcadas com ★; as demais não mudaram):

```text
rascunho ──Emitir──► [desconto ≤ alçada] ──────────────────────────► emitido → enviado → aprovado/recusado/vencido
         └─Emitir──► [desconto > alçada] ► ★ aguardando aprovação comercial
                                               ├─ aprovado pelo decisor ──► emitido (validade conta de hoje)
                                               ├─ reprovado ──► ★ reprovado comercialmente ─► nova versão | cancelar
                                               ├─ retirado pelo solicitante ──► rascunho
                                               └─ cancelado ──► cancelado (a solicitação é cancelada junto)
```

- **"Aprovado comercialmente" não é uma situação.** O orçamento aprovado segue para *Emitido*, com o aviso "Aprovado
  comercialmente por… em…". Assim não há duas palavras "Aprovado" (a do cliente e a comercial) na mesma lista.
- **Aguardando:**
  - os itens ficam congelados (a API recusa e o trigger `orcamento_itens_so_no_rascunho` garante);
  - não se edita, não se envia e não se registra a decisão do cliente;
  - não vence.
- **Reprovado comercialmente:** só aceita nova versão (que nasce rascunho e é reavaliada na emissão) ou cancelamento.

## 4. Modelo de alçadas

- A **alçada** é o percentual máximo de desconto que a função concede sem aprovação. É configurada por função em
  **Configurações → Alçadas de desconto**, só pelo Administrador, com até 2 casas decimais, de 0% a 100%, e pode ficar
  **ativa** ou **inativa**.
- **Alçada do usuário:**
  - é a **maior** entre as funções **ativas** dele, a mesma regra das permissões;
  - função sem alçada configurada, ou com ela inativa, vale **0%**;
  - a função que concede a alçada é registrada junto (empate: a primeira em ordem alfabética).
- **Valores iniciais** (migração e toda oficina nova): **Administrador 100%**; as demais funções ficam sem alçada, ou
  seja, 0%. **Ajuste as alçadas antes de usar:** com 0%, qualquer desconto de vendedor pede aprovação.
- **Quem pode aprovar:** alçada **maior ou igual** ao percentual pedido **e** o módulo *Aprovação comercial* em
  *Editar* (o Administrador tem sempre). Não há cadeia de aprovadores nem aprovador escolhido: basta uma decisão de
  quem tem alçada.
- Mudar uma alçada vale para as próximas emissões e decisões. O que já foi pedido ou decidido guarda a alçada do
  momento.
- Toda mudança fica no histórico (`alcadas_desconto_eventos`): antes, depois, quem e quando. A função com histórico
  de alçada não pode mais ser excluída, só inativada.

## 5. Regras de negócio

| Regra | Como está implementada |
|---|---|
| **Percentual por item** (decisão de 25/09/2026, substitui o do total) | A alçada é **sempre avaliada por item, nunca pelo total** — no total, um item caro sem desconto diluía o desconto alto de outro. Percentual de cada item (`percentualDoItem`): desconto digitado em %, vale o digitado (os centavos são arredondados a favor do cliente e 15% viraria 15,01%); preço digitado ou desconto criado pelo recálculo (preço subiu e o cliente manteve o valor), o efetivo sobre o preço de tabela, arredondado para cima em centésimos. Serviço não tem desconto. **Qualquer item acima da alçada** manda o orçamento para aprovação, e a alçada necessária para aprovar é o **maior percentual entre os itens** (coluna `percentual` da solicitação; o retrato guarda o percentual de cada item e quais passaram). Solicitações e orçamentos anteriores à mudança não foram reavaliados. |
| **Quando avalia** | Na **emissão** do Orçamento, com a alçada de **quem emite** (não a do vendedor do orçamento). |
| RN-01 | Desconto **igual ou menor** que a alçada: emite normalmente, sem solicitação. |
| RN-02 | Acima da alçada: a solicitação nasce sozinha na emissão. Não existe rota para criar solicitação à mão. |
| RN-03 | O orçamento fica *Aguardando aprovação comercial*, com o motivo à vista (§7). |
| RN-04 | Sem alçada suficiente, sem a permissão, ou sendo o próprio solicitante: não decide (403). |
| RN-05 | A API confere tudo de novo na decisão: situação, versão lida, solicitante, alçada do momento e se o documento continua aguardando com os mesmos valores. |
| RN-06 | Decidida não se decide de novo (409). |
| RN-07, RN-08 | A aprovação é presa ao **registro da versão**. A nova versão nasce sem aprovação e é reavaliada ao emitir. A aprovação da versão anterior continua no histórico. |
| RN-09 | Solicitação e eventos não são apagados; os eventos não são alterados (§12). |
| RN-10 a RN-12 | Alçada do solicitante e do decisor, valores e percentual ficam gravados na solicitação e nos eventos. |
| RN-13 | A reprovação exige justificativa (até 500 caracteres; em branco é recusada, e o banco confere). |
| RN-14 | Permissões do RBAC existente (§9). |
| **Ninguém pode aprovar** | Se nenhum usuário ativo com a permissão (fora o solicitante) tem alçada para o percentual, a emissão é **recusada** (400) com a maior alçada disponível, e nada é criado. |
| **Retirar** | Só o solicitante retira a solicitação pendente; o orçamento volta a rascunho, para ajustar o desconto. |
| **Cancelar** | Cancelar o orçamento aguardando cancela a solicitação junto. |
| **Validade** | A validade pedida (vazia = 7 dias) é guardada em dias no retrato e **passa a contar da aprovação**. |
| **Já emitidos** | Orçamentos emitidos antes desta fase não são reavaliados. |

## 6. Fluxo de aprovação

1. O vendedor monta o rascunho com desconto. A tela destaca, com contorno laranja e um ícone de atenção (dica: "passará por aprovação comercial ao emitir"), cada item cujo desconto passa da alçada dele — na tabela de itens e na revisão — (`GET /api/alcadas/minha`), e a cada gravação o histórico registra quais descontos mudaram, quem e quando (evento *Descontos alterados*).
2. **Emitir:** a API calcula o percentual e a alçada de quem emite.
   - Dentro da alçada: o orçamento é emitido.
   - Acima da alçada: é criada a solicitação (eventos *Aprovação necessária* e *Aprovação solicitada*), o orçamento fica aguardando e o histórico do orçamento registra *Enviado para aprovação comercial*.
3. **Quem aprova** vê a solicitação:
   - no alerta do **Início**;
   - no menu **Aprovações comerciais** (filtro "Só as que posso aprovar").

   A partir dali, abre o **retrato** e decide.
4. **Aprovar:** o orçamento é emitido nesse momento, com a validade contando de hoje (eventos *Aprovado comercialmente* e *Emitido*). **Reprovar:** o orçamento fica *Reprovado comercialmente*, com o motivo; para corrigir, o vendedor gera uma nova versão.

## 7. Indicador visual

- **Selos das situações:** *Aguardando aprovação comercial* em amarelo (alerta) e *Reprovado comercialmente* em
  vermelho, na lista de orçamentos, nas versões e no gráfico do Início.
- **No resumo do orçamento**, uma caixa com o motivo, sem precisar abrir outra tela:
  - **Aguardando:** "⚠ Aguardando aprovação comercial — Motivo: Desconto de até 15,00% por item excede a alçada de 5,00% (Atendente). Pedido por… em…".
  - **Reprovado:** quem reprovou (função e alçada), quando e a justificativa.
  - **Aprovado:** "Aprovado comercialmente — desconto de 15,00% aprovado por João (Gerente, alçada de 15,00%) em…".
- **Na confirmação de "Emitir":** o aviso de que o orçamento vai para aprovação.

## 8. APIs

| Método e rota | Quem | O quê |
|---|---|---|
| `GET /api/aprovacoes-comerciais` | *Aprovação comercial* ≥ Consultar | Lista paginada. Filtros: `status` (padrão `pendente`; vazio = todas), `tipo`, `q` (número ou cliente) e `posso=true` (pendentes que o usuário pode decidir). |
| `GET /api/aprovacoes-comerciais/:id` | idem | Detalhe com retrato, linha do tempo, funções que aprovam, `podeDecidir` e `motivoBloqueio`. |
| `POST /api/aprovacoes-comerciais/:id/aprovar` | *Aprovação comercial* = Editar e alçada | `{ versao }`. |
| `POST /api/aprovacoes-comerciais/:id/reprovar` | idem | `{ versao, justificativa }`. |
| `POST /api/orcamentos/:id/retirar-aprovacao` | o solicitante (que altera o orçamento) | `{ versao }`. A retirada é feita pelo documento. |
| `GET /api/alcadas/minha` | qualquer usuário logado | A alçada do usuário (`{ percentual, funcao }`). |
| `GET /api/alcadas` · `PUT /api/alcadas/:funcaoId` | Administrador | Lista das funções com a alçada; define `{ percentual, ativa, versao }` (versão `null` na primeira vez). |
| `GET /api/alcadas/historico` | Administrador | As 200 mudanças mais recentes. |

Mudanças nas rotas existentes do Orçamento:

- `POST /emitir` pode devolver o orçamento *aguardando*;
- `/cancelar` e `/nova-versao` aceitam as situações novas;
- `GET /:id` traz `aprovacaoComercial`, a solicitação mais recente desta versão.

Percentuais em **centésimos** nas respostas (8,5% = 850). Na entrada da alçada, em percentual (7,5).

## 9. Permissões

| Conceito da especificação | No MobiOS |
|---|---|
| VIEW, HISTORY | Módulo **Aprovação comercial** em *Consultar* (menu, lista, retrato e linha do tempo). |
| APPROVE, REJECT | Módulo **Aprovação comercial** em *Editar*, limitado pela alçada da função. |
| CREATE | Não há permissão: a solicitação nasce sozinha na emissão, feita por quem altera o orçamento (Administrador ou vendedor, `ORCAMENTOS.md` §5). |
| CANCEL | O solicitante, pelo orçamento; ou o cancelamento do orçamento. |
| LIMIT_CONFIG | Só o Administrador, como Funções e permissões. |

- **Funções padrão:** nenhuma função padrão recebe o módulo novo; o Administrador tem acesso total. Para ter um
  aprovador, crie ou ajuste a função (ex.: *Gerente*) com *Aprovação comercial* em *Editar* e dê a ela uma alçada.
- **O que cada um enxerga na área de aprovações:**
  - o **vendedor** (não Administrador) que também tem o módulo vê as próprias solicitações, as dos orçamentos dele,
    as que decidiu e as pendentes que a alçada dele cobre, mas continua sem abrir os orçamentos de outros vendedores
    (o retrato basta para decidir);
  - os demais com o módulo veem todas.

## 10. Integrações

**Orçamento (feito):**
- Adaptador `adaptadorOrcamento` (`modules/orcamentos/aprovacao.ts`):
  - `conferir` trava o orçamento e exige que ele esteja *aguardando* com o mesmo subtotal e desconto;
  - `aoAprovar` emite (validade = hoje + dias pedidos; `emitido_por` = solicitante);
  - `aoReprovar` passa a *reprovado comercialmente*.
- Retrato: `snapshotDoOrcamento`.

**Pedido de Venda (futuro):**
- Quando existir, o módulo:
  1. acrescenta `pedido_venda` em `TIPOS_DOCUMENTO_COMERCIAL`, a coluna `pedido_venda_id` (FK composta) e o CHECK de
     documento em `aprovacoes_comerciais`;
  2. na ação que congela o pedido (equivalente à emissão), calcula `percentualDeDesconto` e `alcadaDoUsuario` e, acima
     da alçada, chama `solicitarAprovacao`;
  3. registra o seu adaptador em `ADAPTADORES` (`modules/aprovacoes-comerciais/routes.ts`).
- A alçada, a tela e as permissões são as mesmas.

**Ordem de Serviço (futuro):**
- Mesmo roteiro, com `os_id`.
- Atenção: o ciclo previsto da O.S. em `ARQUITETURA.md` tem "aguardando_aprovacao" do **cliente**. A aprovação
  comercial é outra coisa e deve ter nome próprio, como aqui ("aguardando aprovação comercial").
- A O.S. é um documento de itens como o Orçamento, então a mesma regra por item se aplica.

## 11. Versionamento

- Cada versão do Orçamento é um registro próprio, e a solicitação aponta para ele (`orcamento_id`), com o número e a
  versão gravados.
- A aprovação da v1 continua *aprovada* no histórico mesmo quando a v2 nasce (a v1 é cancelada como "substituída").
- A v2 nasce sem aprovação e, se passar da alçada ao emitir, gera uma solicitação nova.
- Só uma solicitação **pendente** por documento (índice `aprovacoes_comerciais_uma_pendente`).

## 12. Retrato (snapshot) e auditoria

- **Retrato** (`snapshot`, `SnapshotComercialSchema`), gravado na solicitação:
  - documento (tipo, número, versão), cliente, vendedor, veículo e tabela;
  - validade pedida (dias) e observações;
  - itens (código, descrição, quantidade ou tempo, preço de tabela, preço negociado, bruto, desconto e total) e
    totais.
- **Auditoria:** não há mecanismo global. O projeto usa uma tabela de eventos por assunto, só de inclusão, e este
  módulo segue esse padrão:
  - `aprovacoes_comerciais_eventos`: `necessaria`, `solicitada`, `aprovada`, `reprovada` e `cancelada`, os eventos
    COMMERCIAL_APPROVAL_* da especificação, com usuário, função, alçada, detalhe e data;
  - `orcamentos_eventos` ganhou *Descontos alterados*, *Enviado para aprovação comercial*, *Aprovado comercialmente*,
    *Reprovado comercialmente* e *Pedido de aprovação comercial retirado*;
  - `alcadas_desconto_eventos` guarda o histórico das alçadas.
- **Imutabilidade, garantida no banco (triggers):**
  - eventos de aprovação e de alçada não podem ser alterados nem apagados;
  - a solicitação não é apagada; decidida, não muda;
  - pendente, só os campos da decisão mudam.
- **Rastreabilidade:**

| Pergunta | Onde |
|---|---|
| Quem criou o documento | `orcamentos.criado_por` e o evento *Criado* |
| Quem aplicou o desconto e quando | Eventos *Descontos alterados* do orçamento (itens, de → para, desconto total) |
| Quem solicitou e quando | `solicitante_id` e `criado_em` da solicitação; eventos *necessária* e *solicitada* |
| Quem aprovou ou reprovou e quando | `decidido_por`, `decidido_em` e o evento correspondente |
| Documento, tipo, versão, valores e percentual | Colunas da solicitação e retrato |
| Alçada do solicitante e do decisor | `alcada_solicitante`, `alcada_decisor` e a alçada em cada evento |
| Resultado | `status` (pendente, aprovada, reprovada, cancelada) |

## 13. Concorrência

- A decisão trava **primeiro o documento** e depois a solicitação, a mesma ordem da emissão e do cancelamento, o que
  evita deadlock.
- A decisão confere a `versao` lida da solicitação.
- Duas decisões ao mesmo tempo: a segunda encontra a solicitação já decidida e recebe 409.
- Duas alterações de alçada ao mesmo tempo: a segunda recebe 409, pela versão da alçada ou pela unicidade na criação.

## 14. Casos de teste

- **API:** `apps/api/src/orcamentos.test.ts`, bloco "aprovação comercial por alçada".
  - Dentro da alçada, emite sem aprovação e registra o desconto; igual à alçada (Administrador, 100%) também emite.
  - Acima da alçada:
    - fica aguardando, com retrato, eventos, funções que aprovam, itens congelados (inclusive por SQL direto) e
      alerta no Início;
    - sem o módulo, a área de aprovações responde 403.
  - Gerente (15%) aprova 8%:
    - o orçamento é emitido, com a validade contando da aprovação;
    - não se aprova duas vezes;
    - mudar a alçada depois não altera o histórico.
  - Aprovadores:
    - Gerente não aprova 20% (403 e fora de "posso aprovar");
    - Administrador aprova 20% e 50%;
    - quem pediu não decide, mesmo com a alçada aumentada;
    - o vendedor-gerente só vê o próprio.
  - Versões:
    - reprovar exige justificativa;
    - a v2 é reavaliada e a v1 continua aprovada;
    - do reprovado sai uma nova versão.
  - Retirar: só o solicitante (o Administrador recebe 403); cancelar o orçamento cancela a solicitação.
  - Decisões simultâneas: uma vale e a outra recebe 409.
  - Sem aprovador com alçada, a emissão é recusada; alçada inativa vale 0%.
  - Histórico e decisão imutáveis, também por SQL direto.
  - Configuração das alçadas: só o Administrador, com versão e 2 casas.
- **Shared:** `packages/shared/src/aprovacoes.test.ts` (percentual arredondado para cima, igual à alçada está dentro,
  formatação).
- **Isolamento:** as quatro tabelas novas estão no teste de RLS.

## 15. Critérios de aceite

| Critério | Situação |
|---|---|
| Motor centralizado; Orçamento usa o motor | ✅ |
| Pedido de Venda e O.S. usam o motor | ⏳ Adiado: os documentos não existem. O motor e o adaptador estão prontos para eles (§10). |
| Alçada parametrizável, por função (estrutura existente) | ✅ |
| Dentro da alçada não gera; acima gera automaticamente e o documento fica aguardando, com indicação visual | ✅ |
| Com alçada suficiente aprova; sem alçada não; reprovação com justificativa obrigatória | ✅ |
| Histórico, retrato, versão, valores, percentual, alçadas, usuários e datas preservados | ✅ |
| Sem dupla decisão; concorrência controlada; backend valida tudo; permissões respeitadas | ✅ |
| Nenhuma aprovação de serviço pelo cliente, pública ou fora do escopo | ✅ |

## 16. Margem comercial na aprovação (decisão de 25/09/2026)

Indicador **gerencial de apoio ao aprovador**, restrito à jornada de aprovação. **Não é gatilho** (o gatilho continua
sendo desconto acima da alçada, por item), não é margem contábil e **não aparece para o vendedor** (a tela e as respostas
do orçamento não trazem PMC nem margem).

- **PMC** (preço médio de compra = custo de compra junto ao fornecedor): campo do cadastro de material
  (`materiais.pmc_centavos`; vazio = não disponível, nunca zero), com histórico em `materiais_pmc_eventos` (só inclusão).
  Informado na tela do material ou na importação CSV (coluna `pmc`). Quando existirem compras (Fase 7), o custo médio
  calculado alimentará esse campo.
- **PMC congelado no item** (`orcamento_itens.pmc_centavos`): copiado ao incluir o material; a nova versão copia o da
  anterior; o recálculo do rascunho de outro dia e a troca de tabela o atualizam junto com o preço; emitido, não muda.
- **Cálculo** (`packages/shared/src/margem.ts`), só materiais (serviço fica fora e aparece como "Não considerado"):

```text
Receita líquida = quantidade × preço líquido (= total do item)     Custo = quantidade × PMC
Margem R$ = receita − custo                                        Margem % = margem ÷ receita × 100 (receita 0: não calculada)
Consolidado = Σ receitas − Σ custos (nunca a média das margens); algum produto sem PMC → não disponível (com o motivo)
Sem desconto (comparativo "impacto da negociação"): a mesma conta com o preço de tabela
```

  O custo é calculado em milésimos de centavo (sem arredondar etapas); só a exibição arredonda. Margem negativa e zero
  aparecem como são. Sem faixas de "boa"/"ruim".
- **Retrato**: na emissão acima da alçada, `snapshot.margem` guarda os valores de cada item (PMC, receita, custo, margem R$
  e %, com e sem desconto), o consolidado e `calculadoEm`. A aprovação lê só o retrato: mudar o PMC ou o preço depois não
  muda nada. Pedidos anteriores à margem: "Análise de margem não disponível".
- **Permissão** — módulo **Custos e margem**: *Consultar* = ver o PMC (`GET /api/materiais/:id/pmc`) e a margem na
  aprovação (`GET /api/aprovacoes-comerciais/:id` só inclui `snapshot.margem` para ele); *Editar* = alterar o PMC
  (`PUT /api/materiais/:id/pmc`, com o valor lido: 409 se outra pessoa mudou antes; e a coluna `pmc` da importação).
  O Administrador tem tudo; nenhuma função padrão recebe o módulo. A margem não vai para o texto do histórico da
  aprovação (visível a quem só consulta aprovações).
- **Tela**: seção **Análise de margem** no detalhe da aprovação (venda líquida dos produtos, custo total, margem R$ e %,
  "N produtos considerados · N serviços não considerados", comparativo sem × com desconto e a tabela por item).
- **Testes**: casos 1 a 9 da especificação em `packages/shared/src/margem.test.ts`; PMC oculto e protegido, congelado no
  item e mantido quando o cadastro muda, em `apps/api/src/orcamentos.test.ts` e `materiais.test.ts`.
