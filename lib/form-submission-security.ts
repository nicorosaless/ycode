const FORM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_PAYLOAD_FIELDS = 100;
const MAX_FIELD_LENGTH = 10_000;
const MAX_CONFIG_BYTES = 64 * 1024;

export interface FormNotificationConfig {
  enabled: true;
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

export function configuredPublicForm(formId: string, source: Record<string, string | undefined> = process.env): PublicFormConfig | null {
  const raw = source.RIN5_FORM_CONFIG_JSON;
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_CONFIG_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const candidate = (parsed as Record<string, unknown>)[formId];
  if (candidate === null) return { notification: null };
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'to' && key !== 'subject')) return null;
  if (typeof record.to !== 'string' || !isEmail(record.to.trim())) return null;
  const subject = typeof record.subject === 'string' ? record.subject.trim().slice(0, 200) : '';
  return { notification: { enabled: true, to: record.to.trim(), ...(subject ? { subject } : {}) } };
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
