/**
 * A message to argo as the web app's server lays it out for reading (#849,
 * decision 0033): its headline (the first line), a summary line, and its body
 * as a small tree the browser renders without HTML. The server parses the
 * payload (lib/message-text.ts); the browser imports only these types.
 */

/** Text inside a block. A link's url is always http, https or mailto. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'emphasis'; children: Inline[] }
  | { kind: 'delete'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; url: string; children: Inline[] }
  | { kind: 'break' };

export type Block =
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'heading'; children: Inline[] }
  | { kind: 'list'; isOrdered: boolean; start: number | null; items: Block[][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; children: Block[] }
  | { kind: 'table'; rows: Inline[][][] }
  | { kind: 'rule' };

/** A GitHub pull request or issue the message links to, shown as a link row. */
export interface KnownLink {
  kind: 'pull' | 'issue';
  url: string;
  /** owner/name */
  repository: string;
  number: number;
}

export interface MessageText {
  /** The first line, without markdown marks; empty for an empty payload. */
  headline: string;
  /** The body's first line as plain text, for a row; empty without a body. */
  summary: string;
  /** Everything after the headline. */
  body: Block[];
  /** How many lines the body has, so a long one folds. */
  lineCount: number;
  links: KnownLink[];
}
