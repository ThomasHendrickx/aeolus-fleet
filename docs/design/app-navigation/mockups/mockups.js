/* Documentation fixture. No app imports this file, and no request or real sign-in runs. */
/* global document, window, URLSearchParams */
const query = new URLSearchParams(window.location.search);
let surface = query.get('surface') === 'bridge' ? 'bridge' : 'console';
const era = query.get('era') === 'before' ? 'before' : 'after';
let state = query.get('state') || 'several';
let opened = !['closed', 'arrived', 'detail'].includes(state);
let currentApp = surface === 'bridge' ? 'Gateway' : 'Console';
let currentFleet = state === 'long-name' ? 'Aeolus research and development' : 'Aeolus';
let openingName = '';
let openingKind = '';
let lastState = '';
let retrying = false;
let fixtureFeedback = '';
if (query.get('theme') === 'dark') document.documentElement.classList.add('dark');

const paths = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
  arrow: '<path d="M7 7h10v10M7 17 17 7"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9Z"/><path d="m2 15 10 6 10-6M2 12l10 6 10-6"/>',
  ship: '<path d="M12 3v9m-6 0V6h12v6M3 13l9-4 9 4-3 6H6Z"/><path d="M2 21c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/>',
  inbox: '<path d="M4 4h16l2 10v6H2v-6Z"/><path d="M2 14h6l2 3h4l2-3h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v4m0 4h.01"/>',
  spinner: '<path d="M12 3a9 9 0 1 1-9 9"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-3Z"/>',
};
const icon = (name, cls = '') => `<svg aria-hidden="true" class="${cls}" viewBox="0 0 24 24">${paths[name]}</svg>`;
const isRestricted = () => ['argo', 'viewer', 'single'].includes(state);
const bridgeGate = () => surface === 'bridge' && isRestricted();
const isBeforePlain = () => era === 'before' && (isRestricted() || ['missing', 'expired', 'loading', 'error'].includes(state));
const otherApp = () => currentApp === 'Console' ? 'Gateway' : 'Console';
const announce = (text) => { document.querySelector('#feedback').textContent = text; };

function trigger() {
  if (isBeforePlain()) return `<span class="before-trigger">${surface === 'console' ? currentFleet : 'Gateway'}</span>`;
  if (era === 'before') {
    if (window.innerWidth < 640) return `<button class="before-trigger" id="switcher">${surface === 'console' ? 'Fleet' : 'Gateway'} ${icon('chevron')}</button>`;
    return surface === 'console'
      ? `<button class="before-trigger before-fleet" id="switcher">${currentFleet}</button><span class="crumb">/ Fleet</span>`
      : `<button class="before-trigger" id="switcher">${currentFleet}</button><span class="muted">/</span><button class="before-trigger" id="old-app">Gateway ${icon('chevron')}</button>`;
  }
  return `<button class="trigger" id="switcher" aria-label="Apps and fleets: ${currentApp}, ${currentFleet}" aria-expanded="${opened}" aria-controls="destinations"><span>${currentApp} <span class="slash muted">/</span> <span class="fleet-label">${currentFleet}</span></span>${icon('chevron')}</button>`;
}

