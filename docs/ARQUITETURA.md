# MobiOS — Arquitetura

Sistema de gestão de Ordens de Serviço (O.S.) para oficinas mecânicas.
Web, multi-tenant (SaaS) desde o primeiro dia, open core, 100% sobre software livre.

> Status: v0 (scaffold). Este documento registra as decisões e o porquê de cada uma.
> Mudou uma decisão? Atualize aqui no mesmo PR.
> Arquitetura detalhada por módulo: [`docs/modulos/`](modulos/) (ex.: [Materiais e Preços](modulos/MATERIAIS_E_PRECOS.md)).

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
| Estilo | Tailwind CSS 4 + tokens CSS | MIT | Style guide em `docs/STYLE_GUIDE.md`; cores parametrizáveis por oficina |
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
- `users` também está sob RLS. A única leitura sem tenant definido é o login (busca por e-mail), feita pela função `auth_usuario_por_email` (`SECURITY DEFINER`, executável só por `mobios_app`), que devolve apenas o necessário para autenticar.
- Ficam fora do RLS só `tenants` e `login_tentativas` (limite de tentativas de login: é consultada antes de a oficina ser conhecida e guarda apenas hashes de e-mail/IP).
- **Rotas públicas** (`/api/publico/*`, sem login) expõem apenas a marca da oficina (nome, cores, logo) para a tela de entrada. A oficina vem de `?oficina=<id>` ou, sem parâmetro, é a única da instalação; com várias oficinas e sem parâmetro, devolvem o tema padrão (não listam oficinas).

**Por que não um banco por cliente?** Custo e operação (migrações × N bancos) não se justificam para oficinas pequenas. Se um cliente grande exigir isolamento físico, o mesmo código roda em um banco dedicado — basta outra `DATABASE_URL`.

## 5. Modelo de dados (MVP)

Valores monetários em **centavos (inteiro)** — nunca `float`.

Chaves e índices (obrigatório em toda tabela):
- **PK** `id uuid` gerada no banco (`gen_random_uuid()`).
- **Chave natural única** sempre que existir (e-mail do usuário; placa e CPF/CNPJ por oficina).
- **Índice em toda FK** e nas colunas usadas em filtro/ordenação frequentes, começando por `tenant_id` quando a consulta é por oficina.

