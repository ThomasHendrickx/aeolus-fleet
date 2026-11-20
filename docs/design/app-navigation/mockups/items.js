/* Documentation fixture. No app imports this file, and no request or real sign-in runs. */
/* global document, window, URLSearchParams */
/*
 * Where the account menu's items go once the account panel holds who is signed in and Sign out only.
 * state: account, argo, viewer or single (a single-app self-hosted installation, signed in as argo).
 * era: before (today's account menu, open) or after (the Settings page that now holds them).
 * view (after): settings, shortcuts (the Keyboard shortcuts dialog open) or account (the approved account panel).
 * squadrons=1 turns squadrons on, so the phone tab bar holds its most tabs.
 */
const query = new URLSearchParams(window.location.search);
const state = ['account', 'argo', 'viewer', 'single'].includes(query.get('state')) ? query.get('state') : 'account';
const era = query.get('era') === 'before' ? 'before' : 'after';
let view = query.get('view') || 'settings';
const hasSquadrons = query.get('squadrons') === '1';
let theme = query.get('theme') === 'dark' ? 'dark' : 'light';
let signingInAsArgo = false;
let tourOpen = false;
if (theme === 'dark') document.documentElement.classList.add('dark');

/* Lucide path shapes. */
const paths = {
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9Z"/><path d="m2 15 10 6 10-6M2 12l10 6 10-6"/>',
  ship: '<path d="M12 3v9m-6 0V6h12v6M3 13l9-4 9 4-3 6H6Z"/><path d="M2 21c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/>',
  inbox: '<path d="M4 4h16l2 10v6H2v-6Z"/><path d="M2 14h6l2 3h4l2-3h6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  wheel: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v8m0 4v8M2 12h8m4 0h8"/>',
  shapes: '<path d="M8.3 10a.7.7 0 0 1-.6-1.1l3.7-6a.7.7 0 0 1 1.2 0l3.7 6a.7.7 0 0 1-.6 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
  settings: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.4-6.4 2.1 2.1-6.4Z"/>',
  user: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.7a5 5 0 0 1 10 0"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/>',
  bell: '<path d="M10.3 21a2 2 0 0 0 3.4 0M22 8c0-2.3-.8-4.3-2-6M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 6-2.7 7.3M4 2C2.8 3.7 2 5.7 2 8"/>',
  key: '<path d="M2.6 18.2A2 2 0 0 0 2 19.6V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.2a2 2 0 0 0 1.4-.6l.8-.8a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5"/>',
  logout: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  laptop: '<rect width="18" height="12" x="3" y="4" rx="2"/><path d="M2 20h20"/>',
  arrow: '<path d="M7 7h10v10M7 17 17 7"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  spinner: '<path d="M12 3a9 9 0 1 1-9 9"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const icon = (name, cls = '') => `<svg aria-hidden="true" class="${cls}" viewBox="0 0 24 24">${paths[name]}</svg>`;
const isPhone = () => window.innerWidth < 640;
const announce = (text) => { document.querySelector('#feedback').textContent = text; };

/* What each sign-in has, read from today's source (packages/console/lib/account.tsx, plugin-nav.ts). */
const signedInAs = state === 'viewer' ? 'viewer' : state === 'account' ? 'account' : 'argo';
const has = {
  accountPages: state === 'account', // Account's address comes in the apps list: an account's own sign-in, never self-hosted.
  argoSignIn: state === 'account', // An account allowed as argo in this fleet.
  theme: state !== 'viewer', // 0022: the viewer has no theme switch.
  network: state === 'argo', // fleet:network while the networking plugin is connected.
  manages: state !== 'viewer', // Settings today: a session that manages the fleet, with something to set.
  tour: true, // The installation sets a guide for the session's audience.
  trierarchs: state !== 'single',
};
const name = state === 'account' ? 'Tess Hale' : signedInAs;
const initials = state === 'account' ? 'TH' : state === 'viewer' ? 'V' : 'ar';
const signedInLine = { argo: 'Signed in as argo', account: 'Signed in as your account', viewer: 'Viewer' }[signedInAs];
const barIdentity = { argo: 'Signed in as argo', account: 'Your account', viewer: 'Viewer' }[signedInAs];
const sessionLine = signedInAs === 'account' ? '' : `<p class="session-line">${icon('laptop')}<span>This session: <strong>Device · Mac · Chrome, since 08:02</strong></span></p>`;
const THEME_SCOPE = 'This browser, every Aeolus app';
const themes = [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'monitor']];
const shortcuts = [[['⌘', 'K'], 'Search ships or jump to'], [['⌘', '↵'], 'Send a message']];

