/**
 * The marketing site around the tours: its header, its fleet scene (the
 * site's moving fleet of marks and name tags), its footer, and the product
 * tour layout with the narrative beside the product. Look only: the site's
 * own repository builds it.
 */
import { ArrowLeft, ArrowRight, Menu, Moon, RotateCcw } from 'lucide-react';

const NAV = ['Quick start', 'What it does', 'How it works', 'Self-host', 'Trust', 'Open source'];

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[18px]" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.7 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export function SiteHeader({ current }) {
  return (
    <header className="site-header">
      <a href="#" className="site-wordmark" aria-label="Aeolus home">
        <img src="brand/aeolus-wordmark-slate.svg" alt="Aeolus" />
      </a>
      <nav className="site-nav" aria-label="Site">
        {NAV.map((item) => (
          <a key={item} href="#" aria-current={current === item ? 'page' : undefined}>
            {item}
          </a>
        ))}
      </nav>
      <div className="site-header-actions">
        <a href="#" className="site-circle" aria-label="Source on GitHub">
          <GitHubIcon />
        </a>
        <button type="button" className="site-circle" aria-label="Dark mode">
          <Moon aria-hidden className="size-[18px]" />
        </button>
        <a href="#" className="btn primary small">
          Try it
        </a>
        <button type="button" className="site-circle site-menu" aria-label="Menu">
          <Menu aria-hidden className="size-[18px]" />
        </button>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div>
          <img src="brand/aeolus-mark-slate.svg" alt="" className="size-9" />
          <p>Open source, Apache-2.0. Agents, apps and people in one fleet.</p>
        </div>
        {[
          ['Use it', ['Quick start', 'Product tours', 'What it does', 'How it works', 'Self-host']],
          ['Open source', ['Source', 'Releases', 'Discussions', 'Report an issue']],
          ['Trust', ['What ships today', 'EU hosting', 'No lock-in']],
        ].map(([head, links]) => (
          <div key={head}>
            <h4>{head}</h4>
            {links.map((link) => (
              <a key={link} href="#">
                {link}
              </a>
            ))}
          </div>
        ))}
      </div>
      <p className="site-footer-bottom">
        <span>Cookieless analytics. Hosted in the EU.</span>
        <span>Aeolus for your business: aeolus-fleet.com →</span>
      </p>
    </footer>
  );
}

const MARK_SAIL = (
  <>
    <path d="M30 6 L15.5 48" stroke="currentColor" strokeWidth="7" strokeLinecap="round" fill="none" />
    <path d="M34.5 5 C44 17 50.5 31 52.5 48 H34.5 Z" fill="currentColor" />
  </>
);
const MARK_HULL = (
    <path d="M7 53.5 H57 L52.4 59.2 C47.5 59.2 46.6 60.9 42.2 60.9 C37.8 60.9 36.6 59.2 32 59.2 C27.4 59.2 26.2 60.9 21.8 60.9 C17.4 60.9 16.5 59.2 11.6 59.2 Z" fill="currentColor" />
);

/**
 * The site's fleet scene for one tour: each ship the mark with a mono name tag,
 * bobbing on the swell. A hand-off travels as a sea-blue light along an arc and
 * lights the tag it reaches; a question waiting on a person gets the amber ring.
 */
