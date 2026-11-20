/* Documentation fixture. No app imports this file, and no request or real sign-in runs. */
/* global document, window, URLSearchParams */
const query = new URLSearchParams(window.location.search);
let surface = query.get('surface') === 'bridge' ? 'bridge' : 'console';
const era = query.get('era') === 'before' ? 'before' : 'after';
let state = query.get('state') || 'several';
/* Which panel is open: the Apps and fleets panel, the account panel, or none. */
let panel = ['closed', 'arrived', 'detail', 'single-fleet', 'long-name'].includes(state) ? '' : state === 'account' ? 'account' : 'apps';
let currentApp = surface === 'bridge' ? 'Gateway' : 'Console';
const longNames = ['long-name', 'long-name-open'].includes(state);
let currentFleet = longNames ? 'Aeolus research and development' : 'Aeolus';
/* The fleets this person can open: one where the session reaches only its own fleet. */
const fleets = () => isRestricted() || state.startsWith('single-fleet') ? [currentFleet] : [currentFleet, longNames ? 'Harbour operations and logistics, northern region' : 'Harbour'].sort((a, b) => a === 'Aeolus' || a.startsWith('Aeolus ') ? -1 : b === 'Aeolus' || b.startsWith('Aeolus ') ? 1 : a.localeCompare(b));
/* Switching fleet: '' (idle), 'busy' (opening) or 'failed'. fail=1 makes the first switch fail. */
let switching = '';
let switchTarget = '';
let failNext = query.get('fail') === '1';
let retryingSwitch = false;
let openingName = '';
let openingKind = '';
let lastState = '';
let refreshed = false;
let fixtureFeedback = '';
if (query.get('theme') === 'dark') document.documentElement.classList.add('dark');

/* Lucide path shapes. */
const paths = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
  arrow: '<path d="M7 7h10v10M7 17 17 7"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9Z"/><path d="m2 15 10 6 10-6M2 12l10 6 10-6"/>',
  ship: '<path d="M12 3v9m-6 0V6h12v6M3 13l9-4 9 4-3 6H6Z"/><path d="M2 21c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/>',
  door: '<path d="M11 20H2"/><path d="M11 4.56v16.16a1 1 0 0 0 1.24.97L19 20V5.56a2 2 0 0 0-1.52-1.94l-4-1A2 2 0 0 0 11 4.56z"/><path d="M11 4H8a2 2 0 0 0-2 2v14"/><path d="M14 12h.01"/><path d="M22 20h-3"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  inbox: '<path d="M4 4h16l2 10v6H2v-6Z"/><path d="M2 14h6l2 3h4l2-3h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v4m0 4h.01"/>',
  spinner: '<path d="M12 3a9 9 0 1 1-9 9"/>',
  logout: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-3Z"/>',
};
const icon = (name, cls = '') => `<svg aria-hidden="true" class="${cls}" viewBox="0 0 24 24">${paths[name]}</svg>`;
const appIcons = { Console: 'ship', Gateway: 'door', 'App 1': 'box', 'App 2': 'box' };
const isPhone = () => window.innerWidth < 640;
const isRestricted = () => ['argo', 'viewer', 'single'].includes(state);
const bridgeGate = () => surface === 'bridge' && isRestricted();
const otherApp = () => currentApp === 'Console' ? 'Gateway' : 'Console';
const slug = (name) => name.toLowerCase().replaceAll(' ', '-');
const announce = (text) => { document.querySelector('#feedback').textContent = text; };
const session = () => state === 'argo' ? 'argo' : state === 'viewer' ? 'viewer' : state === 'single' ? 'argo' : 'account';
const identity = () => bridgeGate() ? 'Not signed in' : session() === 'argo' ? 'Signed in as argo' : session() === 'viewer' ? 'Viewer' : state === 'expired' ? 'Sign-in expired' : 'Your account';
const initials = () => bridgeGate() ? '?' : session() === 'argo' ? 'ar' : session() === 'viewer' ? 'V' : 'TH';