function shellContent() {
  if (bridgeGate()) {
    if (era === 'before') return '<h1>Bridge</h1><p class="meta">Sign in with an account to continue.</p>';
    const reason = state === 'argo' ? 'Signing in as argo is available only in Console.' : state === 'viewer' ? 'A viewer sign-in is for Console. Bridge requires an account.' : 'Only Console is configured in this installation. Bridge is not installed.';
    return `<div class="heading"><h1>Bridge</h1></div><div class="notice"><strong>${state === 'single' ? 'Bridge is not available' : 'Sign in with an account to use Bridge'}</strong><p>${reason}</p><p>No account is signed in here.</p></div>`;
  }
  if (state === 'arrived') return `<div class="arrival" role="status">${icon('check')} ${currentApp} is open in ${currentFleet}.</div><h1>${surface === 'bridge' ? 'Bridge' : 'Fleet'}</h1><p class="meta">The destination header confirms the app and fleet.</p>`;
  if (state === 'detail') return `<p class="meta">Fleet / builder-console</p><h1>builder-console</h1><div class="notice"><strong>Working on the shared header</strong><p>The same Apps and fleets control stays available on a detail page.</p></div>`;
  if (surface === 'bridge') return `<div class="heading"><h1>Waiting on you</h1><span class="badge">3</span></div><p class="meta">Aeolus · Your account</p>${[
    ['Which task goes first?', 'Decide · orchestrator-1 · 12 min ago'],
    ['Open the draft design', 'Do · builder-console · 24 min ago'],
    ['Review the fleet’s requests', 'Decide · orchestrator-1 · 1 h ago'],
  ].map(([title, meta]) => `<div class="bridge-card">${icon('inbox')}<div class="copy"><strong>${title}</strong><p class="meta">${meta}</p></div></div>`).join('')}`;
  return `<div class="heading"><h1>Fleet</h1><span class="meta">4 ships</span></div><p class="meta">${currentFleet} · ${state === 'argo' ? 'Signed in as argo' : state === 'viewer' ? 'Viewer' : state === 'single' ? 'Self-hosted' : 'Signed in as your account'}</p><div class="toolbar"><span class="filter">${icon('search')} Search ships</span><span class="filter">Status: All</span><span class="filter">Type: All</span></div><div class="table"><div class="table-head"><span>Ship</span><span>Status</span><span>Report</span><span>Last seen</span></div>${[
    ['orchestrator-1', 'Crewed', 'Coordinates the fleet', 'Now'],
    ['builder-console', 'Crewed', 'Working on the shared header', '1 min ago'],
    ['reviewer', 'Crewed', 'Ready for a review', '2 min ago'],
    ['builder-core', 'Awaiting crew', 'Get the starting prompt', ''],
  ].map(([name, status, report, seen]) => `<div class="ship-row"><strong>${name}</strong><span class="status ${status === 'Awaiting crew' ? 'waiting' : ''}">${icon(status === 'Crewed' ? 'check' : 'clock')}${status}</span><span class="report">${report}</span><span class="seen">${seen}</span></div>`).join('')}</div>`;
}

function choice(name, kind) {
  const current = kind === 'fleet' ? name === currentFleet : name === currentApp;
  const busy = state === 'opening' && name === openingName;
  const disabled = state === 'opening' && !busy;
  return `<a class="choice ${current ? 'current' : ''}" href="#${kind}-${name.toLowerCase().replaceAll(' ', '-')}" data-name="${name}" data-kind="${kind}" ${current ? 'aria-current="page"' : ''} ${disabled ? 'aria-disabled="true"' : ''}>${icon(kind === 'fleet' ? 'layers' : 'arrow')}<span>${busy ? `Opening ${name}` : name}</span><span class="end">${busy ? icon('spinner', 'busy-icon') : current ? `${icon('check')}<span class="sr-only">Current</span>` : ''}</span></a>`;
}

