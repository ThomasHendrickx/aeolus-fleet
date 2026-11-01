'use client';

import { useState } from 'react';

import { Button, classNames } from '@aeolus-fleet/ui';
import type { Block, Inline } from '../../../../lib/message-document';

/*
 * The parsed body has no ids: its parts are keyed by their place in it, which
 * never changes while it is shown, since a message's payload never changes.
 */

/** A body longer than this folds behind Show all (#849). */
const FOLD_AFTER_LINES = 12;

const LINK = 'font-medium text-foreground underline underline-offset-2 [overflow-wrap:anywhere] hover:text-primary focus-visible:outline-2 focus-visible:outline-ring';

function InlineText({ inline }: { inline: Inline }) {
  switch (inline.kind) {
    case 'text':
      return inline.text;
    case 'strong':
      return <strong className="font-semibold">{inline.children.map((child, at) => <InlineText key={`${String(at)}-${child.kind}`} inline={child} />)}</strong>;
    case 'emphasis':
      return <em>{inline.children.map((child, at) => <InlineText key={`${String(at)}-${child.kind}`} inline={child} />)}</em>;
    case 'delete':
      return <del>{inline.children.map((child, at) => <InlineText key={`${String(at)}-${child.kind}`} inline={child} />)}</del>;
    case 'code':
      return <code className="rounded-sm bg-muted px-1 font-mono text-code">{inline.text}</code>;
    case 'link':
      return (
        <a href={inline.url} target="_blank" rel="noreferrer noopener" className={LINK}>
          {inline.children.map((child, at) => <InlineText key={`${String(at)}-${child.kind}`} inline={child} />)}
        </a>
      );
    case 'break':
      return <br />;
  }
}

function Inlines({ inlines }: { inlines: readonly Inline[] }) {
  return inlines.map((inline, at) => <InlineText key={`${String(at)}-${inline.kind}`} inline={inline} />);
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p>
          <Inlines inlines={block.children} />
        </p>
      );
    case 'heading':
      return (
        <p className="font-semibold">
          <Inlines inlines={block.children} />
        </p>
      );
    case 'list': {
      const ListTag = block.isOrdered ? 'ol' : 'ul';
      return (
        <ListTag start={block.start ?? undefined} className={classNames('flex flex-col gap-1 pl-5', block.isOrdered ? 'list-decimal' : 'list-disc')}>
          {block.items.map((item, at) => (
            <li key={`${String(at)}-${String(item.length)}`} className="[&>p]:inline">
              <Blocks blocks={item} />
            </li>
          ))}
        </ListTag>
      );
    }
    case 'code':
      return <pre className="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-code whitespace-pre">{block.text}</pre>;
    case 'quote':
      return (
        <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
          <Blocks blocks={block.children} />
        </blockquote>
      );
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="text-meta">
            <tbody>
              {block.rows.map((row, at) => (
                <tr key={`${String(at)}-${String(row.length)}`} className="border-b border-border">
                  {row.map((cell, column) => (
                    <td key={`${String(column)}-${String(cell.length)}`} className="px-2 py-1 align-top">
                      <Inlines inlines={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="border-border" />;
  }
}

function Blocks({ blocks }: { blocks: readonly Block[] }) {
  return blocks.map((block, at) => <BlockView key={`${String(at)}-${block.kind}`} block={block} />);
}

/**
 * A message's body as the web app's server laid it out (lib/message-text.ts):
 * paragraphs, lists, code and links, never HTML. A body over 12 lines folds
 * behind Show all.
 */
export function MessageBody({ blocks, lineCount, className }: { blocks: readonly Block[]; lineCount: number; className?: string }) {
  const isLong = lineCount > FOLD_AFTER_LINES;
  const [isShown, setIsShown] = useState(false);
  if (blocks.length === 0) {
    return null;
  }
  const isFolded = isLong && !isShown;
  return (
    <div className={classNames('flex flex-col gap-2', className)}>
      <div
        data-testid="inbox-message-body"
        data-folded={isFolded ? 'true' : undefined}
        className={classNames(
          'flex flex-col gap-3 text-prose text-foreground [overflow-wrap:anywhere] max-sm:text-body-touch',
          isFolded ? 'max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]' : undefined,
        )}
      >
        <Blocks blocks={blocks} />
      </div>
      {isFolded ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          data-testid="inbox-show-all"
          onClick={() => {
            setIsShown(true);
          }}
        >
          Show all {lineCount} lines
        </Button>
      ) : null}
    </div>
  );
}
