/**
 * The product's screens, composed from the ui package's and the console's real
 * parts with the tours' fabricated data. Callbacks are inert: the tour moves on
 * through its own links, never through a request.
 */
import { appSwitcherOf } from '@aeolus-fleet/common/rules';
import { THEMES } from '@aeolus-fleet/common';
import { AppHeader, Badge, Button, Harbour, ShipState, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, ToastCard } from '@aeolus-fleet/ui';
import { Bell, ChevronLeft, CircleHelp, Clock3, Inbox, Mail, Megaphone, Settings, Ship, SquareCheckBig } from 'lucide-react';
import { ConsoleFrame } from '../../../../packages/console/components/organisms/console-frame';
import { ListPage } from '../../../../packages/console/components/organisms/list-page';
import { DetailPage } from '../../../../packages/console/components/organisms/detail-page';
import { LiveStatus } from '../../../../packages/console/components/molecules/live-status';
import { ShipName } from '../../../../packages/console/components/molecules/ship-name';
import { QuestionReader } from '../../../../packages/console/features/inbox/ui/organisms/question-reader';
import { NoticeBanner } from '../../../../packages/console/features/notices/molecules/notice-banner';
import { MessageBody } from '../../../../packages/console/features/inbox/ui/molecules/message-body';
import { messageTextOf } from '../../../../packages/console/lib/message-text';
import { ShipHeader } from '../../../../packages/console/features/ship/ui/organisms/ship-header';
import { ShipOwner } from '../../../../packages/console/features/ship/ui/molecules/ship-owner';
import { MessageThreads } from '../../../../packages/console/features/ship/ui/organisms/message-threads';
import { ShipTimeline } from '../../../../packages/console/features/ship/ui/organisms/ship-timeline';
import { NOW, at, deliveryId, eventId, messageId } from './fixtures';

const noop = () => undefined;

export function switcherOf(fleet, app) {
  return appSwitcherOf({ list: undefined, fleet, app });
}

export function accountOf(person) {
  return {
    name: person.name,
    signedInAs: person.ship.name,
    session: 'Device · Mac · Safari, since 08:12',
    theme: 'light',
    themes: THEMES,
    hasTheme: true,
    onThemeChange: noop,
    shortcuts: [{ keys: ['⌘', 'K'], label: 'Search ships or jump to' }],
    helpUrl: 'https://aeolus-fleet.dev',
    onSignOut: noop,
    isSigningOut: false,
  };
}

// ---------- Console ----------

export const tile = (ship, state, note, minutes = 1) => ({ id: ship.id, name: ship.name, state, note, lastActivityAt: at(minutes) });

/** Each tile links to its ship by name, so a step can point at one tile. */
function hrefOfShips(groups) {
  const names = new Map(groups.flatMap((group) => group.tiles.map((one) => [one.id, one.name])));
  return (id) => `#ship-${names.get(id) ?? ''}`;
}

export function countsOf(groups) {
  const tiles = groups.flatMap((group) => group.tiles);
  const count = (state) => tiles.filter((one) => one.state === state).length;
  return { ships: tiles.length, alert: count('alert'), awaitingCrew: count('awaitingCrew'), blocked: count('blocked'), working: count('working'), idle: count('idle') };
}

/** The console's fleet overview: Harbour's numbers and tiles inside the real frame. */
export function ConsoleOverview({ fleet, person, groups, inboxCount = 0, needsCrewCount = 0, banner, active = 'overview' }) {
  return (
    <ConsoleFrame nav={{ active, inboxCount, needsCrewCount, hasTrierarchs: true }} account={accountOf(person)} fleetName={fleet.name}>
      <ListPage title="Fleet overview" phoneTitle="Fleet" description={`${fleet.name} · ${countsOf(groups).ships} ships`} live="live" switcher={switcherOf(fleet, 'console')} account={accountOf(person)} onSearch={noop} onCompose={noop} banner={banner}>
        <Harbour state="ready" now={NOW} onRetry={noop} counts={countsOf(groups)} groups={groups} hrefOf={hrefOfShips(groups)} />
      </ListPage>
    </ConsoleFrame>
  );
}

export function shipDetail({ ship, type, kind = 'agent', status = 'crewed', owner, commissioner, location = 'mira-studio-mac', scopes = ['messages:send', 'messages:receive'], crewedMinutes = 3, report = null, statement = null }) {
  return {
    id: ship.id,
    name: ship.name,
    type,
    kind,
    status,
    startingPrompt: status === 'crewed' ? { issuedAt: at(crewedMinutes + 1), isClaimed: true } : null,
    location: status === 'crewed' ? { kind: 'DEVICE', description: location } : null,
    lastSeenAt: status === 'crewed' ? at(0) : null,
    ping: null,
    scopes,
    report,
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    activity: null,
    openAlertCount: 0,
    awaitingCrewSince: status === 'awaitingCrew' ? at(1) : null,
    crewRequest: null,
    labels: [],
    commissionedAt: at(crewedMinutes + 2),
    crewedSince: status === 'crewed' ? at(crewedMinutes) : null,
    removedAt: null,
    retiredAt: null,
    inFlightDeliveries: 0,
    openDeliveries: 0,
    owner,
    ownerShipId: owner.id,
    commissionedByShipId: commissioner.id,
    statement,
    openAlerts: [],
    expectations: { reportChangesWithin: null, taskDoneBy: null },
  };
}

