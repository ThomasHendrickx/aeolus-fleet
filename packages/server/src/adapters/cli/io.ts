/** Where a server command writes: standard output for results, standard error for problems. */
export interface CommandIo {
  out(text: string): void;
  err(text: string): void;
}

/** Exit codes: 0 done, 1 refused by the domain or the installation, 2 wrong usage. */
export type ExitCode = 0 | 1 | 2;