function panelContent() {
  if (era === 'before') {
    const appOnly = surface === 'bridge' && window.innerWidth >= 640;
    return `<h2 class="sr-only" id="panel-title">Apps and fleets</h2>${appOnly ? '' : `<div class="group-label">Fleets</div>${choice(currentFleet, 'fleet')}${choice('Harbour', 'fleet')}<hr class="separator">`}<div class="group-label">Apps</div>${choice(currentApp, 'app')}${choice(otherApp(), 'app')}${choice('App 1', 'app')}${choice('App 2', 'app')}`;
  }
  const top = `<div class="panel-title"><h2 id="panel-title">Apps and fleets</h2></div><p class="context">${bridgeGate() ? 'Bridge destination' : `${currentApp} · ${currentFleet}`}</p>`;
  if (['loading', 'retrying'].includes(state)) return `${top}<div class="group-label">Apps</div><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton short"></span><hr class="separator"><div class="group-label">Fleets</div><span class="skeleton"></span><p class="context" role="status">Loading apps and fleets…</p>${state === 'retrying' ? `<button class="btn" disabled>${icon('spinner', 'busy-icon')} Try again</button>` : ''}`;
  if (isRestricted()) {
    let title, text;
    if (state === 'single') { title = 'No other apps'; text = 'Only Console is configured in this installation. There are no other apps or fleets to open.'; }
    if (state === 'argo') { title = bridgeGate() ? 'Console sign-in: argo' : 'Signed in as argo'; text = 'This sign-in is for Console in Aeolus. Other apps and fleets require an account sign-in. Bridge does not accept an argo sign-in.'; }
    if (state === 'viewer') { title = bridgeGate() ? 'Console viewer sign-in' : 'Viewer'; text = 'This viewer sign-in is for Console in Aeolus. Other apps and fleets are not supplied for this session. Bridge requires an account.'; }
    return `${top}<div class="group-label">Apps</div>${bridgeGate() ? `<div class="unavailable">${icon('arrow')} Console <span class="meta">Configured app</span></div>` : choice('Console', 'app')}<hr class="separator"><div class="group-label">Fleets</div>${bridgeGate() ? `<div class="unavailable">${icon('layers')} Aeolus</div>` : choice('Aeolus', 'fleet')}<div class="notice"><strong>${title}</strong><p>${text}</p><p>${bridgeGate() ? 'No account destinations are available here. No identity has changed.' : 'You can keep using this Console session.'}</p></div>`;
  }
  if (state === 'error') return `${top}<div class="notice error" role="alert"><strong>${icon('alert')} Couldn’t load destinations</strong><p>Your current page is still open. Try again to load apps and fleets.</p><button class="btn" id="retry">Try again</button></div>`;
  if (state === 'expired') return `${top}${fixtureFeedback ? `<div class="notice" role="status">${fixtureFeedback}</div>` : ''}<div class="notice error" role="alert"><strong>${icon('alert')} Your sign-in has expired</strong><p>Sign in again to open ${otherApp()}. The current page remains visible, but does not prove you still have access.</p><button class="btn primary" id="signin">Sign in</button></div><div class="group-label">Apps</div><div class="unavailable">${icon('arrow')}${otherApp()}<span class="meta">Sign-in required</span></div>`;
  let apps = choice(currentApp, 'app');
  if (state === 'missing') apps += `<div class="unavailable">${icon('arrow')}${otherApp()}<span class="meta">Unavailable</span></div>`;
  else apps += choice(otherApp(), 'app');
  apps += choice('App 1', 'app') + choice('App 2', 'app');
  return `${top}${fixtureFeedback ? `<div class="notice" role="status">${fixtureFeedback}</div>` : ''}<div class="group-label">Apps</div>${apps}${state === 'missing' ? `<div class="notice error" role="alert"><strong>${icon('alert')} Couldn’t open ${otherApp()}</strong><p>This destination is no longer available. You are still in ${currentApp}. Try again to refresh destinations.</p><button class="btn" id="retry">Try again</button></div>` : ''}<hr class="separator"><div class="group-label">Fleets</div>${choice(currentFleet, 'fleet')}${choice('Harbour', 'fleet')}<p class="context">${state === 'opening' ? `Opening ${openingName}…` : retrying ? 'Apps and fleets refreshed.' : 'Choosing a fleet opens an app available there.'}</p>`;
}

