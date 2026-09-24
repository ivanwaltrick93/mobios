# MobiOS — regras obrigatórias

Valem para toda tarefa. Detalhes fora daqui: arquitetura `docs/ARQUITETURA.md` · escopo e códigos (cite, ex.: OS-05) `docs/ENTREGAVEIS.md` · UI `docs/STYLE_GUIDE.md` · regras de módulo `docs/modulos/<modulo>.md` · passo a passo `CONTRIBUTING.md`.

**Prioridade em conflito:** segurança > integridade de dados > multi-tenancy > arquitetura existente > contratos/API > testes > manutenibilidade > performance > estilo. Convenção do projeto vence preferência pessoal.

## Fluxo: inspecionar → implementar → testar → revisar → concluir
1. **Inspecionar:** localize arquivos relacionados, implementação semelhante e helpers/componentes existentes; leia a doc do módulo; liste contratos (schemas, rotas, tabelas) e testes afetados.
2. **Implementar:** reutilizar → adaptar → refatorar → criar. Alteração cirúrgica (ver "Alterações").
3. **Testar:** `pnpm format && pnpm check`.
4. **Revisar o diff** (`git status`, `git diff`): arquivos modificados, criados e removidos; remova alterações incidentais; confira imports, testes, migrações e documentação; o diff deve se restringir ao escopo.
5. **Concluir** só com a Definition of Done atendida. Funcionar não basta.

Regra de negócio ambígua: pergunte. Commit e push só quando pedido.

## Arquitetura
- Monorepo pnpm, TypeScript estrito, ESM.
  - `packages/shared`: schemas Zod, tipos e regras puras (sem banco nem DOM), usados pela API e pelo front.
  - `apps/api`: Fastify 5 + fastify-type-provider-zod + Drizzle + PostgreSQL 17. `src/modules/<recurso>/routes.ts`, `src/lib/` (erros, cadastro, auth), `src/db/schema.ts`, `drizzle/` (migrações).
  - `apps/web`: React 19 + Vite + React Router + TanStack Query + react-hook-form + Tailwind 4. `pages/`, `components/` (kit em `ui.tsx`), `lib/`.
- Não há controller, service, repository nem DTO: o handler valida com o schema do `shared`, usa o Drizzle dentro de `withTenant` e helpers de `src/lib/`.
- Não introduza camadas, design patterns, factories, repositories, services, wrappers, abstrações ou dependências sem necessidade concreta e combinada.

## Multi-tenancy (não negociável)
Tenant = oficina: a unidade de isolamento dos dados.
- Toda tabela de negócio tem `tenantId: tenantId()` e `isolamentoPorTenant('<tabela>')` em `apps/api/src/db/schema.ts`.
- Toda FK entre tabelas de negócio é composta `(tenant_id, x_id)`: a checagem de FK ignora RLS.
- Todo acesso a tabelas de negócio passa por `withTenant(req.user.tid, tx => ...)`. Não filtre por `tenant_id` à mão; o RLS faz isso.
- A API conecta como `mobios_app` (sem superuser/BYPASSRLS); migrações rodam como `mobios`.
- O teste "toda tabela com tenant_id tem RLS ativo" (`apps/api/src/app.test.ts`) deve passar; tabela nova entra na lista dele.

## Escalabilidade horizontal (não negociável — `docs/ARQUITETURA.md` §9)
- API sem estado, pronta para N réplicas. Nenhum estado compartilhado em memória (cache, contador, rate limit, trava): use Postgres ou Redis.
- Nenhum arquivo no disco do container: tudo no Postgres (arquivo pequeno em `bytea`, até 1 MB, tipo validado pelos bytes; grandes: §9.1).
- Nenhum dado de negócio fixo no front ou em `localStorage`; `localStorage` só para conveniência do usuário, em `try/catch`, com a tela funcionando sem ele.
- Sequências de negócio (número da O.S.) no banco, via tabela `contadores`, dentro da transação.
- Sem `setInterval`/cron na API: worker separado ou `pg_try_advisory_lock`.

