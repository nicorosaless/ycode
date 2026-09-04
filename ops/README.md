# Ops — arrancar este fork en local / Docker

Notas de la investigación WS5 (P-2609). Estado medido el 2026-09-05 en la
ubuntu-devbox.

## 1. Qué necesita para arrancar

- **Postgres** vía Supabase (auth, storage, PostgREST). Este repo trae su
  propio `supabase/config.toml` con `project_id = "ycode-spike"` y puertos
  **573xx** (API 57321, DB 57322, Studio 57323, Inbucket 57324, Analytics
  57327) — no chocan con los stacks `supabase_*_rin5` (543xx) ni
  `supabase_*_kora` (543xx) que ya corren en esta máquina.
- **Variables de entorno** (`.env`, ver `.env.example`): credenciales
  Supabase (`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
  `SUPABASE_CONNECTION_URL`, `SUPABASE_DB_PASSWORD`, `SUPABASE_URL` para
  self-hosted), `PAGE_AUTH_SECRET` (`openssl rand -hex 32`), y para el
  boundary rin5: `RIN5_SITE_ID` (**debe ser un UUID**, no un id corto —
  `lib/rin5-internal-auth.ts` lo valida con regex UUID), `RIN5_INTERNAL_API_SECRET`
  (≥32 caracteres) y `RIN5_EDITOR_BASE_URL`.
- `lib/credentials.ts` lee credenciales solo de `process.env` (nunca de un
  wizard en runtime, salvo que arranques sin `.env` y pases por
  `/ycode/api/setup/connect`, que persiste a `.env` en disco).

## 2. Levantar en local (sin Docker)

```bash
supabase start                      # usa los puertos de supabase/config.toml
cp .env.example .env                 # y rellena con la salida de `supabase start`
npm ci
npm run migrate:latest               # ver "Defecto encontrado" más abajo
npm run build && npm run start -- -p 3202   # o `npm run dev` en 3002
```

### Defecto encontrado: `npm run migrate:latest` falla tal cual está documentado

`CONTRIBUTING.md` documenta `npm run migrate:latest` sin más, pero falla en
este fork:

1. `knexfile.ts` importa `lib/credentials.ts`, que hace `import 'server-only'`.
   Ese paquete lanza siempre que se `require`ea fuera de Next.js — el CLI de
   knex lo hace directo y revienta con
   `This module cannot be imported from a Client Component module`.
   `scripts/rin5-import.ts` y `scripts/export.ts` ya conocen este problema y
   parchean `Module.prototype.require` antes de cargar nada; el script de
   npm `migrate:latest` no lo hace.
2. Las migraciones usan el alias `@/lib/...`, que necesita
   `tsconfig-paths/register` — tampoco está en el script de npm (sí en
   `test` y en `agent:tools`/`agent:smoke`).

Workaround usado en esta investigación (sin tocar el repo):

```bash
cat > /tmp/server-only-shim.cjs <<'EOF'
const Module = require('module');
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'server-only') return {};
  return orig.call(this, id);
};
EOF
set -a && source .env && set +a
NODE_OPTIONS="--require /tmp/server-only-shim.cjs --require tsconfig-paths/register" \
  NODE_NO_WARNINGS=1 npx knex migrate:latest --knexfile knexfile.ts
```

Con esto: `Batch 1 run: 43 migrations`. No se ha tocado `package.json` — el
fix real sería añadir el mismo require-shim que ya usan `scripts/*.ts` al
script `migrate:latest`, o mover la config de Supabase de `knexfile.ts` a un
módulo sin `server-only`.

### Defecto encontrado: las migraciones no dan GRANT a los roles de Supabase

Tras migrar, cualquier request autenticado en el editor devuelve
`permission denied for table pages` (y lo mismo para `page_layers`,
`assets`, `settings`, etc.). Las migraciones de este fork son SQL/knex
puro contra el rol `postgres`; no incluyen los `GRANT`/`ALTER DEFAULT
PRIVILEGES` que Supabase normalmente aplica a `anon`/`authenticated`/
`service_role` cuando las tablas se crean por el flujo estándar de
Supabase. Workaround aplicado (una vez, contra el Postgres local):

```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
```

Sin esto, el editor no carga ninguna página (todas las llamadas a
`/ycode/api/*` fallan) aunque el server use la service-role key. Cualquier
guía de self-host de este fork necesita este paso o una migración que lo
haga.

## 3. Docker

`Dockerfile` (multi-stage, Node 22) y `compose.yml` de referencia en la raíz
del repo. Puntos importantes:

- `next.config.ts` **no** declara `output: 'standalone'`, así que la imagen
  copia `node_modules` completo en el stage de runtime — no el bundle
  reducido que produce Next con standalone. Activar `output: 'standalone'`
  reduciría el tamaño de imagen de forma notable, pero es un cambio de
  comportamiento de build fuera del alcance de este diagnóstico.
- El build (`next build`) necesita variables de Supabase con forma válida
  (aunque no se conecte a nada durante el build) — el Dockerfile las pasa
  como placeholders en el stage `builder`.
- El contenedor de Supabase CLI local corre en la red default de Docker, no
  en la red del `compose.yml` de la app; por eso `compose.yml` usa
  `host.docker.internal` + `extra_hosts: host-gateway` en vez de nombres de
  servicio.
- `mem_limit: 768m` en el compose de referencia: con la app en reposo (sin
  build, solo runtime) el proceso Next usa muchísimo menos, ver
  `docs/investigacion-ws5.md` en el PRD para las cifras medidas.

## 4. Servicios dejados corriendo tras esta investigación

- `supabase start` de este repo (`supabase_*_ycode-spike`, puertos 573xx)
  queda **arriba** porque la siguiente fase de WS5/import puede reutilizarlo.
  Pararlo con `supabase stop` desde `/home/nicolas-rosales/src/ycode-spike`.
- El proceso `next start -p 3202` levantado a mano y los `python3 -m
  http.server` usados para servir los bundles comparados se han parado al
  cerrar esta investigación.
