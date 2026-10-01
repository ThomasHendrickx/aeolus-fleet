import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names, and lets a later Tailwind class win over an earlier one for the same property. */
export function classNames(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
