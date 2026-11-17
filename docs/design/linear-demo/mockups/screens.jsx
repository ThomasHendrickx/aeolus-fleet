/** Documentation fixtures: the numbered tour steps and site entries, rendered to static frames. No requests, no product code. */
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Button, HarbourTile, ShipState, ToastCard } from '@aeolus-fleet/ui';
import { Copy } from 'lucide-react';
import { CEDAR, KESTREL, NOW, TIDEWATER, at } from './fixtures';
import { Bridge, BridgeMessage, BridgeQuestion, BridgeRow, ConsoleOverview, ConsoleShipPage, NoticeBanner, event, listed, shipDetail, tile } from './product';
import { SitePage, TourCard, TourStep } from './site';

const out = process.argv[2];
mkdirSync(out, { recursive: true });

// ---------- Parts shared by steps ----------

const both = (desktop, phone) => (
  <>
    <div className="desktop-only">{desktop}</div>
    <div className="phone-only">{phone}</div>
  </>
);

const miniTile = (ship, state, note, kind = 'agents') => <HarbourTile ship={tile(ship, state, note, 0)} kind={kind} now={NOW} />;
const miniLine = (from, to, text) => (
  <span className="mini-line">
    <span className="font-mono">{from}</span> → <span className="font-mono">{to}</span>
    <span className="mini-text">{text}</span>
  </span>
);
const miniCount = (label, before, after) => (
  <span className="mini-count">
    {label} <span className="mini-was">{before} →</span> <b>{after}</b>
  </span>
);

function Closing({ title, text, quote, primary, secondary, beneath }) {
  return (
    <div className="closing-wrap">
      <div className="closing-under" aria-hidden>
        {beneath}
      </div>
      <div className="closing-card" role="dialog" aria-label={title}>
        <p className="eyebrow">Tour complete</p>
        <h2>{title}</h2>
        <p>{text}</p>
        {quote ? (
          <figure className="closing-quote">
            <figcaption>{quote.label}</figcaption>
            <blockquote>{quote.text}</blockquote>
            <Button size="sm" icon={<Copy aria-hidden />}>
              Copy
            </Button>
          </figure>
        ) : null}
        <a href={primary[1]} className="btn primary">
          {primary[0]} →
        </a>
        <a href={secondary[1]} className="btn line">
          {secondary[0]}
        </a>
        <a href="site-01-after.html" className="tlink">
          Back to aeolus-fleet.dev
        </a>
      </div>
    </div>
  );
}

// ---------- Decider: Tidewater ----------

const T = TIDEWATER;
const tideRows = {
  question: { id: 'question', kind: 'decide', title: T.question.title, verb: 'question from', from: 'planner', time: '10:02', isUnread: true },
  shipped: { id: 'shipped', kind: 'aware', title: 'Slice 3 shipped: the harbour list', verb: 'from', from: 'builder-app', time: '09:41' },
  goingOn: (option) => ({ id: 'going-on', kind: 'aware', title: option === 1 ? 'Going ahead with the harbour’s published zone' : 'Going ahead with the user’s own zone', verb: 'from', from: 'planner', time: '10:04', isUnread: true }),
};
const zoneWord = { 1: 'The harbour’s published zone', 2: 'The user’s own zone' };

const tideBridge = (props) => <Bridge fleet={T.fleet} person={T.person} {...props} />;
const tideQuestion = (answer) => both(<BridgeQuestion asker={T.planner} question={T.question} answer={answer} />, <BridgeQuestion asker={T.planner} question={T.question} answer={answer} isPhone />);
const tideFleet = (plannerState) => [
  {
    kind: 'agents',
    tiles: [
      tile(T.planner, plannerState, plannerState === 'working' ? 'Slice 4: the alert schedule' : 'Waiting on sam'),
      tile(T.builder, 'working', 'Building the alert schedule'),
      tile(T.reviewer, 'idle', 'Reviewed slice 3', 22),
    ],
  },
];
const tideContinues = (option) =>
  tideBridge({
    active: 'aware',
    counts: { aware: 2 },
    listTitle: 'Stay aware',
    phoneTitle: 'Stay aware',
    rows: [{ ...tideRows.goingOn(option), isOpen: true, isNew: true }, tideRows.shipped],
    reader: (
      <BridgeMessage
        from={T.planner}
        kind="aware"
        title={tideRows.goingOn(option).title}
        body={T.continuation[option]}
        footer={
          <div className="bridge-fleet">
            <p className="text-meta font-medium text-muted-foreground">Your fleet</p>
            <div className="bridge-fleet-tiles">
              {tideFleet('working')[0].tiles.map((one) => (
                <HarbourTile key={one.id} ship={one} kind="agents" now={NOW} />
              ))}
            </div>
          </div>
        }
      />
    ),
  });

