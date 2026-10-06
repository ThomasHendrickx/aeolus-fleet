import { counted } from './sentence';

const JSON_INDENT = 2;

/** Whether a content type is JSON: application/json, or any +json type, parameters aside. */
export function isJson(contentType: string): boolean {
  const essence = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return essence === 'application/json' || essence.endsWith('+json');
}

/**
 * A payload laid out for reading: JSON indented when its content type says
 * JSON and it parses; undefined otherwise, when Raw is the only view. The
 * console never changes a payload; this is display only.
 */
export function formattedPayload(payload: string, contentType: string): string | undefined {
  if (!isJson(contentType)) {
    return undefined;
  }
  try {
    return JSON.stringify(JSON.parse(payload), null, JSON_INDENT);
  } catch {
    return undefined;
  }
}

/** "JSON · 156 bytes", "text/plain · 12 bytes": what a payload is and its size in UTF-8. */
export function payloadLabel(payload: string, contentType: string): string {
  const kind = isJson(contentType) ? 'JSON' : (contentType.split(';')[0]?.trim() ?? contentType);
  const bytes = new TextEncoder().encode(payload).byteLength;
  return `${kind} · ${counted(bytes, { one: 'byte', many: 'bytes' })}`;
}
