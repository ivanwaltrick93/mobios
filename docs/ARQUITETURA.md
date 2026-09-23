# MobiOS — Arquitetura

Sistema de gestão de Ordens de Serviço (O.S.) para oficinas mecânicas.
Web, multi-tenant (SaaS) desde o primeiro dia, open core, 100% sobre software livre.

> Status: v0 (scaffold). Este documento registra as decisões e o porquê de cada uma.
> Mudou uma decisão? Atualize aqui no mesmo PR.

---

## 1. Premissas (definidas com o dono do produto)

| Tema | Decisão |
|---|---|
| Acesso | Web (navegador) — roda em macOS, Windows, Linux, tablet e celular |
| Modelo | SaaS multi-tenant; o mesmo pacote Docker serve para instalação self-hosted |
| Linguagem | TypeScript de ponta a ponta |
| Equipe | 1 dev + Claude → monolito modular, um único repositório |
| Hospedagem inicial | Docker Compose em VPS |
| Licença | Open core: núcleo AGPL-3.0 + módulos comerciais em `ee/` |
| MVP | Núcleo da O.S., estoque de peças, financeiro, registro de pagamentos (Pix/cartão/dinheiro — sem integração com gateway no MVP) |

## 2. Stack

Todas as dependências são open source com licenças permissivas (MIT, Apache-2.0, BSD, PostgreSQL), compatíveis com AGPL e com venda comercial. **Nenhum custo de licenciamento.**

