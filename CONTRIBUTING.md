# Como contribuir com o MobiOS

Guia prático para quem vai manter o código. As regras completas (o "porquê" de cada padrão) estão no [CLAUDE.md](CLAUDE.md) — apesar do nome, ele vale para pessoas e para agentes de IA. Aqui fica o passo a passo do dia a dia.

Leitura recomendada antes da primeira mudança:

1. [README.md](README.md): como subir o projeto.
2. [docs/ARQUITETURA.md](docs/ARQUITETURA.md): multi-tenancy, RLS, escalabilidade.
3. [CLAUDE.md](CLAUDE.md): padrões obrigatórios de código.
4. [docs/ENTREGAVEIS.md](docs/ENTREGAVEIS.md): o que já existe e o que está planejado (códigos como `EST-14`).

## 1. Ambiente

```bash
docker compose up -d db     # banco (cria também o banco de testes mobios_test)
pnpm install
pnpm db:migrate
pnpm dev                    # API em :3333, web em http://localhost:5173
```

Editor: instale as extensões **Prettier** e **ESLint** (VS Code: `esbenp.prettier-vscode` e `dbaeumer.vscode-eslint`) e ative "formatar ao salvar". O `.editorconfig` ajusta identação e fim de linha nos demais editores.

## 2. Antes de abrir PR / fazer push

```bash
pnpm format     # formata tudo com Prettier
pnpm check      # formatação + lint + tipos + testes (o mesmo que o CI roda)
```

O CI (`.github/workflows/ci.yml`) roda essas verificações em todo push para `main` e em todo pull request. Código que não passa não deve entrar.

Checklist rápido (o completo está no fim do `CLAUDE.md`):

- [ ] `pnpm check` passou sem erros nem avisos.
- [ ] A mudança é focada: nada de reformatar ou renomear coisas fora do assunto.
- [ ] Reaproveitei o que já existia (`packages/shared`, `apps/api/src/lib`, `apps/web/src/components/ui.tsx`).
- [ ] Rotas novas têm autenticação, permissão (`exigirAcesso`) e schema de entrada e de resposta.
- [ ] Comportamento novo tem teste (sucesso, erro e casos limite).
- [ ] Regra de negócio nova está documentada em `docs/ENTREGAVEIS.md` / `docs/modulos/`.

## 3. Estilo de código

Não discuta estilo em revisão: o **Prettier** decide a formatação (`.prettierrc.json`: 2 espaços, aspas simples, largura 120) e o **ESLint** (`eslint.config.js`) aponta erros comuns. O que as ferramentas não cobrem:

- **Nomes em português** para o domínio (`clientes`, `gravarEnderecos`, `aoSalvar`); termos técnicos podem ficar em inglês. Tabela completa de nomenclatura no `CLAUDE.md`.
- **Linhas longas que o Prettier não quebra** (SQL em template, mensagens, comentários): quebre à mão quando passarem de ~120 colunas. Classes do Tailwind podem ficar em uma linha.
- **Comentários explicam o porquê**, não o quê.
- **`eslint-disable`** só na linha exata (`eslint-disable-next-line <regra>`) e com um comentário explicando o motivo.

## 4. Receitas

### 4.1 Nova tabela ou coluna

1. Edite `apps/api/src/db/schema.ts`. Tabela de negócio precisa de `tenantId: tenantId()`, `isolamentoPorTenant('<tabela>')`, FKs compostas `(tenant_id, x_id)` e índice em toda FK.
2. `pnpm db:generate --name <descricao_em_snake>` (ex.: `--name ordens_servico`) e **leia o SQL gerado** em `apps/api/drizzle/`; ajuste-o quando precisar (extensões, triggers, seeds, recriação de enum).
3. `pnpm db:migrate`.
4. Inclua a tabela nova na lista do teste de RLS em `apps/api/src/app.test.ts`.
5. Constraint que o usuário pode violar (UNIQUE/CHECK): dê um nome estável e registre a mensagem em `apps/api/src/lib/erros.ts`.

Nunca edite uma migração que já foi aplicada ou commitada: crie outra.

### 4.2 Novo recurso na API

1. Schemas em `packages/shared/src/<assunto>.ts` (`xInputSchema` para entrada, `xSchema` para resposta, sem `.transform()` no de resposta) e exporte em `index.ts`.
2. Crie `apps/api/src/modules/<nome-em-kebab>/routes.ts` seguindo um módulo parecido (o de `marcas` é um bom modelo de cadastro simples; `precos` de regra com vigência).
3. Registre em `apps/api/src/app.ts` com `prefix: '/api/<nome>'`.
4. Todo acesso ao banco dentro de `withTenant(req.user.tid, (tx) => ...)`.
5. Testes de integração em `apps/api/src/*.test.ts` usando `app.inject`.

### 4.3 Novo módulo de permissão

1. Acrescente em `MODULOS` e nas funções padrão em `packages/shared/src/acessos.ts`.
2. Na migração, recrie o enum `modulo` (ver `apps/api/drizzle/0008_*.sql`) — `ALTER TYPE ... ADD VALUE` não funciona dentro da transação da migração.
3. Atualize a matriz de permissões em `docs/ENTREGAVEIS.md` §1.1 e as expectativas de acesso nos testes.

### 4.4 Nova tela

1. Crie `apps/web/src/pages/<Nome>.tsx` usando os componentes de `components/ui.tsx` e cores só por tokens (`docs/STYLE_GUIDE.md`).
2. Dados via `useQuery`/`useMutation` com `api()` de `lib/api.ts`; após gravar, invalide as `queryKey` afetadas.
3. Formulário: `react-hook-form` + `zodResolver(<schema do shared>)`, `mode: 'onTouched'`, erros da API com `aplicarErrosDaApi`.
4. Registre a rota em `apps/web/src/main.tsx`; se for item de menu, em `components/Layout.tsx`.
5. Esconda ações sem permissão com `usePode()` (a API continua sendo quem bloqueia).
6. Confira a tela no navegador, inclusive em largura de celular.

## 5. Commits

- Um assunto por commit, mensagem em português no imperativo ou descritiva ("Tabela de estoque com ajuste manual").
- Formatação em massa vai em commit separado de mudança de comportamento.
- Nunca commite `.env` ou segredos.