export function listed(suffix, { sender, recipient, sentAt, preview, state = 'acknowledged', inReplyTo = null, contentType = 'text/plain' }) {
  return {
    id: messageId(suffix),
    sender,
    recipient: { kind: 'ship', ship: recipient },
    inReplyTo: inReplyTo === null ? null : messageId(inReplyTo),
    sentAt,
    contentType,
    model: 'claude-opus-5-5',
    preview,
    isPayloadUnreadable: false,
    isPayloadSealed: false,
    delivery: { id: deliveryId(suffix), state, claimedBy: state === 'pending' ? null : recipient, isPulled: false },
  };
}

export function event(seq, entry) {
  return { seq, id: eventId(String(seq).padStart(4, '0')), signedInAccountId: null, details: {}, message: null, ...entry };
}

/** The console's ship page: header, then the Timeline or Messages tab, in the real detail frame. */
export function ConsoleShipPage({ fleet, person, detail, tab, timeline = [], messages = [], inboxCount = 0, needsCrewCount = 0 }) {
  return (
    <ConsoleFrame nav={{ active: 'overview', inboxCount, needsCrewCount, hasTrierarchs: true }} account={accountOf(person)} fleetName={fleet.name}>
      <DetailPage
        title={detail.name}
        parents={[{ href: '#', label: 'Fleet overview' }]}
        live="live"
        switcher={switcherOf(fleet, 'console')}
        account={accountOf(person)}
        onSearch={noop}
        onCompose={noop}
        header={<ShipHeader ship={detail} state="ready" now={NOW} viewerFleetId={fleet.id} actions={<Button size="sm">Send message</Button>} owner={<ShipOwner owner={{ kind: 'ship', id: detail.owner.id, name: detail.owner.name, isYou: detail.owner.name === person.ship.name }} />} />}
      >
        <Tabs defaultValue={tab}>
          <TabsList variant="line" aria-label={`${detail.name} history`}>
            <TabsTrigger variant="line" value="timeline">Timeline</TabsTrigger>
            <TabsTrigger variant="line" value="messages">Messages</TabsTrigger>
          </TabsList>
          <TabsContent value="timeline" className="pt-4">
            <ShipTimeline shipId={detail.id} entries={timeline} state="ready" now={NOW} onOpenMessage={noop} />
          </TabsContent>
          <TabsContent value="messages" className="pt-4">
            <MessageThreads shipId={detail.id} messages={messages} state="ready" now={NOW} onOpenMessage={noop} />
          </TabsContent>
        </Tabs>
      </DetailPage>
    </ConsoleFrame>
  );
}

// ---------- Bridge ----------

const BRIDGE_NAV = [
  { key: 'waiting', label: 'Waiting on you', Icon: Inbox },
  { key: 'aware', label: 'Stay aware', Icon: Bell },
  { key: 'done', label: 'Done', Icon: SquareCheckBig },
  { key: 'fleet', label: 'Your fleet', Icon: Ship },
];

function BridgeSidebar({ person, fleet, active, counts }) {
  return (
    <aside className="bridge-sidebar" aria-label="Bridge">
      <div className="bridge-brand">
        <img src="brand/aeolus-mark-slate.svg" alt="" className="size-6" />
        <span>Bridge</span>
      </div>
      <nav>
        {BRIDGE_NAV.map(({ key, label, Icon }) => (
          <a key={key} href="#" className="bridge-nav" aria-current={active === key ? 'page' : undefined} data-nav={key}>
            <Icon aria-hidden className="size-4" />
            <span className="grow">{label}</span>
            {counts[key] ? <span className="bridge-count" data-count={key}>{counts[key]}</span> : null}
          </a>
        ))}
        <p className="bridge-nav-head">Settings</p>
        {['Where things show', 'Outside parties', 'Fleets and account'].map((label) => (
          <a key={label} href="#" className="bridge-nav">
            <Settings aria-hidden className="size-4" />
            <span className="grow">{label}</span>
          </a>
        ))}
      </nav>
      <div className="bridge-foot">
        <span className="bridge-avatar">{person.initials}</span>
        <span className="flex min-w-0 flex-col">
          <strong className="truncate text-body">{person.name}</strong>
          <span className="truncate text-meta text-muted-foreground">{fleet.name}</span>
        </span>
      </div>
    </aside>
  );
}

const KIND_LOOK = {
  decide: { word: 'Decide', Icon: CircleHelp },
  aware: { word: 'Aware', Icon: Megaphone },
  message: { word: 'Message', Icon: Mail },
  done: { word: 'Done', Icon: SquareCheckBig },
};

