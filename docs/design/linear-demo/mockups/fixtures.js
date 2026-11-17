/**
 * Fabricated data for the three tours. Fictional fleets, people and items: no
 * name or figure refers to a real company. Every screen reads from here, so
 * the same invoice, question and ship stay the same from step to step.
 */
import { idSchema } from '@aeolus-fleet/common';

export const NOW = new Date('2026-11-17T10:04:00Z');
const MINUTE = 60_000;
export const at = (minutesBefore) => new Date(NOW.getTime() - minutesBefore * MINUTE).toISOString();

// Ids keep the product's prefixed, time-ordered shape (common/src/ids).
const tail = (suffix) => `01m7dem0qzr3a9w6m2v5n7${suffix}`;
export const shipId = (suffix) => idSchema('ship').parse(`shp_${tail(suffix)}`);
export const messageId = (suffix) => idSchema('message').parse(`msg_${tail(suffix)}`);
export const deliveryId = (suffix) => idSchema('delivery').parse(`dlv_${tail(suffix)}`);
export const eventId = (suffix) => idSchema('event').parse(`evt_${tail(suffix)}`);
export const fleetId = (suffix) => idSchema('fleet').parse(`flt_${tail(suffix)}`);

export const party = (name, suffix) => ({ id: shipId(suffix), name });

/** Decider: a small app team, Tidewater, whose planner asks a person it was given. */
export const TIDEWATER = {
  fleet: { id: fleetId('d000'), name: 'Tidewater' },
  person: { name: 'Sam Okafor', initials: 'SO', ship: party('sam', 'd001') },
  planner: party('planner', 'd002'),
  builder: party('builder-app', 'd003'),
  reviewer: party('reviewer', 'd004'),
  question: {
    id: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47',
    title: 'Which time zone do tide alerts use for a harbour on a border?',
    context:
      'Saltmarsh and Eastholm sit on one estuary, either side of a time zone line. Each harbour master prints tide tables in their own zone. Slice 4 sends the first alerts, so the choice is needed before it starts.',
    options: [
      { key: 1, label: 'The harbour’s published zone', detail: 'Alerts match the tables the harbour master prints.' },
      { key: 2, label: 'The user’s own zone', detail: 'Alerts match the phone, but differ from the printed tables.' },
    ],
    pick: { option: 1, why: 'harbour masters and skippers check alerts against the printed tables.' },
  },
  continuation: {
    1: 'Alerts for Saltmarsh and Eastholm now use each harbour’s published zone, matching the printed tables. Slice 4 is under way: builder-app has the alert schedule.',
    2: 'Alerts now use each user’s own zone, matching their phone. The alert screen names the harbour’s zone beside the time. Slice 4 is under way: builder-app has the alert schedule.',
  },
};

/** Flow owner: Cedar Workshop, an invoice app, an agent that checks invoices, and Mira, who approves payment. */
export const CEDAR = {
  fleet: { id: fleetId('f000'), name: 'Cedar Workshop' },
  person: { name: 'Mira Lindqvist', initials: 'ML', ship: party('mira', 'f001') },
  app: party('invoice-app', 'f002'),
  agent: party('invoice-check', 'f003'),
  supplier: 'Alder & Pine Timber',
  invoice: { number: '1042', amount: '€ 240,00', order: 'PO-1042', lines: '12 oak battens, 2 m · fixings' },
  question: {
    id: '7a2c4e6f-1b3d-4f5a-8c7e-9d0b2a4c6e81',
    title: 'May we pay invoice 1042?',
    context: 'Alder & Pine Timber sent invoice 1042 for € 240,00. It matches order PO-1042 line for line: 12 oak battens and fixings, delivered on 14 Nov. Payment is due on 1 Dec.',
    options: [
      { key: 1, label: 'Approve payment', detail: 'invoice-app schedules it for the next payment run.' },
      { key: 2, label: 'Hold payment', detail: 'invoice-app asks the supplier to clarify first.' },
    ],
    pick: { option: 1, why: 'the invoice matches the order and the delivery note.' },
  },
  handOn: {
    1: 'Mira approved invoice 1042 (€ 240,00, Alder & Pine Timber). Schedule it for the 1 Dec payment run.',
    2: 'Mira held invoice 1042 (€ 240,00, Alder & Pine Timber). Ask the supplier to clarify before payment.',
  },
};

/** Builder: Kestrel Studio, where Mira's computer runs steering, which builds a reviewer. */
export const KESTREL = {
  fleet: { id: fleetId('b000'), name: 'Kestrel Studio' },
  person: { name: 'Mira Lindqvist', initials: 'ML', ship: party('mira', 'b001') },
  steering: party('steering', 'b002'),
  computer: party('mira-studio-mac', 'b003'),
  reviewer: party('reviewer', 'b004'),
  repository: 'kestrel/booking-site',
  request: 'Build me a reviewer for kestrel/booking-site. Have it review the README first and hand back what it finds.',
  findings: 'Review of README.md: 3 findings. The install steps skip Node 26; the quick start link points at an old page; the env sample names a removed key.',
};