/* ---------- Shared page parts. ---------- */
function navItems() {
  return [
    ['Fleet', 'ship', true],
    ['Health', 'activity', true],
    ['Squadrons', 'shapes', hasSquadrons],
    ['Trierarchs', 'wheel', has.trierarchs],
    ['Inbox', 'inbox', true],
    ['Network', 'network', has.network],
    ['Settings', 'settings', era === 'after' || has.manages],
  ].filter(([, , shown]) => shown);
}
/* Phone tabs today: Fleet, Health, Squadrons, Trierarchs, Inbox. After: Settings joins them last. */
function phoneTabs(active) {
  const tabs = [['Fleet', 'ship'], ['Health', 'activity'], ...(hasSquadrons ? [['Squadrons', 'shapes']] : []), ...(has.trierarchs ? [['Trierarchs', 'wheel']] : []), ['Inbox', 'inbox'], ...(era === 'after' ? [['Settings', 'settings']] : [])];
  return `<nav class="tab-bar" aria-label="Console">${tabs.map(([label, shape]) => `<a href="#${label.toLowerCase()}" class="tab" ${label === active ? 'aria-current="page"' : ''}>${icon(shape)}<span>${label}</span></a>`).join('')}</nav>`;
}
function fleetPage() {
  return `<div class="heading"><h1>Fleet</h1><span class="meta">4 ships</span></div><div class="table"><div class="table-head"><span>Ship</span><span>Status</span><span>Report</span><span>Last seen</span></div>${[
    ['orchestrator-1', 'Coordinates the fleet', 'Now'],
    ['builder-console', 'Working on the shared header', '1 min ago'],
    ['reviewer', 'Ready for a review', '2 min ago'],
  ].map(([ship, report, seen]) => `<div class="ship-row"><strong>${ship}</strong><span class="status">Crewed</span><span class="report">${report}</span><span class="seen">${seen}</span></div>`).join('')}</div>`;
}

/* ---------- Before: today's account menu, open, as the console builds it. ---------- */
function menuRow(key, label, shape, extra = '') {
  return `<a class="menu-row" href="#${key}" data-item="${key}">${icon(shape)}<span>${label}</span>${extra}</a>`;
}
function beforeMenu() {
  const phone = isPhone();
  const rows = [];
  if (has.accountPages) rows.push(menuRow('account', 'Your account', 'user'), menuRow('rights', 'Your rights', 'shield'), menuRow('updates', 'Email updates', 'bell'));
  if (has.tour) rows.push(menuRow('tour', 'Take the tour', 'compass'));
  if (has.argoSignIn) rows.push(menuRow('argo', 'Sign in as argo', 'key'));
  if (phone && has.network) rows.push(menuRow('network', 'Network', 'network'));
  if (phone && has.manages) rows.push(menuRow('settings', 'Settings', 'settings'));
  const themeBlock = !has.theme ? '' : phone
    ? `<div class="menu-theme" role="group" aria-label="Theme"><p class="meta">Theme<br>${THEME_SCOPE}</p><div class="segmented">${themes.map(([value, label, shape]) => `<button aria-pressed="${value === theme}">${icon(shape)}${label}</button>`).join('')}</div></div>`
    : `<hr class="separator"><p class="menu-label">Theme<br><span>${THEME_SCOPE}</span></p>${themes.map(([value, label, shape]) => `<a class="menu-row" href="#theme-${value}" role="menuitemradio" aria-checked="${value === theme}">${icon(shape)}<span>${label}</span>${value === theme ? '<span class="dot"></span>' : ''}</a>`).join('')}`;
  const tail = `${phone ? '' : `<hr class="separator">${menuRow('shortcuts', 'Keyboard shortcuts', 'keyboard')}`}${menuRow('help', 'Help', 'help', '<span class="sr-only"> (opens in a new tab)</span>')}${phone ? '' : '<hr class="separator">'}${menuRow('signout', 'Sign out', 'logout')}`;
  return `<div class="scrim"></div><section class="menu ${phone ? 'sheet' : ''}" role="${phone ? 'dialog' : 'menu'}" aria-label="Account"><div class="handle"></div><div class="menu-who"><span class="avatar">${initials}</span><span class="who-words"><strong>${name}</strong><span class="meta">${signedInLine}</span></span></div>${sessionLine}${rows.join('')}${themeBlock}${tail}${phone ? '<button class="btn close">Cancel</button>' : ''}</section>`;
}
function renderBefore() {
  const phone = isPhone();
  const sidebar = `<aside class="sidebar before"><div class="brand">${icon('ship')} Aeolus</div>${navItems().map(([label, shape]) => `<div class="side-row ${label === 'Fleet' ? 'on' : ''}">${icon(shape)}${label}</div>`).join('')}<div class="sidebar-foot"><span class="avatar">${initials}</span><span class="who-words"><strong>${name}</strong><span class="meta">Aeolus</span></span></div></aside>`;
  const header = `<header class="header"><span class="before-trigger">${phone ? 'Fleet' : 'Aeolus'}</span>${phone ? '' : '<span class="crumb">/ Fleet</span>'}${phone ? `<div class="header-right"><span class="avatar">${initials}</span></div>` : ''}</header>`;
  document.querySelector('#root').innerHTML = `${phone ? '' : sidebar}<div class="workspace before">${header}<main class="content">${fleetPage()}</main>${phone ? phoneTabs('Fleet') : ''}</div>${beforeMenu()}`;
}

