# MobiOS — convenções e padrões obrigatórios

Este guia vale para **toda** mudança: código novo, correção, refatoração, módulo, tela, API, banco, integração ou revisão.
Leia `docs/ARQUITETURA.md` antes de mudanças estruturais. Escopo e prioridades: `docs/ENTREGAVEIS.md` (cite os códigos, ex.: OS-05). Regras de um módulo específico: `docs/modulos/`. Interface: `docs/STYLE_GUIDE.md`.

**Regra principal.** O objetivo é código que outro desenvolvedor entenda, teste, corrija e evolua com pouco esforço, não o código mais sofisticado possível. Na dúvida, prefira:
simples a complexo · legível a otimizado demais · reutilizar a duplicar · abstração necessária a abstração prematura · alteração localizada a refatoração ampla · consistência com o projeto a preferência pessoal.

## Mapa do projeto
Monorepo pnpm, TypeScript estrito, ESM, Node ≥ 22.
- `packages/shared` (`@mobios/shared`): schemas Zod de entrada e saída, tipos, regras puras (documentos, máscaras, formatos, acessos). Usado pela API e pelo front. Exporta tudo por `src/index.ts`.
- `apps/api`: Fastify 5 + `fastify-type-provider-zod` + Drizzle (postgres.js) + PostgreSQL 17.
  - `src/modules/<nome>/routes.ts`: um plugin por recurso (`xxxRoutes`), registrado em `src/app.ts`.
  - `src/lib/`: utilitários transversais (`erros.ts`, `cadastro.ts`, `auth.ts`, `acessos.ts`…).
  - `src/db/schema.ts`: todas as tabelas; `drizzle/`: migrações SQL versionadas.
- `apps/web`: React 19 + Vite + React Router + TanStack Query + react-hook-form + Tailwind 4.
  - `src/pages/`: uma tela por arquivo. `src/components/`: peças reutilizáveis (kit em `ui.tsx`). `src/lib/`: hooks e utilitários (`api.ts`, `formulario.ts`, `assistente.ts`, `materiais.ts`…).

A arquitetura é deliberadamente enxuta: **não existem camadas de controller, service, repository ou DTO**. O handler da rota valida com o schema do `shared`, acessa o banco pelo Drizzle dentro de `withTenant` e usa helpers de `src/lib/` para regras repetidas. Não crie essas camadas nem outros padrões novos sem necessidade concreta e sem combinar antes.

## Multi-tenancy (não negociável)
- Toda tabela de negócio tem `tenantId: tenantId()` e `isolamentoPorTenant('<tabela>')` em `apps/api/src/db/schema.ts`.
- Toda FK entre tabelas de negócio é composta `(tenant_id, x_id)`: checagem de FK ignora RLS.
- Todo acesso a tabelas de negócio passa por `withTenant(req.user.tid, tx => ...)`. Não filtre por tenant_id à mão; o RLS faz isso.
- A API conecta como `mobios_app` (sem superuser/BYPASSRLS). Migrações rodam como `mobios`.
- O teste "toda tabela com tenant_id tem RLS ativo" em `apps/api/src/app.test.ts` precisa continuar passando (tabela nova entra na lista dele).

## Escalabilidade horizontal (não negociável)
A API deve funcionar com N réplicas atrás de um balanceador (futuro Kubernetes + HPA). Detalhes em `docs/ARQUITETURA.md` §9.
- Nenhum arquivo no disco do container. Todos os dados ficam no PostgreSQL, inclusive arquivos pequenos (ex.: logo em `tenant_logos.conteudo bytea`, limite 1 MB, tipo validado pelos bytes). Arquivos grandes: ver `docs/ARQUITETURA.md` §9.1.
- Nenhum dado de negócio fixo no front, em `localStorage` ou em memória: tudo é lido do banco pela API. `localStorage` só para conveniência do usuário (ex.: última tabela escolhida), sempre em `try/catch` e com a tela funcionando sem ele.
- Nenhum estado compartilhado em memória (cache, contadores, rate limit, travas): usar Postgres ou Redis.
- Sequências de negócio (número da O.S.) geradas no banco via tabela `contadores`, dentro da transação.
- Nada de `setInterval`/cron dentro da API: tarefas periódicas vão para um worker separado ou usam `pg_try_advisory_lock`.

