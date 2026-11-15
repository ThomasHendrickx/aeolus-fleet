/** A business outcome is a value; a rejected promise reports a system failure. */
export type Result<T, E> = { readonly isOk: true; readonly value: T } | { readonly isOk: false; readonly error: E };
