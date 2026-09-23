# Build a partir da raiz do repositório: docker build -f apps/web/Dockerfile .
FROM node:24-alpine AS build
RUN npm install -g pnpm@12.5.1
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @mobios/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @mobios/web build

# Caddy serve o build estático e repassa /api/* para a API (mesma origem = cookie de sessão sem CORS).
FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 80
