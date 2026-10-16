import type { BlockContent, DefinitionContent, PhrasingContent, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

import type { Block, Inline, KnownLink, MessageText } from './message-document';
import { formattedPayload, isJson } from './payload';

/**
 * A message to argo laid out for reading on the web app's server (#849,
 * decision 0033): the first line is its headline, the rest its body. A
 * text/markdown body is parsed as markdown, raw HTML and images shown as
 * text; any other text keeps its paragraphs and lines, with its URLs made
 * links. JSON shows indented. The payload itself is never changed.
 */

const SAFE_URL = /^(https?:|mailto:)/i;
/** A URL in plain text, up to whitespace; trailing punctuation is left out by trimmedUrl. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const GITHUB_LINK = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)/;
const HEADING_MARKS = /^#{1,6}\s+/;

function essenceOf(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

function trimmedUrl(url: string): string {
  return url.replace(TRAILING_PUNCTUATION, '');
}

/** Plain text with its URLs as links. */
function linkedText(text: string): Inline[] {
  const inlines: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = trimmedUrl(match[0]);
    if (match.index > at) {
      inlines.push({ kind: 'text', text: text.slice(at, match.index) });
    }
    inlines.push({ kind: 'link', url, children: [{ kind: 'text', text: url }] });
    at = match.index + url.length;
  }
  if (at < text.length) {
    inlines.push({ kind: 'text', text: text.slice(at) });
  }
  return inlines;
}

/** Plain text: a paragraph per blank-line-separated part, its lines kept as breaks. */
function plainBlocks(body: string): Block[] {
  return body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => ({
      kind: 'paragraph',
      children: part.split('\n').flatMap((line, index): Inline[] => (index === 0 ? linkedText(line) : [{ kind: 'break' }, ...linkedText(line)])),
    }));
}

function textOf(node: RootContent): string {
  if ('value' in node) {
    return node.value;
  }
  if (node.type === 'image' || node.type === 'imageReference') {
    return node.alt ?? '';
  }
  return 'children' in node ? node.children.map(textOf).join('') : '';
}

/** Adjacent text pieces joined into one, so raw HTML and its text read as one run. */
function joined(inlines: readonly Inline[]): Inline[] {
  return inlines.reduce<Inline[]>((all, inline) => {
    const last = all.at(-1);
    if (inline.kind === 'text' && last?.kind === 'text') {
      return [...all.slice(0, -1), { kind: 'text', text: last.text + inline.text }];
    }
    return [...all, inline];
  }, []);
}

function inlinesOf(nodes: readonly PhrasingContent[]): Inline[] {
  return joined(nodes.flatMap(inlineOf));
}

function inlineOf(node: PhrasingContent): Inline[] {
  switch (node.type) {
    case 'text':
    case 'html':
      return [{ kind: 'text', text: node.value }];
    case 'strong':
      return [{ kind: 'strong', children: inlinesOf(node.children) }];
    case 'emphasis':
      return [{ kind: 'emphasis', children: inlinesOf(node.children) }];
    case 'delete':
      return [{ kind: 'delete', children: inlinesOf(node.children) }];
    case 'inlineCode':
      return [{ kind: 'code', text: node.value }];
    case 'break':
      return [{ kind: 'break' }];
    case 'link':
      return SAFE_URL.test(node.url) ? [{ kind: 'link', url: node.url, children: inlinesOf(node.children) }] : inlinesOf(node.children);
    case 'image':
    case 'imageReference':
      return node.alt ? [{ kind: 'text', text: node.alt }] : [];
    case 'linkReference':
      return inlinesOf(node.children);
    case 'footnoteReference':
      return [];
  }
}

function blocksOf(nodes: readonly (RootContent | BlockContent | DefinitionContent)[]): Block[] {
  return nodes.flatMap(blockOf);
}

function blockOf(node: RootContent | BlockContent | DefinitionContent): Block[] {
  switch (node.type) {
    case 'paragraph':
      return [{ kind: 'paragraph', children: inlinesOf(node.children) }];
    case 'heading':
      return [{ kind: 'heading', children: inlinesOf(node.children) }];
    case 'list':
      return [{ kind: 'list', isOrdered: node.ordered === true, start: node.ordered === true ? (node.start ?? 1) : null, items: node.children.map((item) => blocksOf(item.children)) }];
    case 'code':
      return [{ kind: 'code', text: node.value }];
    case 'blockquote':
      return [{ kind: 'quote', children: blocksOf(node.children) }];
    case 'table':
      return [{ kind: 'table', rows: node.children.map((row) => row.children.map((cell) => inlinesOf(cell.children))) }];
    case 'thematicBreak':
      return [{ kind: 'rule' }];
    case 'html':
      return [{ kind: 'paragraph', children: [{ kind: 'text', text: node.value }] }];
    case 'listItem':
      return blocksOf(node.children);
    case 'break':
    case 'delete':
    case 'emphasis':
    case 'footnoteReference':
    case 'image':
    case 'imageReference':
    case 'inlineCode':
    case 'link':
    case 'linkReference':
    case 'strong':
    case 'text':
      return [{ kind: 'paragraph', children: inlineOf(node) }];
    case 'definition':
    case 'footnoteDefinition':
    case 'tableCell':
    case 'tableRow':
    case 'yaml':
      // Definitions, footnotes and front matter carry nothing to read; table parts only live in a table.
      return [];
  }
}

function markdownBlocks(body: string): Block[] {
  return blocksOf(fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }).children);
}

/** The first line of text a body shows, for a row. */
function summaryOf(body: string, isMarkdown: boolean): string {
  if (!isMarkdown) {
    return body.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
  }
  const first = firstLeafOf(fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }).children[0]);
  const text = first === undefined ? '' : textOf(first);
  return text.split('\n')[0]?.trim() ?? '';
}

/** The first block that holds text itself, inside lists and quotes. */
function firstLeafOf(node: RootContent | undefined): RootContent | undefined {
  if (node === undefined || node.type === 'paragraph' || node.type === 'heading' || !('children' in node)) {
    return node;
  }
  return firstLeafOf(node.children[0]);
}

function knownLinksIn(payload: string): KnownLink[] {
  const links = new Map<string, KnownLink>();
  for (const match of payload.matchAll(URL_IN_TEXT)) {
    const found = GITHUB_LINK.exec(trimmedUrl(match[0]));
    if (found !== null) {
      const [url, repository = '', kind, number = ''] = found;
      links.set(url, { kind: kind === 'pull' ? 'pull' : 'issue', url, repository, number: Number(number) });
    }
  }
  return [...links.values()];
}

function lineCountOf(body: string): number {
  return body === '' ? 0 : body.split('\n').length;
}

export function messageTextOf({ contentType, payload }: { contentType: string; payload: string }): MessageText {
  const [firstLine = '', ...rest] = payload.split('\n');
  if (isJson(contentType)) {
    const formatted = formattedPayload(payload, contentType) ?? payload;
    return { headline: firstLine.trim(), summary: '', body: [{ kind: 'code', text: formatted }], lineCount: lineCountOf(formatted), links: [] };
  }
  const isMarkdown = essenceOf(contentType) === 'text/markdown';
  const headline = (isMarkdown ? firstLine.replace(HEADING_MARKS, '') : firstLine).trim();
  const body = rest.join('\n').replace(/^\s*\n/, '').trimEnd();
  return {
    headline,
    summary: body === '' ? '' : summaryOf(body, isMarkdown),
    body: body === '' ? [] : isMarkdown ? markdownBlocks(body) : plainBlocks(body),
    lineCount: lineCountOf(body),
    links: knownLinksIn(payload),
  };
}