const decider = {
  slug: 'decider',
  persona: 'Decider',
  minutes: '3 min',
  title: 'Answer an agent’s question',
  lede: 'An agent hits a choice it should not make alone. It asks you, you answer, and the work goes on.',
  cardTitle: 'They ask. You decide.',
  cardText: 'An agent’s question reaches you in Bridge. Answer it and watch the work go on.',
  ships: [
    { name: 'planner', kind: 'agent' },
    { name: 'sam', kind: 'person' },
    { name: 'builder-app', kind: 'agent' },
  ],
  steps: [
    {
      id: 'decider-01',
      title: 'A question reaches you',
      surface: 'Bridge',
      url: 'Bridge · Waiting on you',
      narrative: 'You are Sam. Tidewater’s planner has a choice it should not make alone, so it asks you. The question lands in Bridge, the one place for everything that waits on you.',
      spotNote: 'The new question, at the top of Waiting on you.',
      spot: '[data-row=question]',
      scene: { hop: [0, 1], ring: 1, log: 'planner → sam   Which time zone do tide alerts use…' },
      frames: [
        { t: '0.0 s', part: miniLine('planner', 'sam', 'Which time zone do tide alerts use?'), caption: 'planner sends its question. Aeolus stores it before the send returns.' },
        { t: '0.4 s', part: <BridgeRow row={tideRows.question} />, caption: 'The row slides into Waiting on you and settles.' },
        { t: '1.0 s', part: miniCount('Waiting on you', 0, 1), caption: 'The count goes to 1, here and on the phone’s tab bar.' },
      ],
      screen: tideBridge({ active: 'waiting', counts: { waiting: 1, aware: 1 }, listTitle: 'Waiting on you', phoneTitle: 'Waiting on you', phoneView: 'list', rows: [{ ...tideRows.question, isNew: true }], reader: <p className="bridge-pick">Open the question to read it and answer.</p> }),
    },
    {
      id: 'decider-02',
      title: 'Read it, then choose',
      surface: 'Bridge',
      url: 'Bridge · Question from planner',
      narrative: 'The question carries what you need: the context, both options, and the option planner would pick, with its reason. Nothing is sent until you answer.',
      spotNote: 'planner’s pick, marked but not sent.',
      spot: '[data-testid=inbox-option-1]',
      scene: { ring: 1, log: 'sam opened the question' },
      choices: [
        ['Answer: the harbour’s published zone', 'decider-03-after.html'],
        ['Answer: the user’s own zone', 'decider-03b-after.html'],
      ],
      screen: tideBridge({ active: 'waiting', counts: { waiting: 1, aware: 1 }, listTitle: 'Waiting on you', phoneTitle: 'Question', phoneView: 'reader', rows: [{ ...tideRows.question, isOpen: true, isUnread: false }], reader: tideQuestion(null) }),
    },
    ...[1, 2].map((option) => ({
      id: option === 1 ? 'decider-03' : 'decider-03b',
      alternate: option === 2,
      next: option === 2 ? 'decider-04b' : undefined,
      back: option === 2 ? 'decider-02' : undefined,
      title: option === 1 ? 'Your answer is on its way' : 'Your answer is on its way: own zone',
      surface: 'Bridge',
      url: 'Bridge · Answered',
      narrative: option === 1 ? 'You picked the harbour’s published zone. Your answer goes back to planner as a reply to its question, and the question leaves what waits on you.' : 'You picked the user’s own zone instead. The answer goes back the same way; only what planner does next changes.',
      spotNote: 'The answer, recorded on the question.',
      spot: '[data-testid=inbox-answered]',
      scene: { hop: [1, 0], log: `sam → planner   ${zoneWord[option]}` },
      frames: [
        { t: '0.0 s', part: miniCount('Waiting on you', 1, 0), caption: 'You answer. The count drops to 0 at once.' },
        { t: '0.3 s', part: <ToastCard title="Answer sent to planner" description={zoneWord[option]} />, caption: 'A toast confirms it and settles.' },
        { t: '0.8 s', part: miniLine('sam', 'planner', zoneWord[option]), caption: 'planner receives the reply to its own question.' },
      ],
      screen: tideBridge({
        active: 'waiting',
        counts: { aware: 1, done: 1 },
        listTitle: 'Waiting on you',
        phoneTitle: 'Answered',
        phoneView: 'reader',
        rows: [],
        empty: 'Nothing waits on you. Your answer is in Done.',
        reader: tideQuestion(option),
        toast: <ToastCard title="Answer sent to planner" description={zoneWord[option]} />,
      }),
    })),
    ...[1, 2].map((option) => ({
      id: option === 1 ? 'decider-04' : 'decider-04b',
      alternate: option === 2,
      next: option === 2 ? 'decider-05' : undefined,
      back: option === 2 ? 'decider-03b' : undefined,
      title: option === 1 ? 'The work goes on' : 'The work goes on: own zone',
      surface: 'Bridge',
      url: 'Bridge · Stay aware',
      narrative: option === 1 ? 'planner carries on with your answer and tells you so. Its tile turns sea blue: it is working again, and builder-app has the next piece.' : 'planner carries on with the user’s own zone. Your other answer led to other work, and you see it the same way.',
      spotNote: 'planner, working again on your answer.',
      spot: 'a[href="#ship-planner"]',
      scene: { hop: [0, 2], log: 'planner → builder-app   Slice 4: the alert schedule' },
      frames: [
        { t: '0.0 s', part: miniTile(T.planner, 'blocked', 'Waiting on sam'), caption: 'Before your answer: planner waits on you.' },
        { t: '0.6 s', part: miniTile(T.planner, 'working', 'Slice 4: the alert schedule'), caption: 'It takes your answer and turns to working, sea blue.' },
        { t: '1.2 s', part: <BridgeRow row={tideRows.goingOn(option)} />, caption: 'Its update arrives in Stay aware.' },
      ],
      screen: tideContinues(option),
    })),
    {
      id: 'decider-05',
      title: 'Bring your builder',
      surface: 'Site',
      url: 'aeolus-fleet.dev/demo/decider',
      narrative: 'That is the Decider’s part: the agent asks, you decide, the work goes on. Your own first question comes once a builder adds you to their fleet.',
      scene: { log: 'Tour complete' },
      screen: (
        <Closing
          title="You answered an agent’s question."
          text="You saw it with made-up data. To answer your own team’s agents, a builder adds you to their fleet. Send them this:"
          quote={{ label: 'To your builder', text: 'Please add my email to our fleet, give me Talk with the fleet rights, and send me a question in Bridge.' }}
          primary={['Read D1: get added by a builder', 'guide-decider-after.html']}
          secondary={['Take another tour', 'site-04-after.html']}
          beneath={tideContinues(1)}
        />
      ),
    },
  ],
};

// ---------- Flow owner: Cedar Workshop ----------