## Configuração
- Só por variável de ambiente, validada em `apps/api/src/env.ts`; variável nova também em `.env.example`, sem valor real. Diferenças entre ambientes vêm de `NODE_ENV`/variáveis, nunca de valores fixos no código.
- Nunca versione `.env` nem escreva segredo em código, teste, migração ou doc.
- Não altere TypeScript, lint, formatter, testes, banco, build, Docker ou segurança só para fazer algo passar. Mudança de configuração é intencional e justificada.

## Banco
- PK `id uuid` gerado pelo banco. Chave de negócio (SKU, código) é UNIQUE por tenant, nunca PK (exceção: tabela de saldo com PK composta natural, como `estoques`). Índice em toda FK e em filtro/ordenação frequente (`pg_trgm` para busca de texto).
- Nomes em português, `snake_case`, tabela no plural (no TS, camelCase via `casing: 'snake_case'`). Constraint que o usuário pode violar tem nome estável (`<tabela>_<campo>_unico`, `<tabela>_<regra>`) e mensagem em `mensagensUnicidade`/`mensagensCheck` (`apps/api/src/lib/erros.ts`).
- Integridade no banco: NOT NULL, CHECK, UNIQUE, FK RESTRICT, EXCLUDE para períodos. Dinheiro em centavos (`bigint`), nunca float. Quantidade `numeric(14,3)` com `mode: 'number'`.
- Migração: `schema.ts` → `pnpm db:generate --name <descricao>` → revise e ajuste o SQL (extensões, triggers, seeds) → `pnpm db:migrate`. Nunca edite migração aplicada ou commitada.
- Módulo de permissão novo: acrescente em `MODULOS` (`packages/shared/src/acessos.ts`) e **recrie** o enum `modulo` na migração (renomear, criar, `ALTER COLUMN ... USING modulo::text::modulo`, apagar o antigo). Nunca `ADD VALUE` (ver `drizzle/0008`).
- SQL só parametrizado (`eq`, `ilike`, `` sql`...${valor}` ``). `sql.raw`/`sql.identifier` só com constantes do código.
- Ler e depois gravar uma regra: mesma transação, com `for('update')` ou `pg_advisory_xact_lock` se houver corrida.
- Cadastros mestres (`docs/modulos/MATERIAIS_E_PRECOS.md`):
  - Autoria `criado_por/atualizado_por` + `versao`, gravada com `atualizarVersionado` (409 se outra pessoa salvou antes).
  - Excluir só o nunca usado (`excluirSeNaoUsado`); o resto se desativa (`alterarAtivo`).
  - Referência escolhida deve estar ativa (`validarReferencia`), exceto a que o registro já usa.
  - Vigências sem sobreposição (EXCLUDE gist); o passado nunca é apagado nem reescrito.
  - Mudança de saldo ou preço deixa trilha (usuário, antes/depois, motivo).
- Usuário nunca é excluído (`ativo = false`). `senha_hash` só é lido no login e na troca da própria senha.

## API
- Recurso: `modules/<kebab>/routes.ts` exporta `<nome>Routes: FastifyPluginAsyncZod`, registrado em `src/app.ts`. No topo, `app.autenticar` + `app.exigirAcesso('<modulo>')`; escrita com `exigirAcesso('<modulo>', 'editar')` ou `app.exigirAdmin`. Nunca compare nomes de função no código. Rota pública só com motivo explícito (ver `modules/publico`).
- Toda rota declara `params`/`querystring`/`body` e `response` com schemas do `shared` (sem `response` só 204 e binário/CSV). Validação no schema, não em `if` no handler.
- Schema de `response` não tem `.transform()`: separe `xInputSchema` (normaliza) de `xSchema`. Tipos derivados com `z.infer`/`z.input`/`z.output`.
- REST em português, plural, kebab-case (`/tabelas-preco`); ação não CRUD é POST em sub-recurso (`/precos/:id/encerrar`). Status: 201 criação, 204 sem corpo, 400 inválido, 403 sem acesso, 404, 409 conflito/versão/em uso.
- Erro de negócio: `throw new ErroHttp(status, msg)` ou `naoEncontrado('X')`. O tratador central converte Zod em 400 `{ erro, campos }` e erros do Postgres (23505, 23514, 23P01, 23503); não os trate de novo nas rotas. Mensagem em português, acionável, sem SQL, stack ou nomes internos.
- Campo numérico opcional de formulário: string vazia vira null, nunca 0.
- Não retorne `reply` de função async (é thenable e trava o await).
- Imports relativos terminam em `.js` na API e no `shared`; sem extensão no web.
- Mudou um schema do `shared`: ajuste a API, o front e os testes no mesmo trabalho.

