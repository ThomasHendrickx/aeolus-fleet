/** The ship a refusal refused, for a test whose refusals are all ships': an account or the installation fails it. */
export function refusedShip<T extends { kind: string }>(sender: T): Extract<T, { kind: 'ship' }> {
  if (!isShip(sender)) {
    throw new Error(`the refusal refused ${sender.kind}, not a ship`);
  }
  return sender;
}

function isShip<T extends { kind: string }>(sender: T): sender is Extract<T, { kind: 'ship' }> {
  return sender.kind === 'ship';
}