const C = CEDAR;
const cedarGroups = (checkState = 'idle', checkNote = 'Checks invoices against orders', appState = 'idle', appNote = 'Receives supplier invoices', miraState = 'idle', miraNote = 'Approves supplier payments') => [
  { kind: 'people', tiles: [tile(C.person.ship, miraState, miraNote, 6)] },
  { kind: 'agents', tiles: [tile(C.app, appState, appNote, 2), tile(C.agent, checkState, checkNote, 1)] },
];
const cedarMessages = {
  item: (state = 'acknowledged') => listed('f101', { sender: C.app, recipient: C.agent, sentAt: at(4), preview: `Invoice ${C.invoice.number} from ${C.supplier}, ${C.invoice.amount}. Check it against ${C.invoice.order}.`, state }),
  question: listed('f102', { sender: C.agent, recipient: C.person.ship, sentAt: at(3), preview: `Question: ${C.question.title} Approve payment, or Hold payment.`, inReplyTo: 'f101' }),
  answer: (option) => listed('f103', { sender: C.person.ship, recipient: C.agent, sentAt: at(2), preview: `Answer: ${option === 1 ? 'Approve payment' : 'Hold payment'}`, inReplyTo: 'f102' }),
  handOn: (option, state = 'acknowledged') => listed('f104', { sender: C.agent, recipient: C.app, sentAt: at(1), preview: C.handOn[option], inReplyTo: 'f101', state }),
};
const cedarAgent = (status = 'crewed') => shipDetail({ ship: C.agent, type: 'invoice-check', owner: C.person.ship, commissioner: C.person.ship, location: 'cedar-office-server', crewedMinutes: 240, status, statement: null });
const cedarApp = shipDetail({ ship: C.app, type: 'invoice-app', kind: 'app', owner: C.person.ship, commissioner: C.person.ship, location: 'invoices.cedar.example', crewedMinutes: 2000 });
const cedarShip = (detail, messages) => <ConsoleShipPage fleet={C.fleet} person={C.person} detail={detail} tab="messages" messages={messages} />;
const cedarBridge = (props) => <Bridge fleet={C.fleet} person={C.person} {...props} />;
const invoiceRow = { id: 'question', kind: 'decide', title: C.question.title, verb: 'question from', from: 'invoice-check', time: '10:01', isUnread: true };
const cedarQuestion = (answer) => both(<BridgeQuestion asker={C.agent} question={C.question} answer={answer} />, <BridgeQuestion asker={C.agent} question={C.question} answer={answer} isPhone />);
const decision = { 1: 'Approve payment', 2: 'Hold payment' };