```
tenants (id, nome, cnpj, plano, criado_em)
tenant_aparencia (tenant_id [PK/FK], cor_primaria?, cor_menu?, cor_botao_primario?, cor_botao_primario_texto?,
                  cor_botao_secundario?, cor_botao_secundario_texto?)   -- style guide da oficina
tenant_logos (tenant_id [PK/FK], conteudo bytea, tipo, tamanho, atualizado_em)   -- logo, até 1 MB, no próprio banco
users (id, tenant_id, codigo [seq. por oficina, imutável], nome, email [único global], senha_hash, ativo)
funcoes (id, tenant_id, codigo [seq. por oficina, imutável], nome [único por oficina, sem diferenciar maiúsculas],
         descricao, admin [uma por oficina], ativa)
parametros_funcao (id, codigo [único], nome, descricao)   -- catálogo global (sem tenant), só as migrações gravam
funcao_parametros (funcao_id + parametro_id [PK], tenant_id)                     -- ex.: VENDEDOR no Atendente
funcao_permissoes (funcao_id + modulo [PK], tenant_id, nivel consultar|editar)   -- ausente = sem acesso
usuario_funcoes (usuario_id + funcao_id [PK], tenant_id)                          -- várias funções por usuário
usuario_fotos (usuario_id [PK/FK], tenant_id, conteudo bytea, tipo, tamanho)     -- foto opcional, reduzida no navegador
vendedores (id, tenant_id, codigo [seq. por oficina, imutável], usuario_id [único por oficina], matricula
            [única, sem diferenciar maiúsculas], whatsapp, funcionario_desde, ativo)   -- nome e e-mail vêm do usuário
vendedores_eventos (id, tenant_id, vendedor_id, evento, origem, motivo, alteracoes jsonb, usuario_id, criado_em)
servicos (id, tenant_id, codigo [seq. por oficina, imutável], nome, descricao, forma_preco fechado|hora, tempo_minutos,
          observacao, classificacao_id?, garantia_dias?, garantia_km?, ativo)   -- preço em materiais_precos/precos_padrao

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

contadores (tenant_id + chave [PK], valor)  -- sequências por oficina: usuarios, funcoes, vendedores (e O.S.)
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

- **Sem cadastro público.** Na primeira instalação (banco sem usuários), o serviço `migrate` cria a oficina e o **admin inicial** a partir de `ADMIN_EMAIL`/`ADMIN_SENHA` do `.env`. Só o admin cadastra usuários.
- **Funções configuráveis** (`docs/ENTREGAVEIS.md` §1.1): nível por módulo, várias funções por usuário (vale o maior nível). Na API, `app.exigirAcesso('modulo', 'editar')` ou `app.exigirAdmin`; o acesso efetivo é recalculado do banco a cada requisição.
- **Usuários não são excluídos, só desativados** (preserva o histórico de quem fez o quê). O admin não pode rebaixar nem desativar a própria conta.
- Senhas com Argon2id (8 a 128 caracteres; o hash nunca sai da API). Login com tempo constante, sem revelar se o e-mail existe.
- JWT de 12 h em cookie `httpOnly`, `SameSite=Lax`, `Secure` com HTTPS. O token só identifica o usuário: **papel e status são lidos do banco a cada requisição** (consulta pela PK), então desativar ou trocar a função vale na hora.
- RLS como segunda barreira de isolamento entre oficinas (ver §4).
- Autorização por papel (`dono`, `atendente`, `mecanico`, `financeiro`) checada na rota.
- **Limite de tentativas de login** (PLT-08), no Postgres (§9, regra 2): 5 erros em 15 min por e-mail ou 20 por IP bloqueiam por 15 min, também para o Administrador. O IP real vem do `X-Forwarded-For` só quando a conexão chega de um proxy confiável (`TRUST_PROXY`; no Docker, o Caddy pela rede interna).
- **Senha esquecida:** o Administrador define uma nova em Equipe; cada usuário troca a própria em Meu perfil (PLT-07). Recomenda-se ter dois administradores. Recuperação por e-mail depende de SMTP (PLT-09).
- LGPD: CPF/telefone são dados pessoais → exportação e exclusão por titular, trilha de auditoria, backups criptografados, termo de uso/DPA para o SaaS.
- Segredos só em variáveis de ambiente; nunca no repositório.
- Serviço externo no cadastro: o navegador consulta o **ViaCEP** (público, gratuito) só com o CEP digitado, para preencher o endereço. Nenhum dado pessoal sai do sistema; se o serviço falhar, o preenchimento é manual.

### Relatórios

- Definidos em `apps/api/src/modules/relatorios/definicoes.ts` (título, colunas, funções com acesso, consulta). Relatório novo = uma entrada nesse arquivo.
- Mesma consulta para a prévia na tela (50 linhas) e para o CSV (até 50.000 linhas; acima disso o usuário reduz o período).
- CSV no padrão do Excel pt-BR (`;`, BOM UTF-8, CRLF), gerado em memória (sem disco, regra §9.1) e protegido contra *CSV injection*.
- Acesso: `admin`, `atendente` e `financeiro`; o relatório de usuários é só do `admin`. Isolamento por oficina via RLS.

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
- **Crescimento:** api é stateless → várias réplicas atrás do Caddy; Postgres gerenciado ou réplica de leitura; depois Kubernetes se necessário (ver §9).

## 9. Escalabilidade horizontal (pronto para Kubernetes)

Kubernetes **não** faz parte do MVP: a carga de uma oficina é baixa e uma VPS atende centenas delas. Mas o código deve estar sempre pronto para rodar com N réplicas da API atrás de um balanceador (compose com réplicas hoje, Kubernetes + HPA no futuro), sem reescrita.

### O que já atende

| Requisito | Como |
|---|---|
| Imagens independentes | `apps/api/Dockerfile`, `apps/web/Dockerfile` |
| API sem estado | Sessão em JWT no cookie; qualquer réplica atende qualquer request |
| Configuração externa | Só variáveis de ambiente (→ `ConfigMap`/`Secret`) |
| Migração fora da API | Serviço `migrate` (→ `Job` do Kubernetes) |
| Health check | `GET /api/saude` (→ liveness probe) |
| Desligamento limpo | SIGTERM fecha o servidor e o pool do Postgres |
| Logs | JSON no stdout (pino) |

### Regras obrigatórias para o código novo

1. **Nenhum arquivo no disco do container.** Por decisão do produto, **todos os dados ficam no PostgreSQL**, inclusive arquivos pequenos como o logo da oficina (`bytea`, até 1 MB), que assim entram no mesmo backup. Arquivos grandes e numerosos (fotos do checklist, PDFs) devem ser reavaliados quando chegarem: no banco enquanto o volume for pequeno; se o banco crescer demais, migrar para storage compatível com S3 (MinIO, R2, B2) guardando só a chave no banco.
2. **Nenhum estado compartilhado em memória.** Cache, contadores, rate limit, travas e filas ficam no Postgres ou, quando houver, no Redis. Cache em memória só para dados imutáveis ou que tolerem ficar diferentes entre réplicas.
3. **Sequências de negócio geradas no banco.** Códigos de usuário, função e vendedor (e, depois, o número da O.S.) vêm da tabela `contadores` pela função `proximo_codigo('<chave>')`, usada como DEFAULT da coluna (migração 0018): UPSERT com trava da linha dentro da transação, sem buraco quando o INSERT é desfeito. O trigger `impedir_troca_de_codigo` bloqueia alterar o código depois. Nunca em memória.
4. **Nada agendado dentro da API.** Tarefas periódicas (alerta de estoque mínimo, lembretes) rodam num processo `worker` separado ou garantem execução única com `pg_try_advisory_lock`. Com N réplicas, um `setInterval` na API roda N vezes.
5. **Conexões com o banco são finitas.** Cada réplica abre até `max` conexões (hoje 10). Ao escalar horizontalmente, colocar PgBouncer (modo transaction) na frente do Postgres. O `set_config(..., true)` do `withTenant` é local à transação, então é compatível com esse modo.

### Caminho de crescimento

| Estágio | Infraestrutura |
|---|---|
| MVP | `docker compose` em uma VPS |
| Dezenas de oficinas | VPS maior, backup automático, Postgres gerenciado |
| Centenas | 2–3 réplicas da API atrás do Caddy, PgBouncer, Redis |
| Carga variável/alta | Kubernetes gerenciado (k3s, DigitalOcean, GKE, EKS) com HPA; Postgres continua gerenciado, fora do cluster |

## 10. Roadmap

| Fase | Entrega |
|---|---|
| **0 — Scaffold** ✅ | Monorepo, cadastro da oficina, login, clientes e veículos com RLS |
| **0.1** ✅ | Admin inicial, gestão de usuários e funções (sem cadastro público) |
| **0.1b** ✅ | Style guide com tokens, cores parametrizáveis por oficina, aba de Relatórios com exportação CSV |
| **0.1c** ✅ | Logo da oficina (upload pelo admin, salvo no banco) |
| **0.1d** ✅ | Página inicial: atalhos do balcão (novo cliente, novo veículo, O.S., estoque, relatórios), indicadores e alertas vindos do banco (`GET /api/painel`); indicadores de módulos futuros aparecem como "em breve", nunca com número inventado |
| **0.1e** ✅ | Style guide configurável: botões principal/secundário (fundo e texto), aviso de contraste; tela de login com a marca da oficina (`/api/publico/*`) |
| **0.1f** ✅ | Funções e permissões configuráveis pelo admin (nível por módulo, várias funções por usuário) |
| **0.2** ✅ | Limite de tentativas de login (no Postgres, pela regra §9.2) e "alterar minha senha" |
| **1 — O.S.** | Abertura, itens (serviço/peça), orçamento, aprovação, status, checklist de entrada, PDF da O.S. |
| **2 — Estoque** | Peças, fornecedores, entradas, baixa automática pela O.S., alerta de estoque mínimo |
| **3 — Financeiro** | Contas a receber/pagar, registro de pagamentos, caixa diário, comissão de mecânico |
| **4 — Produção** | Rate limit das demais rotas, papéis/permissões, backup, deploy na VPS, observabilidade (OpenTelemetry) |
| **5 — SaaS** | Cobrança de assinatura, planos, onboarding, painel de administração |
| **ee/** | Emissão de NF-e/NFS-e, Pix/cartão integrados via gateway (Asaas/Mercado Pago/Efí), WhatsApp, multi-filial, BI |