## Configuração e segredos
- Configuração só por variável de ambiente, validada em `apps/api/src/env.ts` (Zod). Variável nova: acrescente no schema de `env.ts` e em `.env.example` (sem valor real).
- Diferenças entre desenvolvimento, teste e produção vêm de `NODE_ENV` e das variáveis, nunca de URLs, portas ou flags fixas no código.
- Nunca versionar `.env`, senhas, tokens, chaves de API ou `JWT_SECRET`. Nunca escrever segredo no código, em teste, em migração ou em documentação.

## Banco de dados
- Toda tabela tem PK `id uuid` (`uuid().primaryKey().defaultRandom()`), chave natural com índice único quando existir, e índice em toda FK e em colunas de filtro/ordenação frequentes. Exceção justificada: tabela de saldo com PK composta natural (ex.: `estoques (material_id, deposito_id)`).
- Nomes: tabelas e colunas em português, `snake_case`, tabela no plural (`materiais_precos`, `estoque_ajustes`). No TypeScript as colunas ficam em camelCase (o Drizzle usa `casing: 'snake_case'`). Constraints com nome estável quando geram mensagem ao usuário: `<tabela>_<campo>_unico`, `<tabela>_<regra>` para CHECK — e a mensagem correspondente entra em `mensagensUnicidade`/`mensagensCheck` de `apps/api/src/lib/erros.ts`.
- Integridade no banco, não só na aplicação: `NOT NULL`, CHECK, UNIQUE, FK (RESTRICT por padrão), EXCLUDE para períodos. Dinheiro em centavos (`bigint`), quantidades em `numeric(14,3)` com `mode: 'number'`.
- Migração: altere `schema.ts`, rode `pnpm db:generate`, **revise e ajuste o SQL gerado** (nome descritivo em português, ex.: `0013_estoque_saldos.sql`) e depois `pnpm db:migrate`. Nunca edite uma migração já aplicada/commitada; crie outra. Extensões, triggers, seeds e recriação de enum vão no SQL da migração.
- Queries sempre parametrizadas pelo Drizzle (`eq`, `ilike`, template `sql\`...${valor}\``). `sql.raw` e `sql.identifier` só com valores vindos de constantes do código, nunca da requisição.
- Operações que leem e depois gravam uma regra (ex.: fechar vigência) ficam na mesma transação do `withTenant`, com `for('update')` ou `pg_advisory_xact_lock` quando há risco de corrida.
- Nunca selecione `senha_hash` fora do login. Usuários não são excluídos: `ativo = false`.
- Acesso: funções configuráveis por oficina, com nível por módulo (`packages/shared/src/acessos.ts`, `docs/ENTREGAVEIS.md` §1.1). API: `app.autenticar` e depois `app.exigirAcesso('modulo', 'editar')` ou `app.exigirAdmin`; tela: `usePode()('modulo', 'editar')` / `useAdmin()`. Módulo novo: acrescente em `MODULOS`; na migração, **recrie** o enum `modulo` (renomear o antigo, criar o novo, `ALTER COLUMN ... USING modulo::text::modulo`, apagar o antigo), pois `ADD VALUE` não pode ser usado na mesma transação (ver `drizzle/0008`). Nunca compare nomes de função no código.

## Cadastros mestres (padrão do módulo Materiais e Preços, `docs/modulos/MATERIAIS_E_PRECOS.md`)
- Chave de negócio (SKU, código) é UNIQUE por oficina, nunca PK. Colunas de autoria `criado_por/atualizado_por` (FK users) e `versao`: a edição envia a versão lida e `atualizarVersionado` (`apps/api/src/lib/cadastro.ts`) devolve 409 se outra pessoa salvou antes.
- Excluir só o que nunca foi usado (`excluirSeNaoUsado`: FK RESTRICT → 409 "inative"); o resto é desativação lógica (`alterarAtivo`). Referências escolhidas precisam estar ativas (`validarReferencia`), exceto a que o registro já usa.
- Histórico com vigência: intervalo fechado com fim NULL = aberto, sem sobreposição garantida por `EXCLUDE USING gist (... daterange(inicio, fim, '[]') WITH &&)`; nunca apagar nem reescrever o passado; trava `pg_advisory_xact_lock` quando a regra lê e depois grava.
- Alteração de saldo ou preço deixa trilha (tabela de eventos/ajustes com usuário, antes/depois e motivo).