const flowOwner = {
  slug: 'flow-owner',
  persona: 'Flow owner',
  minutes: '4 min',
  title: 'Follow one invoice through the flow',
  lede: 'An app, an agent and a person hand one invoice along. Nobody copies it, forwards it or chases it.',
  cardTitle: 'They hand each other work.',
  cardText: 'Follow invoice 1042 from the app to an agent, to Mira, and back. See every hand-off.',
  ships: [
    { name: 'invoice-app', kind: 'app' },
    { name: 'invoice-check', kind: 'agent' },
    { name: 'mira', kind: 'person' },
  ],
  steps: [
    {
      id: 'flow-owner-01',
      title: 'One ordinary flow',
      surface: 'Console',
      url: 'Console · Fleet overview',
      narrative: 'Cedar Workshop pays its suppliers through three ships: invoice-app takes in invoices, invoice-check checks each against its order, and Mira approves the payment. One invoice is about to arrive.',
      spotNote: 'The flow’s app and agent, side by side in the fleet.',
      spot: 'a[href="#ship-invoice-app"]',
      scene: { log: 'Cedar Workshop · 3 ships, all idle' },
      screen: <ConsoleOverview fleet={C.fleet} person={C.person} groups={cedarGroups()} />,
    },
    {
      id: 'flow-owner-02',
      title: 'The app hands over the invoice',
      surface: 'Console',
      url: 'Console · invoice-check · Messages',
      narrative: 'Invoice 1042 arrives at invoice-app, which hands it to invoice-check as a message. Aeolus keeps it until invoice-check takes it; nobody forwards an email.',
      spotNote: 'The invoice, arrived on invoice-check’s messages.',
      spot: '[data-testid=message-thread]:first-child',
      scene: { hop: [0, 1], log: `invoice-app → invoice-check   Invoice ${C.invoice.number}, ${C.invoice.amount}` },
      frames: [
        { t: '0.0 s', part: miniLine('invoice-app', 'invoice-check', `Invoice ${C.invoice.number}, ${C.invoice.amount}`), caption: 'invoice-app sends the item.' },
        { t: '0.5 s', part: miniTile(C.agent, 'working', `Checking invoice ${C.invoice.number}`), caption: 'invoice-check takes it and turns to working.' },
        { t: '1.0 s', part: <ShipState state="working" />, caption: 'Its ship page reads Working while it checks the invoice.' },
      ],
      screen: cedarShip(cedarAgent(), [cedarMessages.item()]),
    },
    {
      id: 'flow-owner-03',
      title: 'The agent asks you',
      surface: 'Bridge',
      url: 'Bridge · Question from invoice-check',
      narrative: 'The invoice matches its order, but paying is Mira’s call. You are Mira now: invoice-check asks in Bridge, with the facts and its own pick.',
      spotNote: 'invoice-check’s pick and its reason.',
      spot: '[data-testid=inbox-option-1]',
      scene: { hop: [1, 2], ring: 2, log: `invoice-check → mira   ${C.question.title}` },
      choices: [
        ['Approve payment', 'flow-owner-04-after.html'],
        ['Hold payment', 'flow-owner-04b-after.html'],
      ],
      frames: [
        { t: '0.0 s', part: <BridgeRow row={invoiceRow} />, caption: 'The question arrives in Waiting on you.' },
        { t: '0.6 s', part: miniCount('Waiting on you', 0, 1), caption: 'Mira’s count goes to 1, on every device she uses.' },
      ],
      screen: cedarBridge({ active: 'waiting', counts: { waiting: 1 }, listTitle: 'Waiting on you', phoneTitle: 'Question', phoneView: 'reader', rows: [{ ...invoiceRow, isOpen: true, isUnread: false, isNew: true }], reader: cedarQuestion(null) }),
    },
    ...[1, 2].map((option) => ({
      id: option === 1 ? 'flow-owner-04' : 'flow-owner-04b',
      alternate: option === 2,
      next: option === 2 ? 'flow-owner-05b' : undefined,
      back: option === 2 ? 'flow-owner-03' : undefined,
      title: option === 1 ? 'Your approval goes back' : 'Your hold goes back',
      surface: 'Bridge',
      url: 'Bridge · Answered',
      narrative: option === 1 ? 'You approve. The answer goes back to invoice-check as a reply, tied to the same invoice.' : 'You hold it instead. The hold goes back the same way, tied to the same invoice.',
      spotNote: 'Your decision, recorded on the question.',
      spot: '[data-testid=inbox-answered]',
      scene: { hop: [2, 1], log: `mira → invoice-check   ${decision[option]}` },
      frames: [
        { t: '0.0 s', part: miniCount('Waiting on you', 1, 0), caption: 'You answer; nothing waits on you now.' },
        { t: '0.3 s', part: <ToastCard title="Answer sent to invoice-check" description={decision[option]} />, caption: 'The toast confirms it.' },
      ],
      screen: cedarBridge({ active: 'waiting', counts: { done: 1 }, listTitle: 'Waiting on you', phoneTitle: 'Answered', phoneView: 'reader', rows: [], empty: 'Nothing waits on you. Your answer is in Done.', reader: cedarQuestion(option), toast: <ToastCard title="Answer sent to invoice-check" description={decision[option]} /> }),
    })),
    ...[1, 2].map((option) => ({
      id: option === 1 ? 'flow-owner-05' : 'flow-owner-05b',
      alternate: option === 2,
      next: option === 2 ? 'flow-owner-06' : undefined,
      back: option === 2 ? 'flow-owner-04b' : undefined,
      title: option === 1 ? 'The agent hands it on' : 'The agent hands on the hold',
      surface: 'Console',
      url: 'Console · invoice-check · Messages',
      narrative: option === 1 ? 'invoice-check hands your approval to invoice-app, which schedules the payment. The invoice has gone app, agent, person, agent, app.' : 'invoice-check hands the hold to invoice-app, which asks the supplier to clarify. The invoice stops before payment.',
      spotNote: 'The final hand-off, back to invoice-app.',
      spot: '[data-testid=message-thread]:first-child',
      scene: { hop: [1, 0], log: `invoice-check → invoice-app   ${decision[option]}` },
      frames: [
        { t: '0.0 s', part: miniLine('invoice-check', 'invoice-app', C.handOn[option].split('.')[0]), caption: 'invoice-check sends the decision on.' },
        { t: '0.6 s', part: miniTile(C.agent, 'idle', `Invoice ${C.invoice.number} handed on`), caption: 'Its work done, invoice-check goes back to idle.' },
      ],
      screen: cedarShip(cedarAgent(), [cedarMessages.item(), cedarMessages.question, cedarMessages.answer(option), cedarMessages.handOn(option)]),
    })),
    {
      id: 'flow-owner-06',
      title: 'Read the first hand-off',
      surface: 'Console',
      url: 'Console · invoice-app · Messages',
      narrative: 'Every hand-off stays on record. On invoice-app’s page you see what it sent, to whom, when, and that invoice-check took it.',
      spotNote: 'The item and the decision that came back for it.',
      spot: '[data-testid=message-thread]:first-child',
      scene: { log: 'Reading invoice-app’s messages' },
      screen: cedarShip(cedarApp, [cedarMessages.item(), cedarMessages.handOn(1)]),
    },
    {
      id: 'flow-owner-07',
      title: 'Read the question and its answer',
      surface: 'Console',
      url: 'Console · invoice-check · Messages',
      narrative: 'The question and Mira’s answer sit in one thread on invoice-check’s page, under the invoice that started it. Had you held it, the answer would read Hold payment.',
      spotNote: 'Question and answer, threaded under the invoice.',
      spot: '[data-testid=message-thread]:first-child',
      scene: { log: 'Reading invoice-check’s messages' },
      frames: [
        { t: 'Approve', part: miniLine('mira', 'invoice-check', 'Answer: Approve payment'), caption: 'The answer you gave in this walk.' },
        { t: 'Hold', part: miniLine('mira', 'invoice-check', 'Answer: Hold payment'), caption: 'The same row, had you held it.' },
      ],
      screen: cedarShip(cedarAgent(), [cedarMessages.item(), cedarMessages.question, cedarMessages.answer(1), cedarMessages.handOn(1)]),
    },
    {
      id: 'flow-owner-08',
      title: 'Read the final hand-off',
      surface: 'Console',
      url: 'Console · invoice-check · Messages',
      narrative: 'The last hand-off closes the loop on the same invoice. You followed one item from start to finish without copying, forwarding or chasing it.',
      spotNote: 'The decision handed back to invoice-app.',
      spot: '[data-testid=message-row]:last-child',
      scene: { log: 'Invoice 1042: app → agent → mira → agent → app' },
      frames: [
        { t: 'Approve', part: miniLine('invoice-check', 'invoice-app', 'Schedule it for the 1 Dec payment run.'), caption: 'After Approve payment.' },
        { t: 'Hold', part: miniLine('invoice-check', 'invoice-app', 'Ask the supplier to clarify before payment.'), caption: 'After Hold payment.' },
      ],
      screen: cedarShip(cedarAgent(), [cedarMessages.item(), cedarMessages.question, cedarMessages.answer(1), cedarMessages.handOn(1)]),
    },
    {
      id: 'flow-owner-09',
      title: 'Connect your own flow',
      surface: 'Site',
      url: 'aeolus-fleet.dev/demo/flow-owner',
      narrative: 'Your flow has steps like these. Start F1 by naming them: which is an app, which an agent, which a person.',
      scene: { log: 'Tour complete' },
      screen: (
        <Closing
          title="You followed one invoice through the flow."
          text="An app, an agent and a person handed it along, and every hand-off stayed on record. Start with your own flow’s steps; get a fleet first if you need one. After F1: D1, then B4."
          primary={['Start F1: name your steps', 'guide-flow-owner-after.html']}
          secondary={['Take another tour', 'site-04-after.html']}
          beneath={cedarShip(cedarAgent(), [cedarMessages.item(), cedarMessages.question, cedarMessages.answer(1), cedarMessages.handOn(1)])}
        />
      ),
    },
  ],
};

// ---------- Builder: Kestrel Studio ----------

