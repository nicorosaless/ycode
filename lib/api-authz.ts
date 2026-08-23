/**
 * Declarative server-side authorization matrix for builder API routes.
 *
 * Enforced centrally in `proxy.ts` after session authentication, so the
 * role model (owner > admin > designer > editor) holds on the server and
 * not only in the browser UI.
 *
 * Permission levels:
 * - `authenticated`   any signed-in role (including `editor`)
 * - `editStructure`   designer/admin/owner — structural builder changes
 * - `manageSettings`  designer/admin/owner — project config, publishing,
 *                     integrations, exports, destructive tooling
 *
 * The `editor` role is content-only. It must keep working end to end:
 * read everything its UI loads, save layers (text/image edits), upload and
 * pick assets, edit items of existing collections, edit translations, and
 * manage form submissions. Everything else is denied with 403.
 *
 * Decision notes per area:
 * - layers PUT: content saves (text/image edits) — allowed for editor.
 * - assets / asset-folders / files: "subir/elegir assets" is an editor
 *   task; the File manager is content-scoped, so full access.
 * - css/*: derived-artifact regeneration fired by the editor save flow
 *   (usePagesStore posts to /css/generate-pages after layer saves).
 *   Idempotent, no authored input — allowed for editor.
 * - versions POST: undo/redo history snapshots created on every save
 *   (hooks/use-undo-redo.ts) — allowed for editor.
 * - collections: item-level content ops allowed for editor; creating or
 *   deleting collections/fields, imports, reorder and CMS publish
 *   endpoints are structural/publishing — designer+.
 * - translations: text content — allowed for editor.
 * - publish / revert / project import-export / devtools / cache:
 *   publishing and destructive project ops — manageSettings. rin5
 *   orchestrates publishing server-side in Basic mode.
 * - api-keys / webhooks / mcp-tokens / oauth/authorize: any of these
 *   mints credentials that bypass the session proxy (API keys, MCP
 *   tokens), so even reads are manageSettings.
 * - apps/*: third-party integrations (Airtable, Webflow, MailerLite,
 *   static export) — manageSettings, all methods.
 * - settings: reads stay open (builder UI loads config), mutations are
 *   manageSettings (includes settings/batch, which flips feature flags).
 * - /api/templates (outside /ycode): destructive apply/export ops —
 *   mutations require manageSettings.
 * - Default: unknown mutations require editStructure (fail closed for
 *   editor), reads require authentication only.
 */

import { canEditStructure, canManageSettings, type UserRole } from './roles';

export type ApiPermission = 'authenticated' | 'editStructure' | 'manageSettings';

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

interface AuthzRule {
  /** Path prefix (segment-safe) or full-path regex. */
  pattern: string | RegExp;
  /** HTTP methods the rule applies to. Omitted = all methods. */
  methods?: readonly string[];
  permission: ApiPermission;
}

/** Ordered rules — first match wins. */
export const API_AUTHZ_RULES: readonly AuthzRule[] = [
  // ---- Editor-allowed content operations (explicit allow-list) ----
  { pattern: '/ycode/api/layers', methods: ['PUT'], permission: 'authenticated' },
  { pattern: '/ycode/api/assets', permission: 'authenticated' },
  { pattern: '/ycode/api/asset-folders', permission: 'authenticated' },
  { pattern: '/ycode/api/files', permission: 'authenticated' },
  { pattern: '/ycode/api/css', permission: 'authenticated' },
  { pattern: '/ycode/api/versions', methods: ['POST'], permission: 'authenticated' },
  // CMS publish endpoints are gated before the item-level allow rules.
  { pattern: /^\/ycode\/api\/collections\/items\/publish$/, permission: 'editStructure' },
  { pattern: /^\/ycode\/api\/collections\/[^/]+\/publish$/, permission: 'editStructure' },
  // Item-level content ops on existing collections.
  { pattern: /^\/ycode\/api\/collections\/items(\/|$)/, permission: 'authenticated' },
  { pattern: /^\/ycode\/api\/collections\/[^/]+\/items(\/|$)/, permission: 'authenticated' },
  { pattern: '/ycode/api/translations', permission: 'authenticated' },
  { pattern: '/ycode/api/form-submissions', permission: 'authenticated' },
  { pattern: '/ycode/api/profile', permission: 'authenticated' },
  { pattern: '/ycode/api/maps', permission: 'authenticated' },
  { pattern: '/ycode/api/editor', permission: 'authenticated' },

  // ---- Settings-level areas (all methods, reads included) ----
  { pattern: '/ycode/api/publish', permission: 'manageSettings' },
  { pattern: '/ycode/api/revert', permission: 'manageSettings' },
  { pattern: '/ycode/api/project', permission: 'manageSettings' },
  { pattern: '/ycode/api/devtools', permission: 'manageSettings' },
  { pattern: '/ycode/api/cache', permission: 'manageSettings' },
  { pattern: '/ycode/api/api-keys', permission: 'manageSettings' },
  { pattern: '/ycode/api/webhooks', permission: 'manageSettings' },
  { pattern: '/ycode/api/mcp-tokens', permission: 'manageSettings' },
  { pattern: '/ycode/api/oauth/authorize', permission: 'manageSettings' },
  { pattern: '/ycode/api/apps', permission: 'manageSettings' },
  { pattern: '/ycode/api/ai', permission: 'manageSettings' },
  { pattern: '/ycode/api/updates', permission: 'manageSettings' },
  { pattern: '/ycode/api/setup', permission: 'manageSettings' },
  { pattern: '/ycode/api/auth/invite', permission: 'manageSettings' },
  { pattern: '/ycode/api/auth/set-role', permission: 'manageSettings' },
  { pattern: '/ycode/api/auth/users', permission: 'manageSettings' },

  // ---- Settings-level mutations (reads stay authenticated) ----
  { pattern: '/ycode/api/settings', methods: MUTATING, permission: 'manageSettings' },
  { pattern: '/api/templates', methods: MUTATING, permission: 'manageSettings' },

  // ---- Defaults ----
  // Any other mutation under the builder API is structural — designer+.
  { pattern: '/ycode/api', methods: MUTATING, permission: 'editStructure' },
];

function matches(rule: AuthzRule, pathname: string, method: string): boolean {
  if (rule.methods && !rule.methods.includes(method)) return false;
  if (rule.pattern instanceof RegExp) return rule.pattern.test(pathname);
  return pathname === rule.pattern || pathname.startsWith(rule.pattern + '/');
}

/**
 * Resolve the permission required for a request. Reads (GET/HEAD/OPTIONS)
 * not covered by an explicit rule only require authentication.
 */
export function requiredPermission(pathname: string, method: string): ApiPermission {
  const normalizedMethod = method.toUpperCase();
  for (const rule of API_AUTHZ_RULES) {
    if (matches(rule, pathname, normalizedMethod)) return rule.permission;
  }
  return 'authenticated';
}

export function roleHasPermission(role: UserRole, permission: ApiPermission): boolean {
  switch (permission) {
    case 'authenticated':
      return true;
    case 'editStructure':
      return canEditStructure(role);
    case 'manageSettings':
      return canManageSettings(role);
  }
}
