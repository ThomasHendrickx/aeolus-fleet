import { isJson } from '../../../lib/payload';

/** How the Messages tab says a message in one line: readable words, or a compact view of its JSON in mono. */
export interface MessageLine {
  text: string;
  isCode: boolean;
}

/** A content type without its parameters, in lowercase: what the known types are compared with. */
function essenceOf(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

/** A string field of a JSON payload's start: the preview may be cut, so it is read without parsing the whole. */
function fieldOf(preview: string, field: string): string | undefined {
  return new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(preview)?.[1];
}

/**
 * The squadron check-in convention's messages (docs/squadrons.md, "Check-in";
 * the squadrons README, "Stand down"), by content type: what each says in
 * words. The server knows none of them; the console reads them for display.
 */
const SQUADRON_LINES: Record<string, (preview: string) => string> = {
  'application/vnd.aeolus.squadron.check-in+json': () => 'Checked in at its flagship',
  'application/vnd.aeolus.squadron.role+json': (preview) => {
    const role = fieldOf(preview, 'role');
    return role === undefined ? 'Given its role' : `Given the role: ${role}`;
  },
  'application/vnd.aeolus.squadron.on-station+json': (preview) => {
    const role = fieldOf(preview, 'role');
    return role === undefined ? 'Took up its role' : `Took up the role: ${role}`;
  },
  'application/vnd.aeolus.squadron.stand-down+json': () => 'Asked to stand down',
  'application/vnd.aeolus.squadron.stood-down+json': () => 'Stood down',
};

/** A string at `start` (its opening quote) and where it ends, escapes kept as written. */
function stringAt(text: string, start: number): { value: string; end: number } {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') {
    index += text[index] === '\\' ? 2 : 1;
  }
  return { value: text.slice(start + 1, index), end: index + 1 };
}

/** The top-level fields of a JSON object's start, as `[key, shown value]`: nested values read as …, and a field the preview cut ends the list. */
function topLevelFields(preview: string): [string, string][] {
  const fields: [string, string][] = [];
  let depth = 0;
  let key: string | undefined;
  let index = 0;
  while (index < preview.length) {
    const character = preview[index] ?? '';
    if (character === '"') {
      const { value, end } = stringAt(preview, index);
      if (depth === 1 && key === undefined && preview.slice(end).trimStart().startsWith(':')) {
        key = value;
      } else if (depth === 1 && key !== undefined && end <= preview.length && preview[end - 1] === '"') {
        fields.push([key, value]);
        key = undefined;
      }
      index = end;
      continue;
    }
    if (character === '{' || character === '[') {
      if (depth === 1 && key !== undefined) {
        fields.push([key, '…']);
        key = undefined;
      }
      depth += 1;
    } else if (character === '}' || character === ']') {
      depth -= 1;
    } else if (depth === 1 && key !== undefined && /[-\dtfn]/.test(character)) {
      const primitive = /^(-?\d[\d.eE+-]*|true|false|null)/.exec(preview.slice(index))?.[1];
      if (primitive !== undefined) {
        fields.push([key, primitive]);
        key = undefined;
        index += primitive.length;
        continue;
      }
    }
    index += 1;
  }
  return fields;
}

/** A JSON payload's start as `key value · key value`: top-level fields, strings unquoted and nested values as …; its preview when it holds none. */
function compactJson(preview: string): string {
  const fields = topLevelFields(preview);
  return fields.length === 0 ? preview : fields.map(([key, value]) => `${key} ${value}`).join(' · ');
}

/**
 * A message in one line, for the Messages tab (the message sheet keeps the
 * whole payload, formatted and raw): a squadron convention message in words,
 * other JSON as its fields in a compact mono line, anything else its preview.
 */
export function messageLine(message: { contentType: string; preview: string }): MessageLine {
  const squadronLine = SQUADRON_LINES[essenceOf(message.contentType)];
  if (squadronLine !== undefined) {
    return { text: squadronLine(message.preview), isCode: false };
  }
  return isJson(message.contentType) ? { text: compactJson(message.preview), isCode: true } : { text: message.preview, isCode: false };
}
