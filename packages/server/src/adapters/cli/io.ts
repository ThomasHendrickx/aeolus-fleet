/**
 * Where a server command talks to the operator: standard output for results
 * and questions, standard error for problems, standard input for answers.
 */
export interface CommandIo {
  out(text: string): void;
  err(text: string): void;
  /** Asks and waits for one line. Undefined when the input ends first. A hidden answer is not shown as it is typed. */
  ask(question: string, options?: { isHidden?: boolean }): Promise<string | undefined>;
}

/** Exit codes: 0 done, 1 refused by the domain or the installation, 2 wrong usage. */
export type ExitCode = 0 | 1 | 2;
