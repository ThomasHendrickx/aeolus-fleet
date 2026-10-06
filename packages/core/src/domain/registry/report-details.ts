/**
 * The JSON beneath a report's details (decision 0028): how a merge patch
 * applies to them and when two of them are the same. The server stores the
 * details without meaning; these say only how they change.
 */

/** A JSON value, as the details hold it. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The target with a JSON Merge Patch applied (RFC 7386): an object merges per
 * key, null deletes a key, anything else, arrays included, replaces whole.
 * The target stays as it was.
 */
export function mergePatch(target: JsonValue | undefined, patch: JsonValue): JsonValue {
  if (!isJsonObject(patch)) {
    return patch;
  }
  const base: JsonObject = isJsonObject(target) ? target : {};
  const kept = Object.entries(base).filter(([key]) => !Object.hasOwn(patch, key));
  const patched = Object.entries(patch).flatMap(([key, value]): [string, JsonValue][] =>
    value === null ? [] : [[key, mergePatch(Object.hasOwn(base, key) ? base[key] : undefined, value)]],
  );
  return Object.fromEntries([...kept, ...patched]);
}

/** Whether two JSON values are the same, whatever the order of their keys. */
export function isSameJson(first: JsonValue, second: JsonValue): boolean {
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((item, index) => isSameJson(item, second[index] ?? null))
    );
  }
  if (isJsonObject(first) || isJsonObject(second)) {
    if (!isJsonObject(first) || !isJsonObject(second)) {
      return false;
    }
    const keys = Object.keys(first);
    return (
      keys.length === Object.keys(second).length &&
      keys.every((key) => Object.hasOwn(second, key) && isSameJson(first[key] ?? null, second[key] ?? null))
    );
  }
  return first === second;
}
