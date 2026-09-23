# Build a partir da raiz do repositório: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS build
RUN npm install -g pnpm@12.5.1
WORKDIR /repo

# Só os manifestos primeiro: a camada de dependências fica em cache enquanto elas não mudarem.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @mobios/api...

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @mobios/api build \
 && pnpm --filter @mobios/api deploy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/drizzle ./drizzle
USER node
EXPOSE 3333
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3333/api/saude || exit 1
CMD ["node", "dist/server.js"]
