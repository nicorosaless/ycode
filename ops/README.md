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
  (≥32 caracteres) y `RIN5_EDITOR_BASE_URL`. Multi-tenant: `RIN5_DB_SCHEMA`,
  `RIN5_STORAGE_PREFIX` y `RIN5_ALLOWED_EMAILS`, todas opcionales y todas
  explicadas en §5.
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

**Los cuatro pasos en un comando.** `npm run rin5:roundtrip` hace este ciclo
entero por cliente, contra su schema, y deja un `roundtrip.json` con lo que
salió — ver §5.5. Los comandos sueltos de arriba siguen siendo la forma de
depurar un paso concreto.

**Destino del export.** El writer local escribe en `./out` salvo que se
configure otra ruta en `app_settings` (`static-export` / `local_path`). Copia el
bundle a donde lo quieras conservar antes del siguiente ciclo; el import borra y
reinserta las páginas, así que un export nuevo pisa al anterior.

## 5. Multi-tenant: un stack Supabase, un schema por cliente

Estado medido el 2026-09-05 en la ubuntu-devbox, stack `supabase_*_ycode-spike`
(573xx). El modelo que valida este spike:

```text
  un stack Supabase compartido (Postgres + GoTrue + PostgREST + Storage)
    ├── schema public       ← nada de clientes
    ├── schema cliente_a    ← contenedor Ycode A, prefijo cliente_a/ en el bucket
    └── schema cliente_b    ← contenedor Ycode B, prefijo cliente_b/ en el bucket
```

Un stack entero por cliente no cabe en 2 GB (§5.4). Una instalación de Ycode
sigue siendo un sitio: lo que se multiplica es el contenedor, no el stack.

### 5.1 Las tres variables

Todas viven en `lib/tenant.ts`, sin `server-only`, para que las lean tanto la
app como `knexfile.ts` y los scripts sueltos. Los valores por defecto
reproducen la instalación mono-tenant exacta.

| Variable | Defecto | Qué hace |
|---|---|---|
| `RIN5_DB_SCHEMA` | `public` | Schema de Postgres del cliente. Knex migra y consulta ahí (`searchPath`), y todos los clientes supabase-js se crean con `db: { schema }` |
| `RIN5_STORAGE_PREFIX` | el propio schema | Carpeta del cliente dentro del bucket compartido `assets` |
| `RIN5_ALLOWED_EMAILS` | sin restricción | Lista de correos admitidos en este contenedor |

`resolveDbSchema` lanza si el valor no es un identificador plano: una errata que
cayera en silencio sobre `public` metería las páginas de un cliente en el schema
de otro.

### 5.2 PostgREST tiene que exponer el schema, y el orden importa

PostgREST solo responde por los schemas de `PGRST_DB_SCHEMAS`; uno que exista
pero no esté listado devuelve `PGRST106`. En el stack del CLI eso es la línea
`schemas` de `supabase/config.toml`; en un self-host, el env del contenedor
`rest`.

**Trampa medida:** PostgREST se niega a cargar su caché de schemas si uno de los
listados no existe, y entra en bucle de reintento hasta que el healthcheck de
`supabase start` se rinde con `supabase_rest_ycode-spike unexpected status 503`:

```text
Failed to load the schema cache using db-schemas=public,graphql_public,cliente_a,…
  {"code":"3F000","message":"schema \"cliente_a\" does not exist"}
```

El orden de aprovisionamiento de un cliente nuevo es, por tanto:

```bash
# 1. crear el schema ANTES de listarlo
psql -c 'CREATE SCHEMA IF NOT EXISTS cliente_x'
# 2. añadirlo a supabase/config.toml (o a PGRST_DB_SCHEMAS) y recargar
supabase stop && supabase start
```

Por lo mismo, `scripts/rin5-roundtrip.ts` limpia con
`DROP SCHEMA … CASCADE; CREATE SCHEMA …` en una sola sentencia: el schema no
puede desaparecer ni un instante visto desde fuera.

`searchPath` es `[schema, 'extensions']`, no solo el schema: pgcrypto vive en
`extensions` y sin él la migración `20260528000002_hash_mcp_refresh_tokens`
muere con `function digest(character varying, unknown) does not exist`.
`public` queda deliberadamente **fuera** del search path, para que una tabla que
falte en el schema del cliente falle a gritos en vez de resolverse contra los
restos de otro.