## Frontend (visual: `docs/STYLE_GUIDE.md`)
- Cores só por tokens (`apps/web/src/index.css`). Proibido `slate-*`, `blue-*`, `bg-white`, `text-white` e hex nas telas.
- Use os componentes de `components/ui.tsx` e `components/` (catálogo no STYLE_GUIDE) antes de criar outros.
- Dados do servidor: TanStack Query + `api()` (`lib/api.ts`); `fetch` direto só em upload/download e ViaCEP. `queryKey` começa pelo recurso; após gravar, invalide as chaves afetadas.
- Formulário: react-hook-form + `zodResolver(<schema do shared>)`, `mode: 'onTouched'`, erros da API com `aplicarErrosDaApi`; máscaras de `shared/mascaras.ts` via `InputMascara`; etapas com `useAssistente` + `Etapas`.
- Rota nova em `main.tsx`; item de menu em `Layout.tsx` (que já tem o `Voltar`).
- `usePode()`/`useAdmin()` só escondem o que o usuário não pode fazer; quem bloqueia é a API.

## Formatação e tipagem
- **Prettier** (`.prettierrc.json`: 2 espaços, aspas simples, ponto e vírgula, vírgula final, largura 120) e `.editorconfig` decidem; rode `pnpm format`. Ficam fora `*.md`, migrações e arquivos gerados.
- O que o Prettier não quebra (SQL em template, mensagens, comentários) você quebra à mão acima de ~120 colunas; classes Tailwind podem ficar numa linha. Nada de expressão com vírgula `(a(), b())` nem `if`/`for` denso numa linha.
- Imports: externos e `@mobios/shared`, depois relativos, em ordem alfabética; tipos com `import type`/`type X`; sem imports não usados.
- **ESLint** (`eslint.config.js`) e `tsc` estrito terminam sem erros nem avisos. Sem `any`, `@ts-ignore` ou `@ts-expect-error`. `as` e `!` só quando o tipo é garantido fora da visão do compilador. `eslint-disable` só com `-next-line <regra>` e o motivo. Variável ignorada começa com `_`.
- Formatação em massa vai em commit separado de mudança de comportamento.

## Nomenclatura
Domínio em português; termos técnicos consagrados em inglês. Nada de nomes genéricos (`data`, `obj`, `tmp`, `value`, `handle`); abreviação só consagrada (`id`, `tx`, `req`).

- **Arquivos:** página/componente em PascalCase `.tsx`; utilitário do front e módulo do shared em minúsculo `.ts`; módulo da API em diretório kebab-case; teste `<arquivo>.test.ts`, com descrições em português.
- **Identificadores:** componente e tipo em PascalCase (tipo sem prefixo `I`/`T`); hook `use` + PascalCase; função = verbo no infinitivo + objeto (`gravarEnderecos`); booleano `tem…`/`pode…` ou adjetivo (`ativo`); callback em props `ao` + verbo (`aoSalvar`); constante de módulo em UPPER_SNAKE.
- **Específicos:** schema Zod em camelCase + `Schema`, com `Input`/`Filtro`/`Atualizar` quando couber (`clienteInputSchema`); plugin de rotas camelCase + `Routes`; classe só para erros (`ErroHttp`).

