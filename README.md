# MobiOS

Gestão de Ordens de Serviço para oficinas mecânicas. Web, multi-tenant (SaaS) e open core.

- Arquitetura e decisões: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- Licença: núcleo AGPL-3.0-or-later ([LICENSE](LICENSE)); `ee/` sob licença comercial

## Requisitos

- Node.js 22+ e pnpm 10+
- PostgreSQL 17. O jeito mais simples é via Docker, usando uma destas opções gratuitas:
  - macOS: [Colima](https://github.com/abiosoft/colima) ou Docker Desktop
  - Windows: [Podman Desktop](https://podman-desktop.io), [Rancher Desktop](https://rancherdesktop.io) ou Docker Desktop (Docker Desktop tem licença paga para empresas com mais de 250 funcionários)
  - Linux: Docker Engine

## Rodando tudo em Docker

```bash
cp .env.example .env              # troque JWT_SECRET, ADMIN_EMAIL e ADMIN_SENHA
docker compose up -d --build      # db → migrate → api → web
```

Acesse http://localhost:8080 e entre com `ADMIN_EMAIL` / `ADMIN_SENHA`. O admin inicial é criado só na primeira subida (banco sem usuários); os demais usuários são cadastrados por ele, em **Usuários**.

Serviços:

| Serviço | O que é |
|---|---|
| `db` | PostgreSQL 17 (dados no volume `mobios_db-data`; porta 5432 só em 127.0.0.1) |
| `migrate` | Aplica as migrações, cria o admin inicial se preciso e encerra; a API só sobe se ele terminar com sucesso |
| `api` | API Fastify (porta 3333, só na rede interna do Docker) |
| `web` | Caddy servindo o front e repassando `/api/*` para a API |

Comandos úteis: `docker compose logs -f api`, `docker compose down` (mantém os dados), `docker compose down -v` (**apaga o banco**).

## Desenvolvimento (hot reload)

```bash
docker compose up -d db           # só o banco
pnpm install
pnpm db:migrate
pnpm dev                          # api em :3333, web em http://localhost:5173
```

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | API e web com hot reload |
| `pnpm test` | Testes (a API precisa do Postgres rodando e migrado) |
| `pnpm typecheck` | Checagem de tipos em todos os pacotes |
| `pnpm db:generate` | Gera migração SQL a partir de `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | Aplica migrações pendentes |

## Estrutura

```
apps/api         Fastify + Drizzle (monolito modular: src/modules/<modulo>)
apps/web         React + Vite + Tailwind
packages/shared  Schemas Zod usados pela API e pelo front
infra/db         Script de criação dos usuários do banco (roda na 1ª subida do volume)
infra/caddy      Configuração do Caddy (proxy + arquivos estáticos)
ee/              Módulos comerciais (vazio)
```
