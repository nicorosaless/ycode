# Ycode (rin5 fork) — imagen de referencia para self-host en Docker.
#
# `next.config.ts` no declara `output: 'standalone'`, así que esta imagen
# copia `node_modules` completo en el stage de runtime (no el bundle
# reducido de Next). Es más pesada de lo estrictamente necesario; activar
# `output: 'standalone'` en next.config.ts reduciría bastante el tamaño de
# la capa final, pero eso es un cambio de comportamiento de build que queda
# fuera de este spike (WS5) — ver ops/README.md.
#
# Build:
#   docker build -t ycode-spike:local .
# Run (necesita Supabase, ver ops/README.md o compose.yml):
#   docker run --rm -p 3202:3202 --env-file .env ycode-spike:local

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Variables dummy solo para que `next build` no aborte por falta de
# credenciales de Supabase (no se conectan a nada durante el build).
ENV SUPABASE_PUBLISHABLE_KEY=build-placeholder \
    SUPABASE_SECRET_KEY=build-placeholder \
    SUPABASE_CONNECTION_URL=postgresql://build:build@localhost:5432/build \
    SUPABASE_DB_PASSWORD=build-placeholder \
    PAGE_AUTH_SECRET=0000000000000000000000000000000000000000000000000000000000000000
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd -r ycode && useradd -r -g ycode ycode
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/database ./database
COPY --from=builder /app/knexfile.ts ./knexfile.ts
USER ycode
EXPOSE 3202
CMD ["npx", "next", "start", "-p", "3202"]
