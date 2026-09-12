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
# The build never receives a tenant credential. SKIP_SETUP prevents the
# static site layout from querying Supabase, so the image is reusable for all
# clients and the builder stage cannot retain a credential in ENV or history.
RUN SKIP_SETUP=true npm run build && rm -rf .next/cache

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
