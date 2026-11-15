import { z } from 'zod';

import { PALETTE_ICONS } from '../rules/palette-across-apps.js';
import { headerAppSchema } from './apps-list.js';

/*
 * An app's palette list (docs/design/header-across-apps.md, A1; header design
 * H4): every page in its navigation and every action its palette offers, each
 * with the rights it needs, and no data. Each app serves it at
 * PALETTE_LIST_PATH with no sign-in; the open app's server reads the others.
 */

/** Where every Aeolus app serves its palette list. */
export const PALETTE_LIST_PATH = '/.well-known/aeolus-palette.json';

/** The most entries one list holds: an app's navigation and actions, never data. */
const PALETTE_LIST_ENTRIES_MAX = 100;
const LABEL_MAX_LENGTH = 80;

/** A path within the app, never a way off it: one leading slash, not two. */
const appPathSchema = z.string().regex(/^\/(?!\/)/, 'must be a path within the app');

const shownSchema = {
  key: z.string().min(1).max(LABEL_MAX_LENGTH),
  label: z.string().min(1).max(LABEL_MAX_LENGTH),
  keywords: z.array(z.string().max(LABEL_MAX_LENGTH)).max(10),
  rights: z.array(z.string().max(LABEL_MAX_LENGTH)).max(10),
  // A newer app may name an icon this version does not know: it shows the app icon.
  icon: z.enum(PALETTE_ICONS).catch('app'),
};

const paletteListEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), ...shownSchema, path: appPathSchema }),
  z.object({ kind: z.literal('action'), ...shownSchema, path: appPathSchema }),
  z.object({ kind: z.literal('copy'), ...shownSchema, value: z.string().min(1).max(2048) }),
]);

export const paletteListSchema = z.object({ app: headerAppSchema, entries: z.array(paletteListEntrySchema).max(PALETTE_LIST_ENTRIES_MAX) });
export type PaletteList = z.infer<typeof paletteListSchema>;