La migración `20260905000001_grant_supabase_roles` aplica los GRANT sobre el
schema del cliente. Sin ella, PostgREST responde `permission denied` aunque el
schema esté expuesto (§2).

### 5.3 GoTrue es global: el schema no aísla usuarios

Auth vive en el schema `auth` del stack compartido, así que la sesión de un
usuario de otro cliente es perfectamente válida en este contenedor.
`RIN5_ALLOWED_EMAILS` se comprueba en dos sitios: en `proxy.ts`, por donde pasa
toda petición autenticada, y en `/ycode/api/rin5/handoff`, que es donde se acuña
la sesión — rechazar después de crear el usuario en GoTrue dejaría la cuenta
detrás aunque la petición fallase.

Medido con dos contenedores contra el mismo stack (`:3210` = `cliente_a` con
`RIN5_ALLOWED_EMAILS=ana@cliente-a.test`, `:3211` = `cliente_b` con
`bob@cliente-b.test`):

| Petición | Resultado |
|---|---|
| handoff de `ana@cliente-a.test` en `:3210` | `200`, magic link emitido |
| handoff de `bob@cliente-b.test` en `:3210` | `403 rin5_email_not_allowed_for_this_site`, y **no** se crea el usuario en `auth.users` |
| sesión de ana en `:3210` → `GET /ycode/api/pages` | `200`, las 8 slugs de `cliente_a` |
| **misma** sesión de ana en `:3211` | `403 {"error":"Forbidden","reason":"email_not_allowed_for_this_site"}` |
| misma sesión en un tercer contenedor de `cliente_b` **sin** `RIN5_ALLOWED_EMAILS` | `200`, y ana ve y edita las 8 slugs de `cliente_b` |

La última fila es la que justifica la variable: el schema por sí solo no aísla
usuarios.

### 5.4 Memoria, para dimensionar la caja de 2 GB

Imagen `ycode-spike:tenant` (`output: 'standalone'`, 540 MB), un contenedor por
cliente contra el stack local. `MemUsage` es el `docker stats` (cgroup), `RSS`
es `VmRSS` del proceso 1 dentro del contenedor:

| Contenedor Ycode | MemUsage | RSS |
|---|---:|---:|
| recién arrancado, sin una sola petición | 61,5 MiB | 111 MB |
| con el editor abierto en el navegador | 345,1 MiB | 418 MB |

(La medida anterior a este spike, 169/374 MB, era sobre otra imagen; el reposo
baja porque `docker stats` mide una cgroup recién reiniciada, sin caché.)

Stack Supabase completo, en reposo: **1008 MiB** repartidos así:

| Servicio | MemUsage | ¿Lo necesita Ycode? |
|---|---:|---|
| `db` (Postgres) | 129,3 MiB | **Sí** |
| `storage` | 115,7 MiB | **Sí** — assets |
| `kong` | 105,8 MiB | **Sí** — es el `:57321` al que hablan todos los clientes |
| `rest` (PostgREST) | 94,8 MiB | **Sí** — toda la data API |
| `auth` (GoTrue) | 15,5 MiB | **Sí** — magic link del handoff |
| `realtime` | 240,2 MiB | No. Solo alimenta los `hooks/use-live-*` (edición colaborativa, cursores) |
| `studio` | 188,6 MiB | No. UI de desarrollo |
| `pg_meta` | 86,4 MiB | No. Solo lo consume Studio |
| `edge_runtime` | 23,5 MiB | No. Este fork no usa edge functions |
| `inbucket`/mailpit | 7,8 MiB | No. Buzón de pruebas local |
| `analytics` (logflare) | — | No. Ya está `enabled = false` en `config.toml` |
| `imgproxy` | — | No aparece: la transformación de imágenes está desactivada, y Ycode sirve por su propio proxy `/a/<hash>/…` |

**Núcleo mínimo medido con los cinco de arriba parados: 459,9 MiB**, y el editor
carga y renderiza igual — sin `realtime` la única consecuencia observada es
ruido de reintento de WebSocket en la consola del navegador, ninguna función del
editor se rompe.