## API
- Novo recurso: `apps/api/src/modules/<nome-em-kebab>/routes.ts` exportando `const <nome>Routes: FastifyPluginAsyncZod`, registrado em `src/app.ts`. Hooks `app.autenticar` e `app.exigirAcesso(...)` no topo do plugin; rotas de escrita com `{ onRequest: app.exigirAcesso('<modulo>', 'editar') }`.
- Toda rota declara `schema` com `params`/`querystring`/`body` e `response`, usando schemas do `shared`. Validação de entrada é feita pelo schema, não por `if` no handler.
- Caminhos REST em português, plural e kebab-case (`/tabelas-preco`, `/precos/:id`); ações que não são CRUD viram sub-recurso com POST (`/precos/:id/encerrar`). Códigos: 201 na criação, 204 sem corpo, 400 dados inválidos, 403 sem acesso, 404, 409 conflito/versão/em uso.
- Schemas usados em `response` não podem ter `.transform()` (o serializador do fastify-type-provider-zod v7 falha com "unidirectional transform"). Separe o schema de entrada (`xInputSchema`, com normalização) do de saída (`xSchema`).
- Campos numéricos opcionais vindos de formulário: string vazia vira null, nunca 0.
- Não retorne `reply` de funções async (ele é thenable e trava o await): use `return reply.code(201).send(x)` ou retorne o objeto.
- Imports relativos da API terminam em `.js` (ESM do Node); no front e no `shared`, sem extensão.
- Contratos são compartilhados: mudou um schema do `shared`, confira a API, o front e os testes que o usam no mesmo trabalho.

## Interface
- Toda cor vem dos tokens de `apps/web/src/index.css` (ver `docs/STYLE_GUIDE.md`). Proibido `slate-*`, `blue-*`, `bg-white`, `text-white` ou hex nas telas.
- Telas usam os componentes de `apps/web/src/components/ui.tsx` (`Campo`, `Input`, `InputMascara`, `Botao`, `Tabela`, `Abas`, `Vazio`, `Selo`…). Antes de criar um componente, procure ali e em `components/`.
- Formulários: react-hook-form com `zodResolver(<schema do shared>)` e `mode: 'onTouched'`; erros da API vão para os campos com `aplicarErrosDaApi`. Máscaras vêm de `packages/shared/src/mascaras.ts`, aplicadas com `InputMascara`. Cadastro em etapas: `useAssistente` + `Etapas`.
- Dados do servidor só via TanStack Query e `api()` de `lib/api.ts` (nunca `fetch` solto, exceto upload/download de arquivo). `queryKey` começa pelo recurso (`['estoque', 'ajustes', id]`); após gravar, invalide as chaves afetadas.
- Toda página tem o botão Voltar (componente `Voltar` no cabeçalho). Rota nova entra em `main.tsx` e, se for de menu, em `Layout.tsx`.
- Permissão na tela (`usePode`) só esconde o que o usuário não pode fazer; quem garante é a API.

## Formatação e identação
O projeto **não tem formatter nem linter configurado** (não há Prettier, ESLint, EditorConfig). A fonte oficial é o estilo já presente nos arquivos. Não adicione nem configure essas ferramentas sem pedido explícito, e não reformate arquivos inteiros.
- 2 espaços, sem tabs, em TS/TSX/JSON/CSS. (SQL gerado pelo drizzle-kit fica como é gerado.)
- Aspas simples em TS; aspas duplas em atributos JSX. Ponto e vírgula sempre. Vírgula final em listas e objetos multilinha. Parênteses sempre em parâmetros de arrow function.
- Linhas: o projeto aceita linhas longas quando continuam legíveis (até ~160 colunas). Acima disso, ou quando a linha tem várias ideias, quebre no estilo Prettier: um argumento/propriedade por linha, fechamento alinhado ao início.
- Uma linha em branco entre funções, componentes e blocos lógicos; nenhuma sequência de linhas em branco; sem espaço sobrando no fim da linha; arquivo termina com uma quebra de linha.
- Imports no topo, em ordem alfabética pelo caminho: pacotes externos e `@mobios/shared` primeiro, depois imports relativos. Itens dentro das chaves também em ordem alfabética. Tipos com `import type` ou `type X` inline (exigido por `verbatimModuleSyntax`). Nada de import não usado.
- Siga o arquivo que você está editando: o trecho novo deve parecer escrito pela mesma pessoa.

