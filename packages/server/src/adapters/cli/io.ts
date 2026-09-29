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

export type NewPassword = { kind: 'given'; password: string } | { kind: 'differ' } | { kind: 'ended' };

/**
 * Asks for a new password twice, without showing it. `differ` when the two
 * answers differ, `ended` when the input ends first.
 */
export async function askNewPassword(io: CommandIo, question: string): Promise<NewPassword> {
  const password = await io.ask(question, { isHidden: true });
  const repeated = await io.ask('Repeat the password: ', { isHidden: true });
  if (password === undefined || repeated === undefined) {
    return { kind: 'ended' };
  }
  return password === repeated ? { kind: 'given', password } : { kind: 'differ' };
}