const K = KESTREL;
const kestrelGroups = (reviewer) => [
  { kind: 'people', tiles: [tile(K.person.ship, 'idle', 'Owns this fleet', 3)] },
  { kind: 'agents', tiles: [tile(K.steering, reviewer ? 'working' : 'idle', reviewer ? 'Building reviewer' : 'Builds and grows this fleet'), ...(reviewer ? [tile(K.reviewer, reviewer.state, reviewer.note, 0)] : [])] },
  { kind: 'trierarchs', tiles: [tile(K.computer, 'idle', 'Joined · Claude Code ready', 1)] },
];
const reviewerDetail = (status = 'crewed') => shipDetail({ ship: K.reviewer, type: 'reviewer', owner: K.person.ship, commissioner: K.steering, location: K.computer.name, crewedMinutes: 1, status });
const reviewerTimeline = [
  event(6, { type: 'ShipClaimed', occurredAt: at(1), actor: K.reviewer, ship: K.reviewer, details: { location: 'DEVICE', locationDescription: K.computer.name } }),
  event(5, { type: 'CrewStatusChanged', occurredAt: at(1), actor: K.computer, ship: K.reviewer, details: { status: 'starting' } }),
  event(4, { type: 'CrewAssigned', occurredAt: at(2), actor: K.computer, ship: K.reviewer }),
  event(3, { type: 'CrewRequested', occurredAt: at(2), actor: K.steering, ship: K.reviewer }),
  event(2, { type: 'OwnerSet', occurredAt: at(3), actor: K.steering, ship: K.reviewer, details: { how: 'inherited' } }),
  event(1, { type: 'ShipCommissioned', occurredAt: at(3), actor: K.steering, ship: K.reviewer, details: { name: 'reviewer', type: 'reviewer', kind: 'agent' } }),
];
const reviewerMessages = (isBack) => [
  listed('b101', { sender: K.steering, recipient: K.reviewer, sentAt: at(1), preview: `Review README.md in ${K.repository} and hand back your findings.` }),
  ...(isBack ? [listed('b102', { sender: K.reviewer, recipient: K.steering, sentAt: at(0), preview: K.findings, inReplyTo: 'b101' })] : []),
];
const kestrelOverview = (reviewer, needsCrewCount = 0) => <ConsoleOverview fleet={K.fleet} person={K.person} groups={kestrelGroups(reviewer)} needsCrewCount={needsCrewCount} />;
const noticeRow = { id: 'notice', kind: 'aware', title: 'reviewer is built and crewed', verb: 'notice from', from: 'steering', time: '10:04', isUnread: true };
const kestrelNotice = (
  <Bridge
    fleet={K.fleet}
    person={K.person}
    active="aware"
    counts={{ aware: 1 }}
    listTitle="Stay aware"
    phoneTitle="Notice"
    phoneView="reader"
    rows={[{ ...noticeRow, isOpen: true, isNew: true }]}
    reader={
      <BridgeMessage
        from={K.steering}
        kind="aware"
        title="reviewer is built and crewed"
        body={`It runs on ${K.computer.name} in ${K.repository}. You own it; steering commissioned it. Its first review came back: 3 findings in README.md.`}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary">
              Open reviewer in the console
            </Button>
            <Button size="sm">Read the findings</Button>
          </div>
        }
      />
    }
  />
);

function Terminal({ isDone }) {
  return (
    <div className="terminal" data-terminal={isDone ? 'done' : 'typing'}>
      <p className="terminal-title">
        <span>claude · {K.computer.name}</span>
        <span>~/{K.repository}</span>
      </p>
      <p className="terminal-prompt">
        <span className="terminal-caret">›</span> <span className="terminal-typed">{K.request}</span>
      </p>
      <p className="terminal-line l1">
        <b>● steering</b> I will commission a reviewer on your computer and send it its first work.
      </p>
      <p className="terminal-tool l2">⎿ aeolus · commission  reviewer · type reviewer · send and receive · owner mira</p>
      <p className="terminal-tool l3">
        ⎿ aeolus · request crew  {K.computer.name} · {K.repository}
      </p>
      <p className="terminal-line l4">
        <b>● steering</b> reviewer is commissioned and waits for its crew. Its first work goes out once it is crewed.
      </p>
    </div>
  );
}