## Tipagem e análise estática
- `tsc` em modo estrito (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `tsconfig.base.json`) é a análise estática oficial. `pnpm typecheck` precisa terminar com zero erros. Não altere essas configurações para fazer o código passar.
- Sem `any`, `@ts-ignore` ou `@ts-expect-error` novos. `as` e `!` só quando o tipo é garantido por algo que o compilador não enxerga (ex.: `[linha]` de um `insert ... returning`), e de preferência com o motivo claro no contexto.
- Tipos derivados dos schemas (`z.infer`, `z.input`, `z.output`), não redeclarados à mão.

## Nomenclatura
Domínio em português (clientes, veiculos, ordens_servico); termos técnicos consagrados podem ficar em inglês (`routes`, `schema`, `props`, `use*`). Nomes dizem o que a coisa é ou faz; evite `data`, `obj`, `tmp`, `x`, `value`, `info`, `handle`. Abreviação só quando consagrada (`id`, `tx`, `req`, `cpfCnpj`) ou em callbacks curtos de uma linha (`(m) => m.id`).

| O quê | Padrão | Exemplos |
|---|---|---|
| Página e componente (arquivo e nome) | PascalCase, `.tsx` | `ClienteForm.tsx`, `Botao`, `AjusteEstoqueForm` |
| Utilitário/hook do front, módulo do shared | camelCase/minúsculo, `.ts` | `lib/assistente.ts`, `mascaras.ts` |
| Diretório de módulo da API | kebab-case | `modules/tabelas-preco/` |
| Hook | `use` + PascalCase | `useAssistente`, `usePode`, `useFormVeiculo` |
| Função | verbo no infinitivo + objeto | `carregarCliente`, `gravarEnderecos`, `validarReferencia` |
| Booleano | `tem…`, `pode…`, `é…` implícito ou adjetivo | `temEndereco`, `ativo`, `livre` |
| Callback em props | `ao` + verbo | `aoSalvar`, `aoCancelar`, `aoTrocar` |
| Constante de módulo | UPPER_SNAKE | `MODULOS`, `FUNCOES_PADRAO`, `ETAPAS` |
| Tipo | PascalCase, sem prefixo `I`/`T` | `Cliente`, `VeiculoEntrada`, `Tx` |
| Schema Zod | camelCase + `Schema` (`Input`/`Filtro`/`Atualizar` quando for o caso) | `clienteSchema`, `clienteInputSchema`, `estoqueFiltroSchema` |
| Plugin de rotas | camelCase + `Routes` | `clientesRoutes` |
| Classe | só para erros | `ErroHttp`, `ErroApi` |
| Teste | `<arquivo>.test.ts`, descrição em português | `mascaras.test.ts` |

## Código limpo e complexidade
- Uma responsabilidade por função e por componente. Antes de acrescentar lógica, avalie se a função/tela já está difícil de acompanhar (muitos `if` aninhados, vários assuntos no mesmo bloco, muitos parâmetros); se estiver, faça uma decomposição localizada no trecho que você está mexendo. Não há limite numérico rígido: o critério é legibilidade. Referências: `ClienteForm.tsx` e `app.test.ts` já estão no limite do confortável; ao crescer, extraia partes (como `CamposVeiculo`/`NavegacaoEtapas`).
- Prefira retorno antecipado a `if` aninhado; condicional complexa vira constante ou função com nome.
- Funções previsíveis: mesmo resultado para a mesma entrada, efeitos colaterais explícitos no nome (`gravar…`, `excluir…`). Com mais de 3–4 parâmetros, receba um objeto.
- Regras puras (cálculo, validação, formatação) ficam em `packages/shared`, sem acesso a banco ou DOM, para serem testáveis e usadas nos dois lados.
- Composição em vez de herança; componentes pequenos combinados em vez de um componente com muitas flags.
- Sem código morto, `console.log` de depuração, código comentado ou TODO sem contexto.