/** One row of Bridge's list, as the approved Bridge design draws it. */
export function BridgeRow({ row }) {
  const { word, Icon } = KIND_LOOK[row.kind];
  return (
    <a href="#" className="bridge-row" aria-current={row.isOpen ? 'true' : undefined} data-row={row.id} data-new={row.isNew ? 'true' : undefined}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 grow flex-col gap-1">
        <span className="flex items-baseline gap-2">
          {row.isUnread ? <span className="bridge-unread" aria-label="Not read" /> : null}
          <span className="truncate text-body font-medium">{row.title}</span>
          <span className="ml-auto shrink-0 font-mono text-id text-muted-foreground">{row.time}</span>
        </span>
        <span className="flex items-center gap-2 text-meta text-muted-foreground">
          <Badge variant="outline">{word}</Badge>
          <span className="truncate">
            {row.verb} <span className="font-mono text-foreground">{row.from}</span>
          </span>
        </span>
      </span>
    </a>
  );
}

function BridgeList({ title, rows, empty }) {
  return (
    <section className="bridge-list" aria-label={title}>
      <h2 className="bridge-list-title">
        {title} <span className="text-muted-foreground">{rows.length}</span>
      </h2>
      {rows.length === 0 ? <p className="bridge-empty">{empty}</p> : rows.map((row) => <BridgeRow key={row.id} row={row} />)}
    </section>
  );
}

/** Bridge's question, through the same QuestionReader the console's inbox renders. */
export function BridgeQuestion({ asker, question, answer, isPhone }) {
  const entry = {
    kind: 'question',
    deliveryId: deliveryId('q001'),
    messageId: messageId('q001'),
    state: answer ? 'acknowledged' : 'pending',
    readAt: at(0),
    doneAt: answer ? at(0) : null,
    model: 'claude-opus-5-5',
    sealing: 'plain',
    stale: null,
    replaces: null,
    sender: { id: asker.id, name: asker.name, type: 'agent', isNameShared: false },
    sentAt: at(2),
    question: { ...question, answer: answer ? { messageId: messageId('q002'), sentAt: at(0), option: answer, note: null } : null },
  };
  return <QuestionReader question={entry} position={{ number: 1, count: 1, left: 0 }} isPhone={isPhone} onAnswer={noop} onSelect={noop} isPending={false} now={NOW} />;
}

/** A message read in Bridge: who sent it, when, and its body as the console's MessageBody renders it. */
export function BridgeMessage({ from, kind, title, body, sentMinutes = 0, footer }) {
  const text = messageTextOf({ contentType: 'text/markdown', payload: `${title}\n\n${body}` });
  const { word, Icon } = KIND_LOOK[kind];
  return (
    <article className="bridge-message" data-message="open">
      <p className="flex items-center gap-2 text-meta text-muted-foreground">
        <Badge variant="outline">
          <Icon aria-hidden />
          {word}
        </Badge>
        from <ShipName name={from.name} shipId={from.id} /> · <Clock3 aria-hidden className="size-3.5" /> {sentMinutes === 0 ? 'just now' : `${sentMinutes} min ago`}
      </p>
      <h2 className="text-heading font-semibold text-foreground">{title}</h2>
      <MessageBody blocks={text.body} lineCount={text.lineCount} />
      {footer}
    </article>
  );
}

/** Bridge, desktop and phone: the sidebar, the list and the reader, or on phone the open item with the tab bar. */
export function Bridge({ fleet, person, active, counts, rows, listTitle, reader, phoneTitle, toast, phoneView = 'reader', empty = 'Nothing waits on you.' }) {
  return (
    <div className="bridge" data-app="bridge" data-phone={phoneView}>
      <BridgeSidebar person={person} fleet={fleet} active={active} counts={counts} />
      <div className="bridge-main">
        <AppHeader switcher={switcherOf(fleet, 'gateway')} switcherLayout="fleet" search="field" onSearch={noop} searchLabel="Search what reached you" actions={<LiveStatus state="live" />} className="bridge-header">
          <span className="text-muted-foreground">/</span>
          <span className="text-body font-medium">{listTitle}</span>
        </AppHeader>
        <header className="bridge-topbar">
          <ChevronLeft aria-hidden className="size-5" />
          <strong className="grow text-heading-touch">{phoneTitle}</strong>
          <LiveStatus state="live" />
          <span className="bridge-avatar">{person.initials}</span>
        </header>
        <div className="bridge-columns">
          <BridgeList title={listTitle} rows={rows} empty={empty} />
          <section className="bridge-reader">{reader}</section>
        </div>
        {toast ? <div className="bridge-toast">{toast}</div> : null}
        <nav className="bridge-tabbar" aria-label="Bridge">
          {BRIDGE_NAV.map(({ key, label, Icon }) => (
            <a key={key} href="#" aria-current={active === key ? 'page' : undefined}>
              <span className="relative">
                <Icon aria-hidden className="size-5" />
                {counts[key] ? <span className="bridge-tab-count">{counts[key]}</span> : null}
              </span>
              {label.replace(' on you', '').replace('Stay ', '').replace('Your ', '')}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function Toast(props) {
  return <ToastCard {...props} />;
}

export { NoticeBanner, ShipState, StatusBadge };