const builder = {
  slug: 'builder',
  persona: 'Builder',
  minutes: '4 min',
  title: 'Watch a ship build a ship',
  lede: 'Tell steering what you need. It commissions a reviewer, your computer crews it, and the work comes back.',
  cardTitle: 'Ships that build ships.',
  cardText: 'steering commissions a reviewer, your computer crews it, and its first review comes back.',
  ships: [
    { name: 'mira', kind: 'person' },
    { name: 'steering', kind: 'agent' },
    { name: 'mira-studio-mac', kind: 'trierarch' },
    { name: 'reviewer', kind: 'agent' },
  ],
  steps: [
    {
      id: 'builder-01',
      title: 'Ready to build',
      surface: 'Console',
      url: 'Console · Fleet overview',
      narrative: 'Setup is done for this tour: Mira’s computer joined Kestrel Studio’s fleet and steering is crewed on it. In the real B4 path, you do this part yourself.',
      spotNote: 'steering, the ship that builds ships.',
      spot: 'a[href="#ship-steering"]',
      scene: { log: 'Kestrel Studio · steering crewed on mira-studio-mac' },
      screen: kestrelOverview(null),
    },
    {
      id: 'builder-02',
      title: 'Tell steering what to build',
      surface: 'Terminal',
      url: 'Claude Code · mira-studio-mac',
      narrative: 'Mira asks steering for a reviewer in plain words. steering commissions it within its own rights and asks her computer to crew it. No crew line, no secret on screen.',
      spotNote: 'What Mira asks for, in her own words.',
      spot: '.terminal-prompt',
      scene: { hop: [0, 1], log: 'mira → steering   Build me a reviewer for kestrel/booking-site' },
      frames: [
        { t: '0.0 s', part: <span className="mini-term">› Build me a reviewer…</span>, caption: 'Mira’s request types out.' },
        { t: '2.4 s', part: <span className="mini-term">⎿ aeolus · commission reviewer</span>, caption: 'steering commissions reviewer.' },
        { t: '3.0 s', part: <span className="mini-term">⎿ aeolus · request crew</span>, caption: 'It asks mira-studio-mac to crew it.' },
      ],
      screen: <Terminal />,
    },
    {
      id: 'builder-03',
      title: 'A new ship awaits its crew',
      surface: 'Console',
      url: 'Console · Fleet overview',
      narrative: 'reviewer is in the fleet now, amber: commissioned, waiting for its crew. Mira owns it; steering commissioned it.',
      spotNote: 'reviewer, awaiting crew on Mira’s computer.',
      spot: 'a[href="#ship-reviewer"]',
      scene: { hop: [1, 3], log: 'steering commissioned reviewer · crew requested' },
      frames: [
        { t: '0.0 s', part: miniTile(K.reviewer, 'awaitingCrew', 'Crew request on mira-studio-mac'), caption: 'The tile joins the Agents group from below and settles.' },
        { t: '0.6 s', part: miniCount('Needs crew', 0, 1), caption: 'Needs crew counts it in the navigation.' },
      ],
      screen: kestrelOverview({ state: 'awaitingCrew', note: 'Crew request on mira-studio-mac' }, 1),
    },
    {
      id: 'builder-04',
      title: 'Your computer crews it',
      surface: 'Console',
      url: 'Console · reviewer · Timeline',
      narrative: 'The trierarch on Mira’s computer takes the crew request and starts reviewer’s session. Aeolus does not host the agent: the computer that joined runs it.',
      spotNote: 'Who commissioned it, who crewed it, and where it runs.',
      spot: '[data-testid=ship-timeline]',
      scene: { hop: [2, 3], log: 'mira-studio-mac crewed reviewer' },
      frames: [
        { t: '0.0 s', part: <ShipState state="awaitingCrew" />, caption: 'Awaiting crew.' },
        { t: '0.8 s', part: <ShipState state="crewed" />, caption: 'Crewed: the session on mira-studio-mac claimed it.' },
      ],
      screen: <ConsoleShipPage fleet={K.fleet} person={K.person} detail={reviewerDetail()} tab="timeline" timeline={reviewerTimeline} />,
    },
    {
      id: 'builder-05',
      title: 'The work comes back',
      surface: 'Console',
      url: 'Console · reviewer · Messages',
      narrative: 'steering sends reviewer its first job, and the findings come back as a reply. A ship nobody set up by hand did real work.',
      spotNote: 'reviewer’s findings, replying to steering’s request.',
      spot: '[data-testid=message-row]:last-child',
      scene: { hop: [3, 1], log: 'reviewer → steering   Review of README.md: 3 findings' },
      frames: [
        { t: '0.0 s', part: miniTile(K.reviewer, 'working', 'Reviewing README.md'), caption: 'reviewer takes the job: working.' },
        { t: '1.4 s', part: miniLine('reviewer', 'steering', 'Review of README.md: 3 findings'), caption: 'Its reply arrives in the thread.' },
        { t: '1.8 s', part: miniTile(K.reviewer, 'idle', 'First review handed back'), caption: 'Done, it rests at idle.' },
      ],
      screen: <ConsoleShipPage fleet={K.fleet} person={K.person} detail={reviewerDetail()} tab="messages" messages={reviewerMessages(true)} />,
    },
    {
      id: 'builder-06',
      title: 'You hear what was built',
      surface: 'Bridge',
      url: 'Bridge · Stay aware',
      narrative: 'steering tells Mira in Bridge what it built, where it runs and what came back. One link opens the ship.',
      spotNote: 'steering’s notice, with the way to the ship.',
      spot: '[data-row=notice]',
      scene: { hop: [1, 0], log: 'steering → mira   reviewer is built and crewed' },
      frames: [
        { t: '0.0 s', part: <BridgeRow row={noticeRow} />, caption: 'The notice slides into Stay aware.' },
        { t: '0.6 s', part: miniCount('Stay aware', 0, 1), caption: 'The count goes to 1.' },
      ],
      screen: kestrelNotice,
    },
    {
      id: 'builder-07',
      title: 'Build with your own steering ship',
      surface: 'Site',
      url: 'aeolus-fleet.dev/demo/builder',
      narrative: 'The real B4 path starts where this tour began: join a computer that stays on, with Claude Code and a repository or folder.',
      scene: { log: 'Tour complete' },
      screen: (
        <Closing
          title="You watched a ship build a ship."
          text="steering commissioned reviewer, Mira’s computer crewed it, and its first review came back. Start B4 on your own computer; get a fleet first if you need one. After B4: add a Decider with D1."
          primary={['Start B4: join your computer', 'guide-builder-after.html']}
          secondary={['Take another tour', 'site-04-after.html']}
          beneath={kestrelNotice}
        />
      ),
    },
  ],
};

const tours = [decider, flowOwner, builder];
for (const tour of tours) {
  tour.thumb = tour.steps.find((step) => step.surface !== 'Site' && step.surface !== 'Terminal' && step.id.endsWith(tour.slug === 'decider' ? '02' : tour.slug === 'builder' ? '03' : '02'))?.screen;
}

// ---------- Today's live demo, for the before frames ----------

const SCRIPTED = { id: TIDEWATER.fleet.id, name: 'Demo fleet' };
const demoShip = (name, suffix) => ({ id: `shp_01m7dem0qzr3a9w6m2v5n7${suffix}`, name });
const liveDemo = (
  <ConsoleOverview
    fleet={SCRIPTED}
    person={{ name: 'Viewer', initials: 'V', ship: demoShip('viewer', 'v000') }}
    banner={<NoticeBanner notice={{ id: 'read-only', audience: 'viewers', text: 'A live demo fleet with scripted ships. You are looking at it read-only.', links: [{ label: 'Guide: 1 of 9', url: '#' }], isDismissible: false }} />}
    inboxCount={3}
    groups={[
      { kind: 'agents', tiles: [tile(demoShip('orchestrator-1', 'v001'), 'working', 'Planning slice 8'), tile(demoShip('implementer-a', 'v002'), 'working', 'Slice 8: offline badge'), tile(demoShip('reviewer-1', 'v003'), 'idle', 'Reviewed PR #412', 9), tile(demoShip('tester-1', 'v004'), 'blocked', 'Waiting on argo')] },
      { kind: 'trierarchs', tiles: [tile(demoShip('demo-host', 'v005'), 'idle', 'Crews the scripted ships', 2)] },
    ]}
  />
);

// ---------- Site entries ----------

const card = (tour) => <TourCard key={tour.slug} tour={tour} href={`${tour.slug}-01-after.html`} />;
const tourCards = <div className="tour-cards">{tours.map(card)}</div>;