## Reutilização, duplicação e dependências
- Antes de criar qualquer coisa, procure o que já existe: `packages/shared` (schemas, máscaras, formatos, documentos), `apps/api/src/lib` (erros, cadastro, auth), `apps/web/src/components` e `apps/web/src/lib`. Ordem de preferência: **reutilizar → adaptar → refatorar → criar**.
- Regra de negócio existe em um lugar só. Duplicação de lógica é extraída quando a extração deixa o código mais claro (ex.: `atualizarVersionado`, `aplicarErrosDaApi`). Duas ou três linhas parecidas não justificam uma abstração artificial.
- Não crie abstração "para o futuro": generalize quando o segundo ou terceiro caso real aparecer.
- Dependência nova só com necessidade real e combinada antes: verifique se a stack atual resolve (Zod, Drizzle, TanStack Query, react-hook-form, lucide-react, APIs nativas do Node/navegador), e pese manutenção, segurança, tamanho e licença (o projeto é AGPL-3.0).

## Erros e logs
- API: erro de regra de negócio é `throw new ErroHttp(status, 'mensagem exibível')` ou `naoEncontrado('Cliente')`. O tratador central (`registrarTratamentoDeErros`) converte validação Zod em 400 com `campos`, erros do Postgres (23505, 23514, 23P01, 23503) em mensagens próprias, e loga só o que vira 500. Não trate essas situações de novo em cada rota; acrescente a mensagem da constraint em `erros.ts`.
- Mensagem ao usuário: em português, específica e acionável ("Já existe um material com este SKU"), sem detalhes internos (SQL, stack, nomes de tabela). Resposta de erro sempre `{ erro, campos? }`.
- `catch` só quando há algo a fazer: traduzir o erro (como `excluirSeNaoUsado`), acrescentar contexto ou recuperar. Nunca `catch` vazio nem engolir o erro; relance o que não souber tratar. Exceção aceita: `.catch(() => ({}))` ao ler corpo de erro e acesso a `localStorage`.
- Front: erros de API chegam como `ErroApi`; mostre com `Alerta`/`aplicarErrosDaApi`. Falha de rede tem mensagem própria.
- Integrações externas (ex.: ViaCEP): tempo limite, falha tratada sem travar o fluxo e o usuário pode seguir preenchendo à mão.
- Logs: use o logger do Fastify (`req.log`/`app.log`, pino) na API; `console` só em scripts de linha de comando (`db/migrate.ts`). Nível adequado: `error` para falha inesperada, `warn` para situação anômala recuperável, `info` para eventos operacionais relevantes, `debug` para diagnóstico. Inclua contexto útil (ids, operação), nunca senhas, hashes, tokens, cookies, `JWT_SECRET`, corpo de login, CPF/CNPJ ou outros dados pessoais desnecessários. Não logue em laço nem em todo request além do que o Fastify já faz.

## Segurança
- Toda entrada é validada pelo schema Zod da rota; o front valida para ajudar o usuário, mas a API é quem decide.
- Toda rota de negócio: `app.autenticar` + `app.exigirAcesso` (ou `exigirAdmin`); dados sempre via `withTenant` (RLS). Rota pública nova precisa de motivo explícito (ver `modules/publico`).
- Senha só como hash Argon2id; sessão em cookie `httpOnly` + `sameSite: 'lax'` (base da proteção CSRF — não troque para token em `localStorage`).
- Resposta expõe só o necessário, definido pelo schema de `response` (ele filtra campos a mais).
- XSS: nada de `dangerouslySetInnerHTML`; o React já escapa o texto. SQL injection: ver regras de queries parametrizadas.
- Arquivos: tamanho limitado, tipo validado pelos bytes (`lib/imagem.ts`), guardados no banco.
- Chamadas externas só para destinos fixos no código ou na configuração, nunca para URL vinda do usuário.

