/** Whether the caller reads the ship whole, rather than its name, type and status only (decision 0034). */
export function isInReadReach<Ship extends object>(ship: Ship): ship is Exclude<Ship, { isInReadReach: false }> {
  return !('isInReadReach' in ship);
}