/* ---------- After: the bar from round 4, and Settings holding what the account menu held. ---------- */
function bar() {
  return `<header class="bar"><button class="launcher" id="launcher" aria-label="Apps and fleets" title="Apps and fleets">${icon('grid')}</button><span class="app-name">${icon('ship')}<span>Console</span></span><span class="fleet-pill"><span class="sr-only">Fleet: </span>${icon('layers')}<span class="fleet-name">Aeolus</span></span><span class="crumb">/ ${tourOpen ? 'Fleet' : 'Settings'}</span><div class="bar-end"><button class="account" id="account" aria-label="Account: ${barIdentity}" aria-expanded="${view === 'account'}">${isPhone() ? '' : `<span class="who"><span class="meta">${barIdentity}</span></span>`}<span class="avatar">${initials}</span></button></div></header>`;
}
function row({ id, label, shape, href, caption = '', end = '', busy = false, external = false }) {
  const tag = href ? 'a' : 'button';
  const attrs = href ? `href="${href}"${external ? ' target="_blank" rel="noreferrer"' : ''}` : `type="button"${busy ? ' disabled' : ''}`;
  return `<${tag} class="setting-row" id="${id}" data-item="${id}" ${attrs}>${busy ? icon('spinner', 'busy-icon') : icon(shape)}<span class="row-words"><span class="row-label">${label}</span>${caption ? `<span class="meta">${caption}</span>` : ''}</span><span class="row-end">${end}</span></${tag}>`;
}
function section(id, title, description, body, { quiet = false } = {}) {
  if (!title) return `<section class="settings-card" aria-label="${id}" data-section="${id}">${body}</section>`;
  return `<section class="settings-card ${quiet ? 'quiet' : ''}" aria-labelledby="${id}-title" data-section="${id}"><div class="card-head"><h2 id="${id}-title">${title}</h2>${description ? `<p class="meta">${description}</p>` : ''}</div>${body}</section>`;
}
function settingsPage() {
  const phone = isPhone();
  const parts = [];
  // Network has a sidebar item on desktop; on phone, where the tab bar has no room, Settings leads to it.
  if (phone && has.network) parts.push(section('Network', '', '', row({ id: 'network', label: 'Network', shape: 'network', href: '#network', end: icon('chevron') })));
  parts.push(section('theme', 'Theme', THEME_SCOPE, has.theme
    ? `<div class="segmented" role="group" aria-label="Theme">${themes.map(([value, label, shape]) => `<button type="button" id="theme-${value}" aria-pressed="${value === theme}">${icon(shape)}${label}</button>`).join('')}</div>`
    : '<p class="meta">A viewer sign-in shows this browser’s theme and has no theme switch.</p>'));
  parts.push(section('help', 'Help', '', [
    phone ? '' : row({ id: 'shortcuts', label: 'Keyboard shortcuts', shape: 'keyboard' }),
    row({ id: 'help', label: 'Help', shape: 'help', href: 'https://github.com/ThomasHendrickx/aeolus-fleet', external: true, caption: 'Opens in a new tab', end: icon('arrow') }),
    has.tour ? row({ id: 'tour', label: 'Take the tour', shape: 'compass' }) : '',
  ].join('')));
  if (has.accountPages || has.argoSignIn) {
    parts.push(section('your-account', 'Your account', has.accountPages ? 'These pages open in Account.' : '', [
      ...(has.accountPages ? [
        row({ id: 'account-page', label: 'Your account', shape: 'user', href: '#account-app', end: icon('arrow') }),
        row({ id: 'rights', label: 'Your rights', shape: 'shield', href: '#account-app-rights', end: icon('arrow') }),
        row({ id: 'updates', label: 'Email updates', shape: 'bell', href: '#account-app-updates', end: icon('arrow') }),
      ] : []),
      ...(has.argoSignIn ? [row({ id: 'sign-in-as-argo', label: signingInAsArgo ? 'Signing in as argo' : 'Sign in as argo', shape: 'key', busy: signingInAsArgo })] : []),
    ].join('')));
  }
  // The sections Settings holds today, unchanged, after the personal ones.
  if (state === 'single') parts.push(section('own-sign-in', 'Your sign-in', 'argo’s email and password for this console.', '<p class="meta">operator@example.com</p>', { quiet: true }));
  if (has.manages && has.trierarchs) parts.push(section('trierarch', 'Trierarch plugin', 'Connected.', '', { quiet: true }));
  const description = has.manages ? 'How this console looks for you, and how this installation runs.' : 'How this console looks for you.';
  return `<div class="heading"><h1>Settings</h1></div><p class="meta page-description">${description}</p>${parts.join('')}`;
}
function shortcutsDialog() {
  return `<div class="scrim dialog-scrim" id="dialog-scrim"></div><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-head"><h2 id="dialog-title">Keyboard shortcuts</h2><button class="icon-btn" id="dialog-close" aria-label="Close">${icon('close')}</button></div><p class="meta">What the keys do here.</p><ul class="shortcut-list">${shortcuts.map(([keys, label]) => `<li><span>${label}</span><span>${keys.map((key) => `<span class="kbd">${key}</span>`).join('')}</span></li>`).join('')}</ul></section>`;
}
function accountPanel() {
  const how = signedInAs === 'argo' ? 'Signed in as argo, for Console in Aeolus' : signedInAs === 'viewer' ? 'Viewer sign-in, for Console in Aeolus' : 'Signed in with your account';
  return `<div class="scrim" id="scrim"></div><section class="panel account-panel" role="dialog" aria-labelledby="panel-title"><div class="handle"></div><div class="who-head"><span class="avatar large">${initials}</span><span class="who-words"><strong id="panel-title">${signedInAs === 'account' ? 'Your account' : signedInAs === 'viewer' ? 'Viewer' : 'argo'}</strong><span class="meta">${how}</span></span></div><hr class="separator"><button class="choice" id="signout">${icon('logout')}<span>Sign out</span></button><button class="btn close" id="close">Cancel</button></section>`;
}
function tourStep() {
  return `<section class="tour" role="dialog" aria-labelledby="tour-title"><p class="meta">1 of 3</p><h2 id="tour-title">Your fleet</h2><p class="meta">Every ship, what it does and who crews it.</p><div class="tour-actions"><button class="btn ghost">Skip</button><button class="btn primary" id="tour-next">Next</button></div></section>`;
}
function renderAfter() {
  const phone = isPhone();
  const sidebar = `<aside class="sidebar">${navItems().map(([label, shape]) => `<div class="side-row ${label === (tourOpen ? 'Fleet' : 'Settings') ? 'on' : ''}">${icon(shape)}${label}</div>`).join('')}</aside>`;
  const overlay = view === 'shortcuts' && !phone ? shortcutsDialog() : view === 'account' ? accountPanel() : '';
  document.querySelector('#root').innerHTML = `${bar()}${phone ? '' : sidebar}<div class="workspace"><main class="content settings">${tourOpen ? fleetPage() : settingsPage()}</main>${phone ? phoneTabs(tourOpen ? 'Fleet' : 'Settings') : ''}</div>${overlay}${tourOpen ? tourStep() : ''}`;
  wire();
}

