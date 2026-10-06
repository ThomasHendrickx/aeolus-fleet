import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The text styles from tokens.css. tailwind-merge has to know they are font
 * sizes: otherwise it takes text-body for a colour and drops a text colour
 * written before it.
 */
const TEXT_STYLES = [
  'micro',
  'caption',
  'meta',
  'body',
  'section',
  'body-touch',
  'input-touch',
  'heading',
  'heading-touch',
  'title',
  'title-touch',
  'metric',
  'id',
  'code',
];

const merge = extendTailwindMerge({ extend: { theme: { text: TEXT_STYLES } } });

/** Joins class names, and lets a later Tailwind class win over an earlier one for the same property. */
export function classNames(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