/* ---------- Before: round 1's reconstruction of today's source, unchanged. ---------- */
const isBeforePlain = () => isRestricted() || ['missing', 'expired', 'loading', 'error'].includes(state);
function beforeTrigger() {
  if (isBeforePlain()) return `<span class="before-trigger">${surface === 'console' ? currentFleet : 'Gateway'}</span>`;
  if (isPhone()) return `<button class="before-trigger" id="switcher">${surface === 'console' ? 'Fleet' : 'Gateway'} ${icon('chevron')}</button>`;
  return surface === 'console'
    ? `<button class="before-trigger before-fleet" id="switcher">${currentFleet}</button><span class="crumb">/ Fleet</span>`
    : `<button class="before-trigger" id="switcher">${currentFleet}</button><span class="muted">/</span><button class="before-trigger" id="old-app">Gateway ${icon('chevron')}</button>`;
}
function beforeRow(name, kind) {
  const current = kind === 'fleet' ? name === currentFleet : name === currentApp;
  return `<a class="choice ${current ? 'current' : ''}" href="#${kind}-${slug(name)}" ${current ? 'aria-current="page"' : ''}>${icon(kind === 'fleet' ? 'layers' : 'arrow')}<span>${name}</span><span class="end">${current ? `${icon('check')}<span class="sr-only">Current</span>` : ''}</span></a>`;
}
function beforePanel() {
  const appOnly = surface === 'bridge' && !isPhone();
  return `<h2 class="sr-only" id="panel-title">Apps and fleets</h2>${appOnly ? '' : `<div class="group-label">Fleets</div>${beforeRow(currentFleet, 'fleet')}${beforeRow('Harbour', 'fleet')}<hr class="separator">`}<div class="group-label">Apps</div>${beforeRow(currentApp, 'app')}${beforeRow(otherApp(), 'app')}${beforeRow('App 1', 'app')}${beforeRow('App 2', 'app')}`;
}
function renderBefore() {
  const visible = panel !== '' && !isBeforePlain();
  document.querySelector('#root').innerHTML = `${surface === 'console' ? `<aside class="sidebar before"><div class="brand">${icon('ship')} Aeolus</div>${sideRows()}<div class="sidebar-bottom"><div class="meta">${identity()}</div></div></aside>` : ''}<div class="workspace before ${surface}"><header class="header">${beforeTrigger()}${surface === 'bridge' ? '<div class="tabs"><span class="on">Bridge</span><span>Outside parties</span></div>' : ''}<div class="header-right"><span class="meta">${identity()}</span><span class="avatar">${initials()}</span></div></header><main class="content">${shellContent()}</main>${phoneTabs()}${visible ? `<div class="scrim"></div><section class="panel before-panel" role="dialog" aria-labelledby="panel-title"><div class="handle"></div>${beforePanel()}<button class="btn close">Cancel</button></section>` : ''}</div>`;
}

