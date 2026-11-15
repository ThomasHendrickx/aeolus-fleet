/** A read of the performance design: the tRPC procedure to call, and whose credential it takes. */
export interface Read {
  name: string;
  procedure: string;
  /** JSON in which `<fleet id>`, `<ship id>` and `<message id>` stand for what the run finds on the target. */
  input?: unknown;
  /** `fleet`: the fleet credential of the run; `installation`: the installation token and the fleet it acts in; `session`: a console session cookie. */
  credential: 'fleet' | 'installation' | 'session';
}