Cuentas para 2 GB: ~460 MiB de stack mínimo dejan ~1,5 GB. El límite no son los
contenedores en reposo (61 MiB cada uno) sino los editores abiertos a la vez
(345 MiB cada uno): **~4 editores simultáneos**, con decenas de contenedores en
reposo por debajo.

### 5.5 El round-trip por cliente, en un comando

`scripts/rin5-roundtrip.ts` es lo que ejecuta el worker de generación: limpia el
schema y la carpeta del cliente en el bucket, migra desde cero, importa,
publica, exporta con los bytes originales y escribe `roundtrip.json`.

```bash
npm run rin5:roundtrip -- \
  --site-dir /home/nicolas-rosales/src/rin5/clients/7/site \
  --out-dir  /home/nicolas-rosales/.rin5/ycode-multitenant/cliente_a \
  --schema   cliente_a
```

Corre sin servidor Next arrancado, como los otros tres scripts, y `--schema
public` se rechaza porque el comando tira el schema que le den.
`--storage-prefix` existe si el prefijo del bucket tiene que ser distinto del
nombre del schema.

Duración medida con `clients/7/site` (9 páginas, 6 imágenes) contra el stack
local, incluyendo las 44 migraciones desde cero: **6,2–8,3 s** (tres
ejecuciones: 6769, 6228, 8333 ms).

`roundtrip.json`:

```json
{
  "schema": "cliente_a",
  "storagePrefix": "cliente_a",
  "pages": 12,
  "assets": 6,
  "files": 18,
  "bundleSha256": "8c33dc51c059ac38…",
  "durationMs": 6769
}
```

`pages: 12` son las 9 del sitio más `401`/`404`/`500`. **`bundleSha256` no es un
hash reproducible:** el importador acuña un `data-layer-id` nuevo por capa en
cada ejecución, así que dos round-trips de la misma entrada dan digests
distintos (medido; el HTML no difiere en nada más). Sirve para distinguir el
bundle de un cliente del de otro y para detectar que un bundle cambió tras una
edición, no para comprobar determinismo.

### 5.6 El aislamiento, comprobado

`clients/7/site` en `cliente_a` y `~/.rin5/bench/7-baseline/site` en
`cliente_b`, mismo stack, exportados los dos:

```text
páginas exclusivas   a-only: consulta-nota, test-dgt
                     b-only: consulta-tus-notas, test-online-dgt
assets               los 6 de cliente_a y los 7 de cliente_b, nombres disjuntos
storage.objects      cliente_a/ → 6    cliente_b/ → 7    website/ → 6 (restos
                     del mono-tenant anterior en public)
PostgREST            Accept-Profile: cliente_a → solo las 8 slugs de A
                     Accept-Profile: cliente_b → solo las 8 slugs de B
bundles exportados   0 referencias cruzadas a assets o slugs del otro cliente
```

### 5.7 Trampa de `docker run --env-file`

`docker run --env-file` **no** quita las comillas: el `.env` que escribe el
wizard de setup guarda `SUPABASE_CONNECTION_URL="postgresql://…"` y el
contenedor recibe la URL con las comillas dentro, así que `parseSupabaseConfig`
falla y `/ycode/api/supabase/config` responde 404 "not configured". Hay que
pasarle un fichero sin comillas. Y `SUPABASE_URL` tiene que ser alcanzable
**desde el navegador y desde el contenedor a la vez** — `host.docker.internal`
solo lo resuelve el contenedor; en esta caja funciona `http://172.17.0.1:57321`
(la interfaz `docker0`, donde Kong publica en `0.0.0.0:57321`).

## 6. Servicios dejados corriendo tras esta investigación

- `supabase start` de este repo (`supabase_*_ycode-spike`, puertos 573xx)
  queda **arriba** porque la siguiente fase de WS5/import puede reutilizarlo.
  Pararlo con `supabase stop` desde `/home/nicolas-rosales/src/ycode-spike`.
  Los schemas `cliente_a` y `cliente_b` quedan poblados y listados en
  `supabase/config.toml`; borrarlos exige quitarlos también de esa línea, o
  PostgREST no arrancará (§5.2).
- El proceso `next start -p 3202` levantado a mano se ha parado al cerrar la
  investigación. `scripts/rin5-roundtrip-diff.mjs` levanta sus propios
  servidores HTTP en puertos efímeros y los cierra al terminar: no deja nada
  escuchando.