/* ---------- Shared page content, the same before and after. ---------- */
function sideRows() {
  return ['Fleet', 'Inbox', 'Trierarchs', 'Settings'].map((label, i) => `<div class="side-row ${i === 0 ? 'on' : ''}">${icon(['ship', 'inbox', 'layers', 'settings'][i])}${label}</div>`).join('');
}
function phoneTabs() {
  return `<div class="phone-tabs"><span class="on">${icon(surface === 'bridge' ? 'inbox' : 'ship')}${surface === 'bridge' ? 'Waiting' : 'Fleet'}</span><span>${icon('inbox')}${surface === 'bridge' ? 'Aware' : 'Inbox'}</span><span>${icon('layers')}${surface === 'bridge' ? 'Done' : 'Trierarchs'}</span><span>${icon('settings')}${surface === 'bridge' ? 'Fleet' : 'Settings'}</span></div>`;
}
function shellContent() {
  if (bridgeGate()) {
    if (era === 'before') return '<h1>Bridge</h1><p class="meta">Sign in with an account to continue.</p>';
    const reason = state === 'argo' ? 'Signing in as argo is available only in Console.' : state === 'viewer' ? 'A viewer sign-in is for Console. Bridge requires an account.' : 'Only Console is configured in this installation. Bridge is not installed.';
    return `<div class="heading"><h1>Bridge</h1></div><div class="notice"><strong>${state === 'single' ? 'Bridge is not available' : 'Sign in with an account to use Bridge'}</strong><p>${reason}</p><p>No account is signed in here.</p></div>`;
  }
  if (state === 'arrived') return `<div class="arrival" role="status">${icon('check')} ${currentApp} is open in ${currentFleet}.</div><h1>${surface === 'bridge' ? 'Bridge' : 'Fleet'}</h1><p class="meta">The bar names the app and the fleet next to the launcher.</p>`;
  if (state === 'detail') return `<p class="meta">Fleet / builder-console</p><h1>builder-console</h1><div class="notice"><strong>Working on the shared header</strong><p>The launcher with the app and fleet, and the account button, stay in the bar on a detail page.</p></div>`;
  if (surface === 'bridge') return `<div class="heading"><h1>Waiting on you</h1><span class="badge">3</span></div><p class="meta">${currentFleet} · Your account</p>${[
    ['Which task goes first?', 'Decide · orchestrator-1 · 12 min ago'],
    ['Open the draft design', 'Do · builder-console · 24 min ago'],
    ['Review the fleet’s requests', 'Decide · orchestrator-1 · 1 h ago'],
  ].map(([title, meta]) => `<div class="bridge-card">${icon('inbox')}<div class="copy"><strong>${title}</strong><p class="meta">${meta}</p></div></div>`).join('')}`;
  return `<div class="heading"><h1>Fleet</h1><span class="meta">4 ships</span></div><p class="meta">${currentFleet} · ${identity()}</p><div class="toolbar"><span class="filter">${icon('search')} Search ships</span><span class="filter">Status: All</span><span class="filter">Type: All</span></div><div class="table"><div class="table-head"><span>Ship</span><span>Status</span><span>Report</span><span>Last seen</span></div>${[
    ['orchestrator-1', 'Crewed', 'Coordinates the fleet', 'Now'],
    ['builder-console', 'Crewed', 'Working on the shared header', '1 min ago'],
    ['reviewer', 'Crewed', 'Ready for a review', '2 min ago'],
    ['builder-core', 'Awaiting crew', 'Get the starting prompt', ''],
  ].map(([name, status, report, seen]) => `<div class="ship-row"><strong>${name}</strong><span class="status ${status === 'Awaiting crew' ? 'waiting' : ''}">${icon(status === 'Crewed' ? 'check' : 'clock')}${status}</span><span class="report">${report}</span><span class="seen">${seen}</span></div>`).join('')}</div>`;
}