/* ---------- Choices: each shows its result at once, or its loading while it works. ---------- */
function wire() {
  for (const [value] of themes) {
    document.querySelector(`#theme-${value}`)?.addEventListener('click', () => {
      theme = value;
      document.documentElement.classList.toggle('dark', value === 'dark');
      render(); document.querySelector(`#theme-${value}`)?.focus(); announce(`Theme: ${value[0].toUpperCase()}${value.slice(1)}`);
    });
  }
  document.querySelector('#shortcuts')?.addEventListener('click', () => { view = 'shortcuts'; render(); document.querySelector('#dialog-close')?.focus(); announce('Keyboard shortcuts opened'); });
  document.querySelector('#dialog-close')?.addEventListener('click', closeDialog);
  document.querySelector('#dialog-scrim')?.addEventListener('click', closeDialog);
  document.querySelector('#tour')?.addEventListener('click', () => { tourOpen = true; render(); document.querySelector('#tour-next')?.focus(); announce('Tour, step 1 of 3'); });
  document.querySelector('#sign-in-as-argo')?.addEventListener('click', () => { signingInAsArgo = true; render(); document.querySelector('#sign-in-as-argo')?.focus(); announce('Signing in as argo'); });
  document.querySelector('#account')?.addEventListener('click', () => { view = view === 'account' ? 'settings' : 'account'; render(); });
  document.querySelector('#close')?.addEventListener('click', () => { view = 'settings'; render(); document.querySelector('#account')?.focus(); });
  document.querySelector('#scrim')?.addEventListener('click', () => { view = 'settings'; render(); });
}
function closeDialog() { view = 'settings'; render(); document.querySelector('#shortcuts')?.focus(); announce('Closed'); }
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (view === 'shortcuts') closeDialog();
  else if (view === 'account') { view = 'settings'; render(); document.querySelector('#account')?.focus(); }
});
function render() { if (era === 'before') renderBefore(); else renderAfter(); }
window.addEventListener('resize', render);
render();