function Hero() {
  return (
    <section className="hero-head">
      <p className="eyebrow">Open source · Free in early access</p>
      <h1>Agents, apps and people. Connected together as one fleet.</h1>
      <div>
        <p className="lede">They hand each other work. You answer what needs you.</p>
        <p className="hero-actions">
          <a href="#" className="btn primary">
            Try it →
          </a>
          <a href="site-04-after.html" className="btn line">
            Take a product tour
          </a>
        </p>
      </div>
    </section>
  );
}

function BrowserFrame({ url, children, badge }) {
  return (
    <div className="window">
      <div className="window-bar">
        <span className="window-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="window-url font-mono">{url}</span>
        {badge}
      </div>
      <div className="window-body product">{children}</div>
    </div>
  );
}

const liveBadge = (
  <span className="window-badge live">
    <i /> Live
  </span>
);

const sites = [
  {
    id: 'site-01',
    title: 'Home',
    note: 'Home’s live-fleet section becomes three product tours, one per persona, each card a crop of its own screen.',
    after: (
      <SitePage current="">
        <Hero />
        <section className="sec">
          <div className="sec-head">
            <div>
              <h2>See it before you sign up.</h2>
              <p>Three short tours through the real screens. Nothing to install, nothing real behind them.</p>
            </div>
            <a href="site-04-after.html" className="btn line">
              All tours →
            </a>
          </div>
          {tourCards}
        </section>
      </SitePage>
    ),
    before: (
      <SitePage current="">
        <Hero />
        <section className="sec">
          <div className="sec-head">
            <div>
              <h2>A real fleet, live.</h2>
              <p>Read-only. No account.</p>
            </div>
            <a href="live-01-before.html" className="btn line">
              Open the live demo ↗
            </a>
          </div>
          <BrowserFrame url="Today’s live demo · read-only" badge={liveBadge}>
            {liveDemo}
          </BrowserFrame>
        </section>
      </SitePage>
    ),
  },
  {
    id: 'site-02',
    title: 'Quick start',
    note: 'Quick start keeps the real setup and offers each persona’s tour beside it.',
    after: (
      <SitePage current="Quick start">
        <QuickStartHead />
        <section className="qs-tours">
          <h2>Want to see it first?</h2>
          <p>Each tour walks one person’s first value on the real screens, in a few minutes.</p>
          {tourCards}
        </section>
      </SitePage>
    ),
    before: (
      <SitePage current="Quick start">
        <QuickStartHead />
        <section className="qs-tours">
          <h2>Want to look around first?</h2>
          <p>The footer’s demo link opens one read-only fleet with scripted ships.</p>
          <a href="live-01-before.html" className="btn line">
            Try the live demo ↗
          </a>
        </section>
      </SitePage>
    ),
  },
  {
    id: 'site-03',
    title: 'Start page',
    note: 'The HTML /start and the agent’s Markdown /start name the same three tours before each real path.',
    after: (
      <SitePage current="">
        <section className="page-head">
          <p className="eyebrow">For the agent helping a person · /start</p>
          <h1>Help a person try Aeolus</h1>
          <p className="lede">Ask which path fits them. Offer its tour first, then set it up for real.</p>
        </section>
        <section className="start-paths">
          {tours.map((tour) => (
            <article key={tour.slug} className="start-path">
              <p className="eyebrow">{tour.slug === 'decider' ? 'D2' : tour.slug === 'flow-owner' ? 'F1' : 'B4'} · {tour.persona}</p>
              <h3>{tour.title}</h3>
              <p className="font-mono">Tour: /demo/{tour.slug}</p>
              <a href={`${tour.slug}-01-after.html`} className="tlink">
                Open the tour →
              </a>
            </article>
          ))}
        </section>
      </SitePage>
    ),
    before: <Missing what="/start" />,
  },
  ...tours.map((tour) => {
    const path = tour.slug === 'decider' ? 'D2' : tour.slug === 'flow-owner' ? 'F1' : 'B4';
    const real = { decider: 'Ask a builder to add your email and grant Talk with the fleet rights (D1).', 'flow-owner': 'Name your flow’s steps: which is an app, which an agent, which a person. Get a fleet first if you need one.', builder: 'Join a computer that stays on, with Claude Code and a repository or folder ready. Get a fleet first if you need one.' }[tour.slug];
    return {
      id: `guide-${tour.slug}`,
      title: `${path} guide`,
      note: 'The path guide opens with its tour; the real setup follows unchanged.',
      after: (
        <SitePage current="What it does">
          <section className="page-head">
            <p className="eyebrow">
              {path} · {tour.persona}
            </p>
            <h1>{tour.title}</h1>
            <p className="lede">{tour.lede}</p>
          </section>
          <section className="guide-grid">
            <TourCard tour={tour} href={`${tour.slug}-01-after.html`} isWide />
            <article className="guide-real">
              <h3>Try it for real</h3>
              <p>{real}</p>
              <a href="#" className="btn primary small">
                Start {tour.slug === 'decider' ? 'D1' : path} →
              </a>
            </article>
          </section>
        </SitePage>
      ),
      before: <Missing what={`the ${path} guide`} />,
    };
  }),
  {
    id: 'site-04',
    title: 'Demo index',
    note: '/demo lists the three tours; each starts at step 1 on its own address.',
    after: (
      <SitePage current="">
        <section className="page-head">
          <p className="eyebrow">Product tours · No account</p>
          <h1>See Aeolus at work.</h1>
          <p className="lede">Pick the person you are. Each tour walks the real screens to the first thing Aeolus does for you.</p>
        </section>
        <section className="sec flush">{tourCards}</section>
      </SitePage>
    ),
    before: (
      <SitePage current="">
        <section className="page-head">
          <p className="eyebrow">Today</p>
          <h1>One link, one fleet.</h1>
          <p className="lede">The demo link opens a read-only fleet with scripted ships. No persona, no path, nothing to answer.</p>
        </section>
        <section className="sec flush">
          <BrowserFrame url="Today’s live demo · read-only" badge={liveBadge}>
            {liveDemo}
          </BrowserFrame>
        </section>
      </SitePage>
    ),
  },
];