| Camada | Tecnologia | Licença | Por quê |
|---|---|---|---|
| Runtime | Node.js 22+ (LTS) | MIT | Multiplataforma, enorme ecossistema |
| Gerenciador | pnpm workspaces | MIT | Monorepo rápido e econômico em disco |
| API | Fastify 5 | MIT | Rápido, sem "mágica" de decorators, plugins = módulos |
| Validação | Zod | MIT | Mesmo schema valida no front e no back (`packages/shared`) |
| Banco | PostgreSQL 17 | PostgreSQL | Row-Level Security para isolar tenants, JSONB, maduro |
| ORM / migrações | Drizzle ORM + drizzle-kit | Apache-2.0 | SQL explícito, tipado, leve; convive bem com RLS |
| Senhas | Argon2id (`@node-rs/argon2`) | MIT | Padrão OWASP; binários prontos p/ Mac/Win/Linux |
| Sessão | JWT em cookie httpOnly (`@fastify/jwt`, `@fastify/cookie`) | MIT | Imune a roubo via XSS no `localStorage` |
| Front-end | React 19 + Vite | MIT | SPA; não há necessidade de SSR em app autenticado |
| Estado servidor | TanStack Query | MIT | Cache, loading, invalidação |
| Rotas | React Router | MIT | Simples e estável |
| Estilo | Tailwind CSS 4 | MIT | Produtivo; base para shadcn/ui depois |
| Testes | Vitest | MIT | Mesmo runner no front e no back |
| Proxy/TLS | Caddy | Apache-2.0 | HTTPS automático (Let's Encrypt) em produção |

**Por que Fastify e não NestJS?** Para uma pessoa, NestJS adiciona camadas (módulos, providers, decorators, metadata) que custam mais do que entregam. Com Fastify, cada módulo de negócio é uma pasta com `routes.ts` + `service.ts` — fácil de ler, testar e de o Claude manter. Se a equipe crescer muito, a separação por módulo já está feita.

## 3. Visão geral

```
                ┌──────────── navegador (qualquer SO) ────────────┐
                │  apps/web  (React SPA)                          │
                └───────────────┬─────────────────────────────────┘
                                │ HTTPS, cookie httpOnly
                         ┌──────▼──────┐
                         │   Caddy     │  TLS, serve o build estático do web,
                         └──────┬──────┘  /api/* → api
                         ┌──────▼──────────────────────────────┐
                         │ apps/api (Fastify, monolito modular)│
                         │  auth · clientes · veiculos · os ·  │
                         │  estoque · financeiro · (ee/*)      │
                         └──────┬──────────────────────────────┘
                                │ 1 transação por request c/ app.tenant_id
                         ┌──────▼──────┐
                         │ PostgreSQL  │  RLS: cada linha tem tenant_id
                         └─────────────┘
```

### Estrutura do repositório

```
MobiOS/
├── apps/
│   ├── api/            # Fastify + Drizzle
│   │   ├── src/modules/<modulo>/{routes,service}.ts
│   │   ├── src/db/{schema,client}.ts
│   │   └── drizzle/    # migrações SQL versionadas
│   └── web/            # React + Vite
├── packages/
│   └── shared/         # schemas Zod + tipos compartilhados
├── ee/                 # módulos comerciais (licença própria) — vazio no MVP
├── docs/
└── docker-compose.yml
```

## 4. Multi-tenancy

**Modelo:** banco único, schema único, coluna `tenant_id` em todas as tabelas de negócio, isolamento garantido pelo **PostgreSQL Row-Level Security**.

- Cada request autenticado abre uma transação e executa `set_config('app.tenant_id', <id do JWT>, true)`.
- Toda tabela de negócio tem RLS ativo com a política
  `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid` (em `USING` e `WITH CHECK`), declarada no schema do Drizzle (`isolamentoPorTenant`). O `tenant_id` tem esse mesmo valor como default, então os inserts nem precisam informá-lo.
- A API conecta como `mobios_app`, que não tem SUPERUSER, BYPASSRLS nem é dona das tabelas; por isso o RLS sempre vale. As migrações rodam como `mobios`, o dono.
- Se o código esquecer de filtrar por tenant, o banco devolve **zero linhas** em vez de dados de outra oficina. Falha segura.
- **FKs entre tabelas de negócio são compostas** `(tenant_id, x_id)`: a checagem de FK do Postgres ignora o RLS, então uma FK simples permitiria vincular um registro ao de outra oficina.
- Um teste automatizado falha se alguma tabela com `tenant_id` estiver sem RLS.
- `tenants` e `users` ficam fora do RLS porque são lidos antes de o tenant ser conhecido (login/cadastro); só o módulo `auth` os acessa.

**Por que não um banco por cliente?** Custo e operação (migrações × N bancos) não se justificam para oficinas pequenas. Se um cliente grande exigir isolamento físico, o mesmo código roda em um banco dedicado — basta outra `DATABASE_URL`.

## 5. Modelo de dados (MVP)

Valores monetários em **centavos (inteiro)** — nunca `float`.

```
tenants (id, nome, cnpj, plano, criado_em)
users (id, tenant_id, nome, email [único], senha_hash, papel, ativo)
    papel: dono | atendente | mecanico | financeiro

clientes (id, tenant_id, tipo PF|PJ, nome, cpf_cnpj, telefone, email, endereco jsonb, observacoes)
veiculos (id, tenant_id, cliente_id, placa, marca, modelo, ano, cor, chassi, km_atual)

ordens_servico (id, tenant_id, numero [seq. por tenant], cliente_id, veiculo_id, status,
                km_entrada, relato_cliente, diagnostico, checklist_entrada jsonb,
                mecanico_id, previsao_entrega, aprovada_em, concluida_em, entregue_em,
                total_servicos, total_pecas, desconto, total)
os_itens (id, tenant_id, os_id, tipo servico|peca, peca_id?, descricao, quantidade, valor_unitario, desconto)
os_eventos (id, tenant_id, os_id, de_status, para_status, user_id, observacao, criado_em)   -- auditoria

pecas (id, tenant_id, codigo, descricao, unidade, custo, preco_venda, estoque_atual, estoque_minimo, fornecedor_id?)
fornecedores (id, tenant_id, nome, cnpj, telefone, email)
movimentos_estoque (id, tenant_id, peca_id, tipo entrada|saida|ajuste, quantidade, custo_unitario, os_id?, user_id, criado_em)

lancamentos (id, tenant_id, tipo receber|pagar, descricao, categoria, valor, vencimento, pago_em?, os_id?, fornecedor_id?)
pagamentos (id, tenant_id, os_id?, lancamento_id?, forma pix|credito|debito|dinheiro|boleto|transferencia,
            valor, parcelas, referencia /* NSU, id Pix */, recebido_em, user_id)

contadores (tenant_id, chave, valor)  -- numeração sequencial de O.S. sem buracos por tenant
```

### Ciclo de vida da O.S.

```
 orcamento ──► aguardando_aprovacao ──► aprovada ──► em_execucao ──► concluida ──► entregue
     │                 │                                  │  ▲
     │                 └──► recusada                      ▼  │
     └──────────────────────────► cancelada          aguardando_peca
```

- Toda transição grava um `os_eventos` (quem, quando, de → para).
- Peça lançada na O.S. **reserva/baixa estoque** ao entrar em `em_execucao` (movimento `saida` com `os_id`); cancelamento estorna.
- Ao `concluida`, gera o lançamento `receber`; os pagamentos registrados abatem o saldo.

## 6. Segurança e LGPD

- Senhas com Argon2id; JWT de curta duração em cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção.
- RLS como segunda barreira de isolamento entre oficinas (ver §4).
- Autorização por papel (`dono`, `atendente`, `mecanico`, `financeiro`) checada na rota.
- Rate limit no login (`@fastify/rate-limit`) — fase 1.
- LGPD: CPF/telefone são dados pessoais → exportação e exclusão por titular, trilha de auditoria, backups criptografados, termo de uso/DPA para o SaaS.
- Segredos só em variáveis de ambiente; nunca no repositório.

## 7. Licenciamento (open core)

- Código em `apps/` e `packages/` → **AGPL-3.0**. Quem oferecer o MobiOS como serviço precisa publicar suas modificações, o que impede um concorrente de fechar o seu código e vendê-lo como SaaS.
- Código em `ee/` → **licença comercial** própria (modelo Cal.com / GitLab). Candidatos: emissão fiscal, multi-filial, BI, integração com gateways de pagamento, WhatsApp.
- Contribuições externas exigem **CLA** (ex.: CLA Assistant) para que você possa relicenciar comercialmente.
- ⚠️ Valide o texto das licenças e o CLA com um advogado antes do lançamento comercial.

## 8. Implantação

- **Tudo em containers:** `docker compose up -d --build` → `db`, `migrate` (aplica migrações e encerra), `api` e `web` (Caddy com o build do front + proxy de `/api`). Acesso em `http://localhost:8080`.
- **Dev:** `docker compose up -d db` + `pnpm dev` (api e web com hot reload).
- **Produção (VPS)** *(fase 4)*: o mesmo compose; trocar `:80` pelo domínio no `infra/caddy/Caddyfile` (HTTPS automático), `COOKIE_SECURE=true` e senhas/JWT fortes no `.env`. Backup diário com `pg_dump` para um storage S3 compatível (Backblaze B2, Cloudflare R2 ou MinIO).
- **Self-hosted:** o mesmo compose, entregue ao cliente.
- **Crescimento:** api é stateless → várias réplicas atrás do Caddy; Postgres gerenciado ou réplica de leitura; depois Kubernetes se necessário.

## 9. Roadmap

| Fase | Entrega |
|---|---|
| **0 — Scaffold** ✅ | Monorepo, cadastro da oficina, login, clientes e veículos com RLS |
| **0.1** | Rate limit no login antes de qualquer deploy público |
| **1 — O.S.** | Abertura, itens (serviço/peça), orçamento, aprovação, status, checklist de entrada, PDF da O.S. |
| **2 — Estoque** | Peças, fornecedores, entradas, baixa automática pela O.S., alerta de estoque mínimo |
| **3 — Financeiro** | Contas a receber/pagar, registro de pagamentos, caixa diário, comissão de mecânico |
| **4 — Produção** | Rate limit, papéis/permissões, backup, deploy na VPS, observabilidade (OpenTelemetry) |
| **5 — SaaS** | Cobrança de assinatura, planos, onboarding, painel de administração |
| **ee/** | Emissão de NF-e/NFS-e, Pix/cartão integrados via gateway (Asaas/Mercado Pago/Efí), WhatsApp, multi-filial, BI |
