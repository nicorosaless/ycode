# Tenant RLS: amenazas pendientes

La migración `20260908000001_enforce_verified_tenant_editor_rls` cierra la lectura y escritura cruzada de borradores en `pages` y `page_layers` para identidades autenticadas de la pila Supabase compartida.

No cambia `storage.objects`: es una tabla global, y sus policies actuales aceptan cualquier usuario autenticado del bucket `assets`. Cada tenant escribe bajo `RIN5_STORAGE_PREFIX`, pero el prefijo por sí solo no impide que otro JWT autenticado lea o escriba una ruta conocida. Una policy global que consulte una tabla de membresías de un schema concreto rompería los demás tenants. Hace falta un registro de membresías global y una policy coordinada para Storage antes de exponer subida/lectura directa a clientes no confiables.

La migración sustituye las policies de todas las tablas propias del schema. Un bucket Supabase `public=true` puede servir una URL conocida sin consultar RLS: la policy global protege Data API y escrituras cruzadas, pero la confidencialidad de objetos sensibles requiere un bucket privado y serving desde backend.