function QuickStartHead() {
  return (
    <section className="page-head qs">
      <p className="eyebrow">About 5 minutes</p>
      <h1>Quick start</h1>
      <p className="lede">Sign up, connect an agent, answer its first question in Bridge.</p>
      <ol className="qs-rail">
        {[
          ['Sign up', '1 min'],
          ['Add the plugin', '1 min'],
          ['Connect an agent', '2 min'],
          ['Open Bridge', '1 min'],
          ['Answer it', '1 min'],
        ].map(([label, time], index) => (
          <li key={label}>
            <span>{index + 1}</span>
            {label} <small className="font-mono">{time}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Missing({ what }) {
  return (
    <SitePage current="">
      <section className="page-head">
        <p className="eyebrow">Today</p>
        <h1>There is no {what} page yet.</h1>
        <p className="lede">The approved onboarding design adds it. Today the shared footer’s demo link is the only way in.</p>
        <p>
          <a href="live-01-before.html" className="btn line">
            Try the live demo ↗
          </a>
        </p>
      </section>
    </SitePage>
  );
}

// ---------- Render ----------

const css = (step) => (step.spot ? `.spot-${step.id} ${step.spot}{position:relative;outline:2px solid var(--brand-slate);outline-offset:3px;animation:spot-in var(--brand-event-max) var(--brand-settle) both;z-index:5}.spot-${step.id} ${step.spot}::after{content:"1";position:absolute;top:-12px;right:-12px;width:24px;height:24px;border-radius:999px;background:var(--brand-slate);color:#fff;font:600 13px/24px var(--brand-font-text);text-align:center;box-shadow:0 0 0 3px var(--brand-surface)}` : '');

function doc(title, body, extraCss = '') {
  const html = renderToStaticMarkup(body).replaceAll('src="/brand/', 'src="brand/');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="mockups.css">${extraCss ? `<style>${extraCss}</style>` : ''}<script>if(location.hash==='#dark')document.documentElement.classList.add('dark')</script></head><body>${html}</body></html>`;
}

const review = (id, era, note, sheet = true) => (
  <div className="review">
    {sheet ? <a href={`sheet-${id}.html`}>Before and after, both widths</a> : null}
    <span className="font-mono">
      {id} · {era}
    </span>
    <span>{note}</span>
  </div>
);

const frames = [];
writeFileSync(`${out}/live-01-before.html`, doc('Today’s live demo', liveDemo));

for (const page of sites) {
  frames.push({ id: page.id, title: page.title, area: 'site' });
  writeFileSync(`${out}/${page.id}-after.html`, doc(page.title, <>{review(page.id, 'after', page.note)}{page.after}</>));
  writeFileSync(`${out}/${page.id}-before.html`, doc(page.title, <>{review(page.id, 'before', 'Today’s entry, reconstructed in the live site’s look.')}{page.before}</>));
}

const beforeStep = (
  <SitePage current="">
    <section className="page-head">
      <p className="eyebrow">Today · No matching step</p>
      <h1>The same read-only fleet.</h1>
      <p className="lede">Today no tour exists. Every persona lands on this scripted fleet, where nothing is theirs to do.</p>
    </section>
    <section className="sec flush">
      <BrowserFrame url="Today’s live demo · read-only" badge={liveBadge}>
        {liveDemo}
      </BrowserFrame>
    </section>
  </SitePage>
);

for (const tour of tours) {
  const main = tour.steps.filter((step) => !step.alternate);
  for (const step of tour.steps) {
    const index = main.findIndex((one) => one.id === step.id);
    const position = index >= 0 ? index : main.findIndex((one) => one.id === step.id.replace(/b$/, ''));
    const nav = {
      back: `${step.back ?? main[Math.max(0, position - 1)].id}-after.html`,
      next: `${step.next ?? main[Math.min(main.length - 1, position + 1)].id}-after.html`,
      restart: `${main[0].id}-after.html`,
    };
    frames.push({ id: step.id, title: step.title, area: step.surface, alternate: !!step.alternate });
    writeFileSync(`${out}/${step.id}-after.html`, doc(step.title, <>{review(step.id, 'after', 'Proposal. Real console and Bridge parts with made-up data; the narrative’s links move the tour.')}<TourStep tour={tour} step={step} at={position + 1} count={main.length} nav={nav} /></>, css(step)));
    writeFileSync(`${out}/${step.id}-before.html`, doc(step.title, <>{review(step.id, 'before', 'No equivalent step exists today: the same read-only demo destination.')}{beforeStep}</>));
  }
}

// Sheets: before and after, phone and desktop.
for (const frame of frames) {
  const pair = (era) => (
    <section>
      <h2>{era}</h2>
      <div className="pair">
        <figure>
          <figcaption>Phone · 375 × 812</figcaption>
          <iframe title={`${frame.title} ${era} phone`} src={`${frame.id}-${era}.html`} width="375" height="812" />
        </figure>
        <figure>
          <figcaption>Desktop · 1440 × 1000</figcaption>
          <div className="desktop-preview">
            <iframe title={`${frame.title} ${era} desktop`} src={`${frame.id}-${era}.html`} width="1440" height="1000" />
          </div>
        </figure>
      </div>
    </section>
  );
  writeFileSync(
    `${out}/sheet-${frame.id}.html`,
    doc(
      frame.title,
      <main className="sheet">
        <a href="index.html">All steps</a>
        <h1>
          {frame.id}: {frame.title}
        </h1>
        {pair('after')}
        {pair('before')}
      </main>,
    ),
  );
}

writeFileSync(
  `${out}/index.html`,
  doc(
    'Linear demo review',
    <main className="sheet">
      <h1>Linear demo: every numbered screen</h1>
      <p>Each sheet shows the proposal and today, at phone and desktop width. Steps marked b replace the step before them for the other answer.</p>
      <ol>
        {frames.map((frame) => (
          <li key={frame.id}>
            <a href={`sheet-${frame.id}.html`}>
              {frame.id}: {frame.title}
            </a>{' '}
            <small>{frame.area}</small>
          </li>
        ))}
      </ol>
    </main>,
  ),
);
writeFileSync(`${out}/manifest.json`, `${JSON.stringify(frames, null, 2)}\n`);