/* ---------- After: one launcher for apps and fleets at the start, the account at the end. ---------- */
function tile(name) {
  const current = name === currentApp;
  const busy = state === 'opening' && openingKind === 'app' && name === openingName;
  const waiting = (state === 'opening' && !busy) || switching === 'busy';
  const caption = busy ? `${icon('spinner', 'busy-icon')} Opening` : current ? 'Current' : '';
  return `<a class="tile ${current ? 'current' : ''}" href="#app-${slug(name)}" data-name="${name}" data-kind="app" ${current ? 'aria-current="page"' : ''} ${waiting ? 'aria-disabled="true"' : ''} aria-label="${busy ? `Opening ${name}` : current ? `${name}, current app` : name}"><span class="tile-icon">${icon(appIcons[name])}</span><span class="tile-name">${name}</span><span class="tile-caption">${caption}</span></a>`;
}
function blockedTile(name, reason) {
  return `<div class="tile unavailable" aria-label="${name}, ${reason}"><span class="tile-icon">${icon(appIcons[name])}</span><span class="tile-name">${name}</span><span class="tile-caption">${reason}</span></div>`;
}
function skeletonTiles(count) {
  return Array.from({ length: count }, () => '<span class="tile skeleton-tile"><span class="skeleton square"></span><span class="skeleton line"></span></span>').join('');
}
function panelTop(title) {
  return `<div class="panel-title"><h2 id="panel-title">${title}</h2></div>`;
}
function sectionHead({ id, label, iconName, context }) {
  return `<div class="section-head">${icon(iconName)}<h3 id="${id}">${label}</h3></div>${context ? `<p class="context">${context}</p>` : ''}`;
}
/* The apps section: tiles, three to a row, and the app states inline. */
function appsSection() {
  const top = sectionHead({ id: 'apps-heading', label: 'Apps', iconName: 'grid', context: bridgeGate() ? 'Apps this installation offers' : `Apps you can open in ${currentFleet}` });
  if (isRestricted()) {
    let title, text;
    if (state === 'single') { title = 'No other apps'; text = 'Only Console is configured in this installation. There are no other apps to open.'; }
    if (state === 'argo') { title = 'Signed in as argo'; text = 'This sign-in is for Console in Aeolus. Other apps require an account sign-in. Bridge does not accept an argo sign-in.'; }
    if (state === 'viewer') { title = 'Viewer'; text = 'This viewer sign-in is for Console in Aeolus. Other apps are not supplied for this session. Bridge requires an account.'; }
    const tiles = bridgeGate() ? blockedTile('Console', 'Configured app') : tile('Console');
    return `${top}<div class="tiles">${tiles}</div><div class="notice"><strong>${title}</strong><p>${text}</p><p>${bridgeGate() ? 'No account apps are available here. No identity has changed.' : 'You can keep using this Console session.'}</p></div>`;
  }
  if (state === 'expired') return `${top}${fixtureFeedback ? `<div class="notice" role="status">${fixtureFeedback}</div>` : ''}<div class="tiles">${tile(currentApp)}${blockedTile(otherApp(), 'Sign-in required')}</div><div class="notice error" role="alert"><strong>${icon('alert')} Your sign-in has expired</strong><p>Sign in again to open ${otherApp()}. The current page remains visible, but does not prove you still have access.</p><button class="btn primary" id="signin">Sign in</button></div>`;
  const other = state === 'missing' ? blockedTile(otherApp(), 'Unavailable') : tile(otherApp());
  const tiles = `${tile(currentApp)}${other}${tile('App 1')}${tile('App 2')}`;
  const missing = state === 'missing' ? `<div class="notice error" role="alert"><strong>${icon('alert')} Couldn’t open ${otherApp()}</strong><p>This app is no longer available. You are still in ${currentApp}. Try again to refresh the apps.</p><button class="btn" id="retry">Try again</button></div>` : '';
  const status = state === 'opening' ? `<p class="context foot" role="status">Opening ${openingName}…</p>` : '';
  return `${top}${fixtureFeedback ? `<div class="notice" role="status">${fixtureFeedback}</div>` : ''}<div class="tiles">${tiles}</div>${missing}${status}`;
}
function fleetRow(name) {
  const current = name === currentFleet;
  const busy = switching === 'busy' && name === switchTarget;
  const waiting = (switching === 'busy' && !busy) || state === 'opening';
  const end = busy ? icon('spinner', 'busy-icon') : current ? `<span class="current-mark">${icon('check')}Current</span><span class="sr-only">Current fleet</span>` : '';
  return `<a class="choice ${current ? 'current' : ''}" href="#fleet-${slug(name)}" data-name="${name}" data-kind="fleet" ${current ? 'aria-current="page"' : ''} ${waiting ? 'aria-disabled="true"' : ''}>${icon('layers', 'fleet-icon')}<span>${busy ? `Opening ${name}` : name}</span><span class="end">${end}</span></a>`;
}
/* The fleets section: one row per fleet, the current one checked; switching shows inline. */
function fleetsSection() {
  if (bridgeGate()) return `${sectionHead({ id: 'fleets-heading', label: 'Fleets', iconName: 'layers', context: 'No fleet: no account is signed in here.' })}`;
  const one = fleets().length === 1;
  const context = one ? 'This is the only fleet you can open.' : `Choose a fleet. You stay in ${currentApp} where that fleet has it.`;
  const retryBusy = switching === 'busy' && retryingSwitch;
  const failed = switching === 'failed' || retryBusy ? `<div class="notice error" ${retryBusy ? '' : 'role="alert"'}><strong>${icon('alert')} Couldn’t open ${switchTarget}</strong><p>You are still in ${currentFleet}. Try again to open ${switchTarget}.</p><button class="btn" id="switch-retry" ${retryBusy ? 'disabled' : ''}>${retryBusy ? icon('spinner', 'busy-icon') : ''}Try again</button></div>` : '';
  const status = switching === 'busy' ? `<p class="context foot" role="status">Opening ${switchTarget}…</p>` : '';
  return `${sectionHead({ id: 'fleets-heading', label: 'Fleets', iconName: 'layers', context })}<div class="fleet-rows" role="group" aria-labelledby="fleets-heading">${fleets().map(fleetRow).join('')}</div>${failed}${status}`;
}
function combinedPanel() {
  const top = panelTop('Apps and fleets');
  if (['loading', 'retrying'].includes(state)) {
    const rows = '<span class="skeleton row"></span><span class="skeleton row short"></span>';
    return `${top}${sectionHead({ id: 'apps-heading', label: 'Apps', iconName: 'grid', context: '' })}<div class="tiles">${skeletonTiles(4)}</div><hr class="separator">${sectionHead({ id: 'fleets-heading', label: 'Fleets', iconName: 'layers', context: '' })}${rows}<p class="context" role="status">Loading apps and fleets…</p>${state === 'retrying' ? `<button class="btn" disabled>${icon('spinner', 'busy-icon')} Try again</button>` : ''}`;
  }
  if (state === 'error') return `${top}<div class="notice error" role="alert"><strong>${icon('alert')} Couldn’t load apps and fleets</strong><p>Your current page is still open. Try again to load them.</p><button class="btn" id="retry">Try again</button></div>`;
  const done = refreshed ? '<p class="context foot" role="status">Apps and fleets refreshed.</p>' : '';
  return `${top}<section aria-labelledby="apps-heading">${appsSection()}</section><hr class="separator"><section aria-labelledby="fleets-heading">${fleetsSection()}</section>${done}`;
}
function accountPanel() {
  const who = session() === 'argo' ? 'argo' : session() === 'viewer' ? 'Viewer' : 'Your account';
  const how = session() === 'argo' ? 'Signed in as argo, for Console in Aeolus' : session() === 'viewer' ? 'Viewer sign-in, for Console in Aeolus' : 'Signed in with your account';
  const signingOut = state === 'signing-out';
  return `<div class="who-head"><span class="avatar large">${initials()}</span><span class="who-words"><strong id="panel-title">${who}</strong><span class="meta">${how}</span></span></div><hr class="separator"><button class="choice" id="signout" ${signingOut ? 'disabled' : ''}>${icon(signingOut ? 'spinner' : 'logout', signingOut ? 'busy-icon' : '')}<span>Sign out</span></button>${signingOut ? '<p class="context" role="status">Signing out…</p>' : ''}`;
}
function bar() {
  const phone = isPhone();
  const appName = `<span class="app-name">${icon(appIcons[currentApp])}<span>${currentApp}</span></span>`;
  const fleetText = bridgeGate() ? 'No fleet' : currentFleet;
  const fleetPill = `<span class="fleet-pill" title="Fleet: ${fleetText}">${switching === 'busy' ? icon('spinner', 'busy-icon') : icon('layers')}<span class="sr-only">Fleet: </span><span class="fleet-name">${fleetText}</span></span>`;
  const after = surface === 'bridge' ? '<div class="tabs"><span class="on">Bridge</span><span>Outside parties</span></div>' : '<span class="crumb">/ Fleet</span>';
  const accountLabel = bridgeGate() ? 'Account: not signed in' : `Account: ${identity()}`;
  return `<header class="bar"><button class="launcher" id="launcher" aria-label="Apps and fleets" aria-haspopup="dialog" aria-expanded="${panel === 'apps'}" aria-controls="apps-panel" title="Apps and fleets">${icon('grid')}</button>${appName}${fleetPill}${after}<div class="bar-end"><button class="account" id="account" aria-label="${accountLabel}" aria-haspopup="dialog" aria-expanded="${panel === 'account'}" aria-controls="account-panel" ${bridgeGate() ? 'disabled' : ''}>${phone ? '' : `<span class="who"><span class="meta">${identity()}</span></span>`}<span class="avatar">${initials()}</span></button></div></header>`;
}
/* One tab stop per group: the tiles, then the fleet rows; arrow keys move inside a group. */
function rove() {
  for (const selector of ['.panel .tile[data-name]', '.panel .choice[data-kind="fleet"]']) {
    const items = [...document.querySelectorAll(selector)];
    const keep = items.find((node) => node.getAttribute('aria-current') === 'page') || items.find((node) => node.getAttribute('aria-disabled') !== 'true') || items[0];
    items.forEach((node) => node.setAttribute('tabindex', node === keep ? '0' : '-1'));
  }
}
function moveFocus(items, { from, to }) {
  const target = items[Math.min(items.length - 1, Math.max(0, to))];
  items[from].setAttribute('tabindex', '-1'); target.setAttribute('tabindex', '0'); target.focus();
}
function renderAfter() {
  const sheet = isPhone() ? 'aria-modal="true"' : '';
  const body = panel === 'apps' ? combinedPanel() : panel === 'account' ? accountPanel() : '';
  document.querySelector('#root').innerHTML = `${bar()}${surface === 'console' ? `<aside class="sidebar">${sideRows()}</aside>` : ''}<div class="workspace ${surface}"><main class="content">${shellContent()}</main>${phoneTabs()}</div>${panel ? `<div class="scrim" id="scrim"></div><section class="panel ${panel}-panel" id="${panel}-panel" role="dialog" aria-labelledby="panel-title" ${sheet}><div class="handle"></div>${body}<button class="btn close" id="close">Cancel</button></section>` : ''}`;
  rove();
  wire();
}