function render() {
  const plain = isBeforePlain();
  const panelVisible = opened && !plain;
  const identity = surface === 'console' && ['argo', 'single'].includes(state) ? 'Signed in as argo' : surface === 'console' && state === 'viewer' ? 'Viewer' : bridgeGate() ? 'Not signed in' : state === 'expired' ? 'Sign-in expired' : 'Your account';
  document.querySelector('#root').innerHTML = `${surface === 'console' ? `<aside class="sidebar"><div class="brand">${icon('ship')} Aeolus</div>${['Fleet', 'Inbox', 'Trierarchs', 'Settings'].map((label, i) => `<div class="side-row ${i === 0 ? 'on' : ''}">${icon(['ship', 'inbox', 'layers', 'settings'][i])}${label}</div>`).join('')}<div class="sidebar-bottom"><div class="meta">${identity}</div></div></aside>` : ''}<div class="workspace ${surface}"><header class="header">${trigger()}${surface === 'bridge' ? '<div class="tabs"><span class="on">Bridge</span><span>Outside parties</span></div>' : era === 'after' ? '<span class="crumb">/ Fleet</span>' : ''}<div class="header-right"><span class="meta">${identity}</span><span class="avatar" aria-label="${identity}">${bridgeGate() ? '?' : state === 'argo' ? 'ar' : state === 'viewer' ? 'V' : 'TH'}</span></div></header><main class="content">${shellContent()}</main><div class="phone-tabs"><span class="on">${icon(surface === 'bridge' ? 'inbox' : 'ship')}${surface === 'bridge' ? 'Waiting' : 'Fleet'}</span><span>${icon('inbox')}${surface === 'bridge' ? 'Aware' : 'Inbox'}</span><span>${icon('layers')}${surface === 'bridge' ? 'Done' : 'Trierarchs'}</span><span>${icon('settings')}${surface === 'bridge' ? 'Fleet' : 'Settings'}</span></div>${panelVisible ? `<div class="scrim" id="scrim"></div><section class="panel" id="destinations" role="dialog" aria-labelledby="panel-title" ${window.innerWidth < 640 ? 'aria-modal="true"' : ''}><div class="handle"></div>${panelContent()}<button class="btn close" id="close">Cancel</button></section>` : ''}</div>`;
  document.querySelector('#switcher')?.addEventListener('click', toggle);
  document.querySelector('#old-app')?.addEventListener('click', toggle);
  document.querySelector('#close')?.addEventListener('click', close);
  document.querySelector('#scrim')?.addEventListener('click', close);
  document.querySelector('#retry')?.addEventListener('click', () => {
    lastState = state; state = 'retrying'; render(); announce('Loading apps and fleets');
    window.setTimeout(() => { state = 'several'; retrying = true; render(); announce('Apps and fleets refreshed'); }, 1600);
  });
  document.querySelector('#signin')?.addEventListener('click', () => {
    const button = document.querySelector('#signin');
    button.disabled = true; button.innerHTML = `${icon('spinner', 'busy-icon')} Sign in`; announce('Opening sign-in');
    window.setTimeout(() => { fixtureFeedback = `Sign-in opens with a return to ${otherApp()}.`; render(); announce(fixtureFeedback); }, 1600);
  });
  document.querySelectorAll('.choice').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    if (link.getAttribute('aria-disabled') === 'true') return;
    if (link.getAttribute('aria-current') === 'page') { close(); announce(`${link.dataset.name} is already open`); return; }
    openingName = link.dataset.name; openingKind = link.dataset.kind; lastState = state; state = 'opening';
    render(); announce(`Opening ${openingName}`);
    window.setTimeout(() => {
      if (openingName === 'App 1' || openingName === 'App 2') { state = lastState; fixtureFeedback = `${openingName} selected. This preview ends at the destination link.`; render(); announce(fixtureFeedback); return; }
      if (openingKind === 'fleet') currentFleet = openingName;
      else { currentApp = openingName; surface = currentApp === 'Gateway' ? 'bridge' : 'console'; }
      state = 'arrived'; opened = false; render(); announce(`${currentApp} is open in ${currentFleet}`);
    }, 1800);
  }));
}
function toggle() { opened = !opened; render(); announce(opened ? 'Apps and fleets opened' : 'Apps and fleets closed'); if (opened) document.querySelector('.choice, #retry, #signin, #close')?.focus(); }
function close() { opened = false; render(); document.querySelector('#switcher')?.focus(); announce('Apps and fleets closed'); }
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && opened) close();
  if (event.key === 'Tab' && opened && window.innerWidth < 640) {
    const items = [...document.querySelectorAll('.panel a:not([aria-disabled="true"]), .panel button:not(:disabled)')];
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }
});
window.addEventListener('resize', render);
render();