## Qualidade e manutenção
- Uma responsabilidade por função/componente; baixo acoplamento. Use retorno antecipado em vez de nesting; dê nome a condição complexa. Com mais de 3–4 parâmetros, receba um objeto. Efeito colateral aparece no nome (`gravar…`, `excluir…`).
- Função, tela ou arquivo difícil de acompanhar: decomponha só o trecho que você está alterando.
- Antes de criar arquivo, procure um local existente e apropriado; não crie arquivo para mudança pequena ou responsabilidade isolada sem necessidade.
- Regra de negócio em um lugar só. Extraia duplicação quando isso clarear o código; 2–3 linhas parecidas não justificam abstração. Nada "para o futuro".
- Dependência nova só com necessidade real e combinada: antes verifique a stack atual; pese manutenção, segurança, tamanho e licença (projeto AGPL-3.0).
- Sem código morto, código comentado, `console.log` de depuração ou TODO sem contexto.
- Comentários explicam o porquê; JSDoc curto em export de finalidade não óbvia. Atualize ou remova comentário desatualizado.

## Erros, logs e segurança
- `catch` só para traduzir, contextualizar ou recuperar; nunca vazio nem engolindo o erro; relance o resto. Exceções: `.catch(() => ({}))` ao ler corpo de erro, e acesso a `localStorage`.
- Front: `ErroApi` exibido com `Alerta`/`aplicarErrosDaApi`. Integração externa tem timeout e, se falhar, não trava o fluxo.
- Logs só pelo pino (`req.log`/`app.log`); `console` só em scripts CLI (`db/migrate.ts`). Use o nível certo (error/warn/info/debug), com contexto (ids, operação), sem log em laço. Nunca logue senha, hash, token, cookie, `JWT_SECRET`, corpo de login, CPF/CNPJ ou dado pessoal desnecessário.
- Senha só como hash Argon2id. Sessão em cookie `httpOnly` + `sameSite: 'lax'` (base anti-CSRF); não troque por token em `localStorage`.
- A resposta expõe só o que está no schema de `response`. Proibido `dangerouslySetInnerHTML`.
- Arquivo: tamanho limitado, tipo validado pelos bytes (`lib/imagem.ts`), guardado no banco.
- Chamada externa só para destino fixo em código ou configuração, nunca para URL vinda do usuário.

## Performance
Sem otimização prematura e sem desperdício óbvio:
- Nada de N+1: use join, `json_agg` ou `inArray`.
- Listas paginadas (`pagina`/`porPagina` com limite), com `count` separado e só as colunas necessárias.
- Filtro novo precisa de índice.
- No front, não repita requisições que já estão em cache.

## Testes
- Vitest. `shared`: testes unitários; `api`: integração via `app.inject` no banco `mobios_test` (nunca no de uso). O front não tem testes automatizados: confira no navegador sem criar nem alterar dados reais.
- Mudou comportamento: rode os testes relacionados, atualize os que mudaram de propósito e cubra sucesso, erro (400/403/404/409) e limites (vazio, zero, datas de borda, permissão, `versao`).
- Tabela nova entra no teste de RLS; módulo de acesso novo, nas expectativas de acessos.
- Nunca apague, pule (`.skip`) ou afrouxe um teste para passar. Cada teste cria os próprios dados.

## Alterações e documentação
- Altere só o necessário; preserve o comportamento não relacionado; não reescreva arquivos nem renomeie por gosto.
- Antes de mudar função, schema, rota ou tabela, procure os consumidores (API, front, testes, migrações, docs) e ajuste todos juntos. Não quebre contrato; se for inevitável, avise.
- Melhoria fora do escopo vira recomendação no resumo, salvo se for necessária para a mudança funcionar.
- Atualize a documentação quando mudar regra de negócio, arquitetura, contrato ou comportamento documentado (não para detalhe interno de implementação): regras em `docs/ENTREGAVEIS.md` e `docs/modulos/`, estrutura em `docs/ARQUITETURA.md`, visual em `docs/STYLE_GUIDE.md`.

## Definition of Done (checklist final)
- [ ] Funcionalidade implementada; `pnpm check` passa, com os testes relacionados executados.
- [ ] Segurança, permissões, multi-tenancy, escalabilidade, integridade de dados e arquitetura preservadas; performance adequada.
- [ ] Documentação atualizada quando exigido (ver "Alterações e documentação").
- [ ] Diff revisado: só o escopo pedido, sem comportamento não relacionado, duplicação ou código morto.