/* ---------- Choices: every one shows its feedback at once and its loading while it works. ---------- */
function wire() {
  document.querySelector('#launcher')?.addEventListener('click', () => toggle('apps'));
  document.querySelector('#account')?.addEventListener('click', () => toggle('account'));
  document.querySelector('#switch-retry')?.addEventListener('click', () => switchFleet(switchTarget, true));
  document.querySelector('#close')?.addEventListener('click', close);
  document.querySelector('#scrim')?.addEventListener('click', close);
  document.querySelector('#retry')?.addEventListener('click', () => {
    lastState = state; state = 'retrying'; render(); announce('Loading apps and fleets');
    window.setTimeout(() => { state = 'several'; refreshed = true; render(); announce('Apps and fleets refreshed'); }, 1600);
  });
  document.querySelector('#signin')?.addEventListener('click', () => {
    const button = document.querySelector('#signin');
    button.disabled = true; button.innerHTML = `${icon('spinner', 'busy-icon')} Sign in`; announce('Opening sign-in');
    window.setTimeout(() => { fixtureFeedback = `Sign-in opens with a return to ${otherApp()}.`; render(); announce(fixtureFeedback); }, 1600);
  });
  document.querySelector('#signout')?.addEventListener('click', () => { lastState = state; state = 'signing-out'; render(); announce('Signing out'); });
  document.querySelectorAll('.tile[data-name], .choice[data-name]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    if (link.getAttribute('aria-disabled') === 'true') return;
    if (link.getAttribute('aria-current') === 'page') { close(); announce(`${link.dataset.name} is already open`); return; }
    if (link.dataset.kind === 'fleet') { switchFleet(link.dataset.name, false); return; }
    openingName = link.dataset.name; openingKind = link.dataset.kind; lastState = state; state = 'opening';
    render(); announce(`Opening ${openingName}`);
    window.setTimeout(() => {
      if (openingName === 'App 1' || openingName === 'App 2') { state = lastState; fixtureFeedback = `${openingName} selected. This preview ends at the app’s link.`; render(); announce(fixtureFeedback); return; }
      currentApp = openingName; surface = currentApp === 'Gateway' ? 'bridge' : 'console';
      state = 'arrived'; panel = ''; render(); document.querySelector('#launcher')?.focus(); announce(`${currentApp} is open in ${currentFleet}`);
    }, 1800);
  }));
}
/* Opening a fleet: the row and the fleet in the bar show loading, then the bar names the new fleet, or the panel says what failed. */
function switchFleet(name, retry) {
  switchTarget = name; switching = 'busy'; retryingSwitch = retry; render(); announce(`Opening ${name}`);
  (retry ? document.querySelector('#switch-retry') : document.querySelector(`.choice[data-name="${name}"]`))?.focus();
  window.setTimeout(() => {
    if (failNext) { failNext = false; switching = 'failed'; render(); document.querySelector('#switch-retry')?.focus(); announce(`Couldn’t open ${name}. You are still in ${currentFleet}.`); return; }
    switching = ''; currentFleet = name; state = 'arrived'; panel = ''; render(); document.querySelector('#launcher')?.focus(); announce(`${currentApp} is open in ${currentFleet}`);
  }, 1800);
}
function render() { if (era === 'before') renderBefore(); else renderAfter(); }
function toggle(which) {
  panel = panel === which ? '' : which; render();
  announce(panel ? `${{ apps: 'Apps and fleets', account: 'Account' }[panel]} opened` : 'Closed');
  if (panel) document.querySelector('.panel .tile[tabindex="0"], .panel .choice[tabindex="0"], #retry, #signin, #signout, #close')?.focus();
  else document.querySelector(`#${{ apps: 'launcher', account: 'account' }[which]}`)?.focus();
}
function close() {
  const opener = { apps: '#launcher', account: '#account' }[panel] || '#launcher';
  if (switching === 'failed') switching = '';
  panel = ''; render(); document.querySelector(opener)?.focus(); announce('Closed');
}
document.addEventListener('keydown', (event) => {
  if (era === 'before' || !panel) return;
  if (event.key === 'Escape') { close(); return; }
  const tiles = [...document.querySelectorAll('.panel .tile[data-name]:not([aria-disabled="true"])')];
  const at = tiles.indexOf(document.activeElement);
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[event.key];
  if (at >= 0 && step) { event.preventDefault(); moveFocus(tiles, { from: at, to: at + step }); return; }
  const rows = [...document.querySelectorAll('.panel .choice[data-kind="fleet"]:not([aria-disabled="true"])')];
  const row = rows.indexOf(document.activeElement);
  const move = { ArrowDown: row + 1, ArrowUp: row - 1, Home: 0, End: rows.length - 1 }[event.key];
  if (row >= 0 && move !== undefined) { event.preventDefault(); moveFocus(rows, { from: row, to: move }); return; }
  if (event.key === 'Tab' && isPhone()) {
    const items = [...document.querySelectorAll('.panel a:not([aria-disabled="true"]):not([tabindex="-1"]), .panel button:not(:disabled)')];
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }
});
window.addEventListener('resize', render);
render();
