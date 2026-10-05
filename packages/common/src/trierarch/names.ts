import { z } from 'zod';

/** The longest name of a repository, a folder, an option or one of its values. */
export const TRIERARCH_NAME_MAX_LENGTH = 100;

/**
 * A name the trierarch's configuration gives a repository, a folder, an
 * option or an option's value. Messages carry names, never paths
 * (decision 0027), so a name holds no slash and starts with no dot.
 */
export const trierarchNameSchema = z
  .string()
  .max(TRIERARCH_NAME_MAX_LENGTH, `A name is at most ${String(TRIERARCH_NAME_MAX_LENGTH)} characters`)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'A name is lowercase letters, digits, dots, hyphens and underscores, and never a path');
