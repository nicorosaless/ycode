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
npm run migrate:latest
npm run build && npm run start -- -p 3202   # o `npm run dev` en 3002
```

### Defecto encontrado y corregido: `npm run migrate:latest` fallaba tal cual está documentado

`CONTRIBUTING.md` documenta `npm run migrate:latest` sin más, y en este fork
fallaba por dos razones:

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

**Corregido en este repo:** los scripts `migrate:*` de `package.json` cargan ya
`./scripts/server-only-shim.cjs` (el mismo require-patch que instalan
`scripts/rin5-import.ts`, `scripts/rin5-publish.ts` y `scripts/export.ts`) y
`tsconfig-paths/register`, así que `npm run migrate:latest` funciona tal cual.
Salida esperada la primera vez: `Batch 1 run: 43 migrations`. La corrección de
fondo — sacar la config de Supabase de `knexfile.ts` a un módulo sin
`server-only` — sigue pendiente.

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

## 4. El ciclo rin5: import → publish → export

Los tres pasos del round-trip se ejecutan sin abrir el editor. Todos leen `.env`
y hablan con el Supabase de 573xx.

```bash
export RIN5_SITE_DIR=/home/nicolas-rosales/src/rin5/clients/7/site
export TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.test.json NODE_NO_WARNINGS=1
set -a && source .env && set +a

# 1. import — pages + page_layers en BORRADOR, assets a Storage, fuentes
node --require ts-node/register --require tsconfig-paths/register scripts/rin5-import.ts

# 2. publish — sin esto el export no ve nada
npm run rin5:publish

# 3. export — a `./out` (destino por defecto del writer local)
RIN5_EXPORT_ORIGINAL_ASSETS=1 \
  node --require ts-node/register --require tsconfig-paths/register scripts/export.ts

# 4. medir contra el HTML de entrada
node scripts/rin5-roundtrip-diff.mjs \
  --src "$RIN5_SITE_DIR" --out ./out --diff /tmp/roundtrip-diff \
  --pages index,contacto,permisos,permiso-a,permiso-b
```

**Por qué existe `npm run rin5:publish`.** `scripts/rin5-import.ts` solo escribe
filas de borrador y el export estático solo lee `is_published = true`: sin un
publish en medio, un import recién hecho exporta el sitio *anterior*. El script
llama directamente al handler `POST` de
`app/(builder)/ycode/api/publish/route.ts` con un `NextRequest` sintético, en vez
de reimplementar el orden de publicación, para no desviarse de lo que hace el
botón "Publish" de la UI. Acepta `-- --pages <id>,<id>` para publicar solo unas
páginas.

**Línea de error esperada.** El publish por CLI imprime siempre:

```
❌ [Cache] Invalidation error: Invariant: static generation store missing in revalidateTag route-/…
```

No es un fallo. La cola de invalidación del handler llama a `next/cache`, que
necesita el contexto de petición de un servidor Next, y aquí no hay servidor que
invalidar. El handler lo envuelve en try/catch y el export lee la base de datos
directamente. Fíate de la línea `✓ Published`, no de la ausencia de ese error.

**`RIN5_EXPORT_ORIGINAL_ASSETS=1`.** Sin esta variable el export sirve cada foto
por el proxy de imágenes de Ycode (`/a/<hash>/<slug>.jpg?width=…&quality=85` más
un `srcset` de siete candidatos), lo que hace un bundle imposible de comparar
con el HTML de entrada. Con ella, todo asset que subió `rin5-import` sale en
`assets/<filename>` con sus bytes originales, sin query, sin `srcset` y sin
`sizes`. Solo afecta a las filas con `source = 'rin5-import'`; lo subido desde
el editor conserva el pipeline responsive. Ver
`lib/apps/static-export/original-assets.ts`.

**Destino del export.** El writer local escribe en `./out` salvo que se
configure otra ruta en `app_settings` (`static-export` / `local_path`). Copia el
bundle a donde lo quieras conservar antes del siguiente ciclo; el import borra y
reinserta las páginas, así que un export nuevo pisa al anterior.

## 5. Servicios dejados corriendo tras esta investigación

- `supabase start` de este repo (`supabase_*_ycode-spike`, puertos 573xx)
  queda **arriba** porque la siguiente fase de WS5/import puede reutilizarlo.
  Pararlo con `supabase stop` desde `/home/nicolas-rosales/src/ycode-spike`.
- El proceso `next start -p 3202` levantado a mano se ha parado al cerrar la
  investigación. `scripts/rin5-roundtrip-diff.mjs` levanta sus propios
  servidores HTTP en puertos efímeros y los cierra al terminar: no deja nada
  escuchando.
