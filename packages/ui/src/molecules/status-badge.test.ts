import { Check, Clock } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './status-badge.js';

/** The markup the console's badges drew before tone, icon and label joined (PR 1706): a console screen must not change. */
const BADGE_CLASSES =
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 border font-medium whitespace-nowrap [&amp;&gt;svg]:pointer-events-none [&amp;&gt;svg]:size-(--size-icon-sm) h-5.5 rounded-sm';
const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const CONSOLE_TODAY = {
  crewed: `<span data-slot="status-badge" data-variant="outline" class="${BADGE_CLASSES} text-caption border-transparent bg-transparent px-0.5 text-tone-ok-fg" data-status="crewed">${SVG_OPEN} class="lucide lucide-user-check" aria-hidden="true"><path d="m16 11 2 2 4-4"></path><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>Crewed</span>`,
  undeliverable: `<span data-slot="status-badge" data-variant="outline" class="${BADGE_CLASSES} px-1.5 text-caption border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg" data-status="undeliverable">${SVG_OPEN} class="lucide lucide-circle-x lucide-x-circle" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path></svg>Undeliverable</span>`,
  abandoned: `<span data-slot="status-badge" data-variant="outline" class="${BADGE_CLASSES} text-caption bg-transparent text-tone-ended-fg border-dashed border-tone-ended-border px-1.5" data-status="abandoned">${SVG_OPEN} class="lucide lucide-ban" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M4.929 4.929 19.07 19.071"></path></svg>Abandoned</span>`,
} as const;

function classesOf(html: string): readonly string[] {
  return /class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];
}

describe('a status from the catalogue, as the console shows it', () => {
  it.each(['crewed', 'undeliverable', 'abandoned'] as const)('%s draws exactly as before', (status) => {
    // Given a status the console shows, with no look named
    // When it is drawn
    const html = renderToStaticMarkup(createElement(StatusBadge, { status }));

    // Then it is the same markup as before
    expect(html).toBe(CONSOLE_TODAY[status]);
  });
});

describe('a badge from tone, icon and label, as another app hands them', () => {
  it('shows the label and the icon in the tone, flat', () => {
    // Given an outside party's state the catalogue does not hold
    // When it is drawn from its tone, icon and label
    const html = renderToStaticMarkup(createElement(StatusBadge, { tone: 'ok', icon: Check, label: 'Approved' }));

    // Then its icon and word show in the ok tone, with no fill
    expect(html).toContain('lucide-check');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('>Approved</span>');
    expect(classesOf(html)).toEqual(expect.arrayContaining(['text-tone-ok-fg', 'bg-transparent', 'border-transparent']));
  });

  it('keeps the fill for attention when flat', () => {
    // Given a state that needs acting on
    // When it is drawn flat
    const html = renderToStaticMarkup(createElement(StatusBadge, { tone: 'attention', icon: Clock, label: 'Sign-in failed' }));

    // Then it keeps the attention fill and border
    expect(classesOf(html)).toEqual(expect.arrayContaining(['bg-tone-attention-bg', 'border-tone-attention-border', 'text-tone-attention-fg']));
  });
});

describe('the pill look', () => {
  it('fills a tone-icon-label badge in its tone, round', () => {
    // Given a request state the gateway shows as a pill
    // When it is drawn in the pill look
    const html = renderToStaticMarkup(createElement(StatusBadge, { tone: 'waiting', icon: Clock, label: 'Waiting for approval', look: 'pill' }));

    // Then it is round and filled, with border, in the waiting tone
    expect(html).toContain('>Waiting for approval</span>');
    expect(classesOf(html)).toEqual(
      expect.arrayContaining(['rounded-full', 'bg-tone-waiting-bg', 'border-tone-waiting-border', 'text-tone-waiting-fg']),
    );
    expect(classesOf(html)).not.toContain('bg-transparent');
  });

  it('fills a catalogue status in its tone, round', () => {
    // Given a status from the catalogue
    // When it is drawn in the pill look
    const html = renderToStaticMarkup(createElement(StatusBadge, { status: 'crewed', look: 'pill' }));

    // Then it is round and filled in the ok tone, with its own icon and label
    expect(html).toContain('lucide-user-check');
    expect(html).toContain('>Crewed</span>');
    expect(classesOf(html)).toEqual(expect.arrayContaining(['rounded-full', 'bg-tone-ok-bg', 'border-tone-ok-border', 'text-tone-ok-fg']));
    expect(classesOf(html)).not.toContain('bg-transparent');
  });
});