## Performance
Sem otimização prematura, mas sem desperdício óbvio:
- Nada de consulta dentro de laço (N+1): use join, subconsulta agregada (`json_agg`, como em `clientes/routes.ts`) ou `inArray`.
- Listas sempre paginadas (`pagina`/`porPagina` com limite) e com `count` separado; selecione só as colunas necessárias.
- Filtro/ordenação frequente precisa de índice (btree; `pg_trgm` para busca por texto).
- No front, não repita requisições que o TanStack Query já tem em cache; invalide só as chaves afetadas.

## Testes
- Vitest. `packages/shared`: testes unitários de regras puras. `apps/api`: testes de integração via `app.inject` contra o banco `mobios_test` (nunca o de uso). O front não tem testes automatizados; valide as telas no navegador.
- Mudou comportamento: rode os testes relacionados, atualize-os se a regra mudou de propósito e cubra o caso novo — sucesso, erro (400/403/404/409) e limites (valores vazios, zero, datas de borda, permissão, concorrência por `versao`).
- Tabela nova de negócio entra na lista do teste de RLS. Módulo novo de acesso entra nas expectativas de acessos.
- Nunca apague, pule (`.skip`) ou afrouxe um teste só para passar. Se o teste estiver errado, explique por quê.
- Testes independentes entre si: cada um cria os dados de que precisa (helpers no próprio arquivo).

## Comentários e documentação
- Comente o **porquê** (regra de negócio, limitação de biblioteca, decisão não óbvia), não o que o código faz. Exemplo do projeto: `// O Drizzle embrulha o erro do driver em \`cause\`.`
- JSDoc curto (`/** ... */`) em funções e componentes exportados cuja finalidade não é evidente pelo nome.
- Comentário desatualizado é pior que nenhum: ao mudar o código, ajuste ou remova o comentário.
- Regra de negócio nova ou alterada: atualize `docs/ENTREGAVEIS.md` e o documento do módulo em `docs/modulos/`; mudança estrutural: `docs/ARQUITETURA.md`; visual: `docs/STYLE_GUIDE.md`.

## Alterações cirúrgicas e compatibilidade
- Altere só o necessário para a tarefa; preserve o comportamento não relacionado; não reescreva arquivos inteiros nem renomeie coisas por gosto.
- Antes de mudar uma função, schema, rota ou tabela, procure quem a usa (API, front, testes, migrações, documentação) e ajuste todos no mesmo trabalho. Evite quebrar contratos (formato de resposta, nomes de campos, rotas); se for inevitável, avise.
- Melhoria fora do escopo vira recomendação no resumo final, não alteração automática — exceto quando for necessária para a mudança funcionar ou ficar correta.
- Ambiguidade de regra de negócio: pergunte em vez de assumir. Commit e push só quando pedido.

## Verificação
`pnpm typecheck && pnpm test` (os testes usam o banco `mobios_test`, nunca o de uso). Para mudança de schema: `pnpm db:generate`, revise o SQL e depois `pnpm db:migrate`. Mudança de tela: confira no navegador sem criar ou alterar dados reais do usuário.

### Checklist antes de concluir
- **Qualidade:** estilo e identação iguais aos do arquivo? Imports ordenados e sem sobras? Nomes consistentes com a tabela acima? Sem duplicação, código morto, comentário obsoleto ou função difícil de acompanhar?
- **Arquitetura:** está na camada certa (`shared` / rota / `lib` / página / componente)? Reutilizei o que já existia? Criei abstração, camada ou dependência sem necessidade? Multi-tenancy e escalabilidade horizontal respeitadas?
- **Segurança:** entrada validada por schema? Rota com autenticação e acesso? Nenhum segredo no código, nenhum dado sensível em log ou resposta?
- **Performance:** sem N+1, consulta repetida ou lista sem paginação? Índice para o novo filtro?
- **Testes:** `pnpm typecheck && pnpm test` passam? Comportamento novo coberto (sucesso, erro, limite)? Testes existentes preservados?
- **Manutenibilidade:** a mudança é pequena e focada? Outra pessoa entenderia sem explicação? Documentação e `ENTREGAVEIS.md` atualizados quando a regra mudou?
