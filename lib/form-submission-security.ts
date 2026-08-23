import type { FormSettings, Layer } from '@/types';

const FORM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_PAYLOAD_FIELDS = 100;
const MAX_FIELD_LENGTH = 10_000;

export interface FormNotificationConfig {
  enabled: boolean;
  to: string;
  subject?: string;
}

export interface PublicFormConfig {
  notification: FormNotificationConfig | null;
}

export function isValidFormId(value: unknown): value is string {
  return typeof value === 'string' && FORM_ID_PATTERN.test(value);
}

export function sanitizeFormPayload(value: unknown): Record<string, string | string[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_PAYLOAD_FIELDS) return null;

  const sanitized: Record<string, string | string[]> = {};
  for (const [key, fieldValue] of entries) {
    if (!key || key.length > 128 || key === '__proto__' || key === 'constructor') return null;
    const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
    if (values.length > 50) return null;

    const strings: string[] = [];
    for (const item of values) {
      if (typeof item !== 'string' || item.length > MAX_FIELD_LENGTH) return null;
      strings.push(item);
    }
    sanitized[key] = Array.isArray(fieldValue) ? strings : strings[0];
  }
  return sanitized;
}

export function findPublicFormConfig(layerRows: Array<{ layers?: Layer[] | null }>, formId: string): PublicFormConfig | null {
  for (const row of layerRows) {
    const match = findForm(row.layers ?? [], formId);
    if (!match) continue;
    return { notification: normalizeNotification(match.settings?.form?.email_notification) };
  }
  return null;
}

function findForm(layers: Layer[], formId: string): Layer | null {
  for (const layer of layers) {
    if (layer.name === 'form' && (layer.settings?.id === formId || layer.id === formId)) return layer;
    const nested = findForm(layer.children ?? [], formId);
    if (nested) return nested;
  }
  return null;
}

function normalizeNotification(candidate: FormSettings['email_notification']): FormNotificationConfig | null {
  if (!candidate?.enabled || !isEmail(candidate.to)) return null;
  const subject = candidate.subject?.trim().slice(0, 200);
  return {
    enabled: true,
    to: candidate.to.trim(),
    ...(subject ? { subject } : {}),
  };
}

function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function createSlidingWindowRateLimiter(maxRequests: number, windowMs: number) {
  const timestampsByKey = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (timestampsByKey.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maxRequests) {
      timestampsByKey.set(key, recent);
      return false;
    }
    recent.push(now);
    timestampsByKey.set(key, recent);
    if (timestampsByKey.size > 10_000) {
      for (const [entryKey, values] of timestampsByKey) {
        if (values.every((timestamp) => now - timestamp >= windowMs)) timestampsByKey.delete(entryKey);
      }
    }
    return true;
  };
}
