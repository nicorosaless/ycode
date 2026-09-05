# Ycode (rin5 fork) — imagen de referencia para self-host en Docker.
#
# `next.config.ts` declara `output: 'standalone'`, así que el stage de
# runtime copia el bundle recortado que produce Next (`.next/standalone` +
# `.next/static`), no `node_modules` completo. Medido en P-2609/WS5
# (ver ops/README.md): 2.25GB (node_modules completo) -> ver ops/README.md
# para la cifra post-standalone.
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
# Placeholders por defecto para que `next build` no aborte por falta de
# credenciales — pero OJO: `app/(site)/page.tsx` SÍ hace fetch real contra
# Supabase durante la generación estática de "/" (fuentes, variables de
# color, settings de robots/sitemap). Con placeholders puros esa llamada
# falla (`fetch failed`, host inventado) y aborta el build entero — esto ya
# ocurre en la rama sin tocar `output: 'standalone'`, no es un efecto de este
# cambio. Fuera de alcance de P-2609/WS5 arreglar el prerender; documentado
# en el informe. Para medir la imagen de verdad, sobreescribe estos ARG con
# credenciales de un Supabase alcanzable en build time (p.ej. `--network
# host --build-arg SUPABASE_URL=http://127.0.0.1:57321 ...`).
ARG SUPABASE_PUBLISHABLE_KEY=build-placeholder
ARG SUPABASE_SECRET_KEY=build-placeholder
ARG SUPABASE_CONNECTION_URL=postgresql://build:build@localhost:5432/build
ARG SUPABASE_DB_PASSWORD=build-placeholder
ARG SUPABASE_URL
ENV SUPABASE_PUBLISHABLE_KEY=${SUPABASE_PUBLISHABLE_KEY} \
    SUPABASE_SECRET_KEY=${SUPABASE_SECRET_KEY} \
    SUPABASE_CONNECTION_URL=${SUPABASE_CONNECTION_URL} \
    SUPABASE_DB_PASSWORD=${SUPABASE_DB_PASSWORD} \
    SUPABASE_URL=${SUPABASE_URL} \
    PAGE_AUTH_SECRET=0000000000000000000000000000000000000000000000000000000000000000
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd -r ycode && useradd -r -g ycode ycode
# `.next/standalone` already contains a trimmed `node_modules` (only the
# packages actually reachable from the server bundle) plus a copy of
# package.json and a generated `server.js` entrypoint — no `npm ci` or full
# `node_modules` copy needed in this stage.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# knex migrations still run out-of-band via `npm run migrate:latest` against
# this same image/checkout, not at container start — kept for that use case.
COPY --from=builder /app/database ./database
COPY --from=builder /app/knexfile.ts ./knexfile.ts
USER ycode
EXPOSE 3202
ENV PORT=3202
CMD ["node", "server.js"]
