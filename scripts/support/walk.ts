import { z } from 'zod';

/** The Walk section of a pull request body (the pull-request skill): what the release walker walks. */
export function walkSection(body: string): string | undefined {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^##\s+Walk\s*$/i.test(line));
  if (start === -1) {
    return undefined;
  }
  const length = lines.slice(start + 1).findIndex((line) => /^##\s/.test(line));
  return lines.slice(start + 1, length === -1 ? undefined : start + 1 + length).join('\n').trim();
}

/** A Walk of `None: <reason>` says nobody can see the change. */
export function isNoWalk(section: string): boolean {
  return /^none\b\s*[:.]?\s*\S/i.test(section);
}

export interface ApiStep {
  number: number;
  tool: string;
  /** The arguments as the step writes them, a JSON object in a code span; undefined when it does not parse as one. */
  input: Record<string, unknown> | undefined;
  rawInput: string;
}

/**
 * The steps that call the ship contract: a numbered step with a code span naming a call, then a code span holding its
 * JSON arguments, such as ``call `fleet_ship` with `{"shipId":"<id>"}` ``. A step that says `staging only` needs what CI
 * has not (a real session, the console, a deployment) and is left out; so is everything after `Shows:`.
 */
export function apiSteps(section: string): ApiStep[] {
  const steps = section.split(/^(?=\s*\d+\.\s)/m).filter((step) => /^\s*\d+\.\s/.test(step));
  return steps.flatMap((step) => {
    const text = step.split(/\bShows:/)[0] ?? '';
    const call = /`([A-Za-z_]\w*)`(?:\s+with)?\s+`(\{[^`]*\})`/.exec(text);
    if (call === null || /staging only/i.test(text)) {
      return [];
    }
    const [, tool = '', rawInput = ''] = call;
    return [{ number: Number(/^\s*(\d+)\./.exec(step)?.[1]), tool, input: parseObject(rawInput), rawInput }];
  });
}

function parseObject(json: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(json);
    const object = z.record(z.string(), z.unknown()).safeParse(value);
    return object.success ? object.data : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a string stands for a value the walker fills in at the walk, such as `<target id>`. */
function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && /<[^<>]+>/.test(value);
}

/** The part of a JSON Schema the replay reads. */
interface Schema {
  type?: string | string[] | undefined;
  properties?: Record<string, Schema> | undefined;
  required?: string[] | undefined;
  additionalProperties?: unknown;
  items?: Schema | undefined;
  anyOf?: Schema[] | undefined;
  oneOf?: Schema[] | undefined;
  enum?: unknown[] | undefined;
  const?: unknown;
}

const schemaOf: z.ZodType<Schema> = z.lazy(() =>
  z.looseObject({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    properties: z.record(z.string(), schemaOf).optional(),
    required: z.array(z.string()).optional(),
    items: schemaOf.optional(),
    anyOf: z.array(schemaOf).optional(),
    oneOf: z.array(schemaOf).optional(),
    enum: z.array(z.unknown()).optional(),
  }),
);

interface Checked {
  value: unknown;
  schema: Schema;
  at: string;
}

/** The problems of arguments against a call's JSON Schema: type, required and unknown fields, items. A placeholder fits anywhere. */
export function argumentProblems(arguments_: Record<string, unknown>, jsonSchema: Record<string, unknown>): string[] {
  return problemsOf({ value: arguments_, schema: schemaOf.parse(jsonSchema), at: '' });
}

function problemsOf({ value, schema, at }: Checked): string[] {
  if (isPlaceholder(value)) {
    return [];
  }
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives !== undefined) {
    const attempts = alternatives.map((option) => problemsOf({ value, schema: option, at }));
    return attempts.some((problems) => problems.length === 0) ? [] : (attempts[0] ?? []);
  }
  if ('const' in schema && value !== schema.const) {
    return [`${at} must be ${JSON.stringify(schema.const)}`];
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return [`${at} must be one of ${JSON.stringify(schema.enum)}`];
  }
  const types = [schema.type ?? []].flat();
  if (types.length > 0 && !types.some((type) => hasType(value, type))) {
    return [`${at} must be ${types.join(' or ')}`];
  }
  if (Array.isArray(value)) {
    const { items } = schema;
    return items === undefined ? [] : value.flatMap((item, index) => problemsOf({ value: item, schema: items, at: `${at}[${String(index)}]` }));
  }
  const fields = z.record(z.string(), z.unknown()).safeParse(value);
  return fields.success ? fieldProblems({ value: fields.data, schema, at }) : [];
}

function fieldProblems({ value, schema, at }: { value: Record<string, unknown>; schema: Schema; at: string }): string[] {
  const properties = schema.properties ?? {};
  const name = (field: string) => (at === '' ? field : `${at}.${field}`);
  return [
    ...(schema.required ?? []).filter((field) => !(field in value)).map((field) => `${name(field)} is required`),
    ...Object.entries(value).flatMap(([field, item]) => {
      const property = properties[field];
      if (property !== undefined) {
        return problemsOf({ value: item, schema: property, at: name(field) });
      }
      return (schema.additionalProperties !== undefined && schema.additionalProperties !== false) || Object.keys(properties).length === 0 ? [] : [`${name(field)} is not a field of the call`];
    }),
  ];
}

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case 'integer':
      return Number.isInteger(value);
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return typeof value === type;
  }
}