export function FleetScene({ ships, hop, ring, id }) {
  const width = 560;
  const step = width / ships.length;
  const xOf = (index) => step * index + step / 2;
  const tagWidth = (name) => Math.max(76, name.length * 8.6 + 26);
  const path = hop ? `M ${xOf(hop[0])} 64 Q ${(xOf(hop[0]) + xOf(hop[1])) / 2} 4 ${xOf(hop[1])} 64` : null;
  return (
    <svg viewBox={`0 0 ${width} 160`} className="fleet play" role="img" aria-label={`Fleet: ${ships.map((ship) => ship.name).join(', ')}`}>
      <defs>
        <mask id={`wind-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d="M0 34 C14 29 26 38 64 30" stroke="#000" strokeWidth="5" fill="none" />
        </mask>
      </defs>
      <path className="swell" d={`M0 142 C 80 134 160 150 280 142 S 480 134 ${width} 142`} />
      <path className="swell faint" d={`M0 154 C 90 148 190 160 300 153 S 470 147 ${width} 154`} />
      {path ? (
        <>
          <path className="hop-path" d={path} />
          <circle r="13" className="halo" style={{ offsetPath: `path('${path}')` }} />
          <circle r="5" className="light" style={{ offsetPath: `path('${path}')` }} />
        </>
      ) : null}
      {ships.map((ship, index) => {
        const tag = tagWidth(ship.name);
        const isLit = hop && hop[1] === index;
        return (
          <g key={ship.name} transform={`translate(${xOf(index)} 0)`}>
            <g className="bob" style={{ '--b': `${index * -1.3}s` }}>
              <g className="tag" data-lit={isLit ? 'true' : undefined} data-kind={ship.kind}>
                <rect className="tagbox" x={-tag / 2} y="50" width={tag} height="28" rx="14" />
                <text className="tagname" x="0" y="69" textAnchor="middle">
                  {ship.name}
                </text>
                {ring === index ? <rect className="ring wait" x={-tag / 2 - 5} y="45" width={tag + 10} height="38" rx="19" /> : null}
              </g>
              <g className="hull" transform="translate(-22 88) scale(0.69)">
                <g mask={`url(#wind-${id})`}>{MARK_SAIL}</g>
                {MARK_HULL}
              </g>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function Progress({ at, count }) {
  return (
    <div className="tour-progress" aria-label={`Step ${at} of ${count}`}>
      <span className="font-mono">
        Step {at} of {count}
      </span>
      <span className="tour-dots">
        {Array.from({ length: count }, (_, index) => (
          <span key={index} data-state={index + 1 < at ? 'past' : index + 1 === at ? 'current' : 'next'} />
        ))}
      </span>
    </div>
  );
}

export function MotionStrip({ frames }) {
  return (
    <section className="motion" aria-label="What moves on this step">
      <h3 className="motion-title">What moves</h3>
      <ol className="motion-frames">
        {frames.map((frame) => (
          <li key={frame.t} className="motion-frame">
            <span className="motion-time font-mono">{frame.t}</span>
            <div className="motion-part">{frame.part}</div>
            <p>{frame.caption}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * One tour step on the site: the tour's head with its fleet scene, then the
 * narrative beside the product window (stacked on phone), the step's motion
 * frames and the controls.
 */
export function TourStep({ tour, step, at, count, nav }) {
  return (
    <>
      <SiteHeader current="Product tours" />
      <section className="tour-head">
        <div className="tour-head-text">
          <p className="eyebrow">Product tour · {tour.persona}</p>
          <h1>{tour.title}</h1>
          <p className="lede">{tour.lede}</p>
        </div>
        <div className="sea-panel" data-scene={tour.slug}>
          <FleetScene id={step.id} ships={tour.ships} hop={step.scene?.hop} ring={step.scene?.ring} />
          <p className="sea-log font-mono">{step.scene?.log ?? ' '}</p>
        </div>
      </section>
      <section className="tour-body">
        <aside className="tour-narrative">
          <Progress at={at} count={count} />
          {step.alternate ? <p className="tour-branch font-mono">Your other answer · replaces step {at}</p> : null}
          <h2>{step.title}</h2>
          <p className="tour-text">{step.narrative}</p>
          {step.spotNote ? (
            <p className="tour-spot">
              <span className="tour-marker" aria-hidden>
                1
              </span>
              <span>{step.spotNote}</span>
            </p>
          ) : null}
          {step.choices ? (
            <div className="tour-choices">
              {step.choices.map(([label, href]) => (
                <a key={label} href={href} className="btn line">
                  {label}
                </a>
              ))}
            </div>
          ) : null}
          {step.frames ? <MotionStrip frames={step.frames} /> : null}
          <nav className="tour-controls" aria-label="Tour steps">
            <a href={nav.back} className="btn line small">
              <ArrowLeft aria-hidden className="size-4" /> Back
            </a>
            <a href={nav.next} className="btn primary small">
              Next <ArrowRight aria-hidden className="size-4" />
            </a>
            <a href={nav.restart} className="tlink">
              <RotateCcw aria-hidden className="size-3.5" /> Restart
            </a>
          </nav>
          <p className="tour-note font-mono">Simulated. Nothing is sent or stored.</p>
        </aside>
        <div className="tour-stage">
          <div className="window" data-surface={step.surface}>
            <div className="window-bar">
              <span className="window-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="window-url font-mono">{step.url}</span>
              <span className="window-badge">Product tour</span>
            </div>
            <div className={`window-body product spot-${step.id}`}>{step.screen}</div>
          </div>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}

/** A tour card on the site: a live crop of the tour's own screen, its persona, what it shows and its link. */
export function TourCard({ tour, href, isWide = false }) {
  return (
    <article className={`tour-card ${isWide ? 'wide' : ''}`}>
      <span className="tour-thumb" aria-hidden>
        <span className="tour-thumb-inner product">{tour.thumb}</span>
      </span>
      <span className="eyebrow">
        {tour.persona} · {tour.minutes}
      </span>
      <span className="tour-card-title">{tour.cardTitle}</span>
      <span className="tour-card-text">{tour.cardText}</span>
      <a href={href} className="tlink tour-card-link">
        Take the tour →
      </a>
    </article>
  );
}

export function SitePage({ current, children }) {
  return (
    <>
      <SiteHeader current={current} />
      <main className="site-main">{children}</main>
      <SiteFooter />
    </>
  );
}
