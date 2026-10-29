/**
 * Static, recognizable page skeletons for the hero screens (LANDING §5): theme
 * colors only, no text and no shimmer. The frame renders all three on the server and
 * CSS shows the one for `html[data-device]` (the foldable by width); the fold
 * animation draws them on the page inside `.fs-root`.
 */
import type { SkeletonKind } from '@/lib/devices';

const MENU = [14, 30, 26, 30, 34, 28, 30] as const;
const NAV = [52, 64, 44, 58] as const;
const SIDEBAR = [72, 58, 84, 64, 50, 76, 60] as const;
const CARDS = [0, 1, 2, 3, 4, 5] as const;
const ROWS = [
  [62, 84],
  [48, 70],
  [70, 56],
  [54, 78],
  [66, 62],
  [44, 74],
  [58, 66],
] as const;
const TABS = [0, 1, 2, 3] as const;
const TABLET_ROWS = [64, 52, 74, 58, 68, 46, 60, 54] as const;

export function DesktopSkeleton() {
  return (
    <div className="fs-desktop">
      {/* The system menu bar: the laptop's Dynamic Island floats in its middle. */}
      <div className="fs-menubar">
        <span className="fs-menu">
          {MENU.map((width, index) => (
            <span key={index} className="fs-menu-item" style={{ width }} />
          ))}
        </span>
        <span className="fs-menu">
          <span className="fs-menu-item" style={{ width: 16 }} />
          <span className="fs-menu-item" style={{ width: 16 }} />
          <span className="fs-menu-item" style={{ width: 22 }} />
          <span className="fs-menu-item" style={{ width: 64 }} />
        </span>
      </div>
      <header className="fs-topbar">
        <span className="fs-logo" />
        <nav className="fs-nav">
          {NAV.map((width, index) => (
            <span key={index} className="fs-bar" style={{ width }} />
          ))}
        </nav>
        <span className="fs-search" />
        <span className="fs-avatar" />
      </header>
      <aside className="fs-sidebar">
        {SIDEBAR.map((width, index) => (
          <span key={index} className="fs-side-row" data-active={index === 1 ? '' : undefined}>
            <span className="fs-icon" />
            <span className="fs-bar" style={{ width }} />
          </span>
        ))}
      </aside>
      <main className="fs-main">
        <span className="fs-title" />
        <span className="fs-bar fs-subtitle" />
        <div className="fs-grid">
          {CARDS.map((index) => (
            <article key={index} className="fs-card">
              <span className="fs-card-media" data-tint={index % 3} />
              <span className="fs-bar" style={{ width: '72%' }} />
              <span className="fs-bar fs-faint" style={{ width: '48%' }} />
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

export function MobileSkeleton() {
  return (
    <div className="fs-mobile">
      <div className="fs-status">
        <span className="fs-time" />
        <span className="fs-status-icons">
          <span className="fs-signal" />
          <span className="fs-battery" />
        </span>
      </div>
      <span className="fs-large-title" />
      <span className="fs-field" />
      <ul className="fs-list">
        {ROWS.map(([title, detail], index) => (
          <li key={index} className="fs-row">
            <span className="fs-row-avatar" data-tint={index % 4} />
            <span className="fs-row-text">
              <span className="fs-bar" style={{ width: `${title}%` }} />
              <span className="fs-bar fs-faint" style={{ width: `${detail}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <nav className="fs-tabbar">
        {TABS.map((index) => (
          <span key={index} className="fs-tab" data-active={index === 0 ? '' : undefined}>
            <span className="fs-tab-icon" />
            <span className="fs-tab-label" />
          </span>
        ))}
      </nav>
      <span className="fs-home-indicator" />
    </div>
  );
}

export function TabletSkeleton() {
  return (
    <div className="fs-tablet">
      <div className="fs-tablet-status">
        <span>
          <span className="fs-menu-item" style={{ width: 34 }} />
          <span className="fs-menu-item" style={{ width: 54 }} />
        </span>
        <span>
          <span className="fs-menu-item" style={{ width: 16 }} />
          <span className="fs-menu-item" style={{ width: 24 }} />
        </span>
      </div>
      <aside className="fs-tablet-sidebar">
        <span className="fs-large-title" />
        {TABLET_ROWS.map((width, index) => (
          <span key={index} className="fs-side-row" data-active={index === 0 ? '' : undefined}>
            <span className="fs-icon" />
            <span className="fs-bar" style={{ width }} />
          </span>
        ))}
      </aside>
      <main className="fs-tablet-main">
        <span className="fs-title" />
        <span className="fs-bar fs-subtitle" />
        <div className="fs-grid">
          {CARDS.map((index) => (
            <article key={index} className="fs-card">
              <span className="fs-card-media" data-tint={index % 3} />
              <span className="fs-bar" style={{ width: '72%' }} />
              <span className="fs-bar fs-faint" style={{ width: '48%' }} />
            </article>
          ))}
        </div>
      </main>
      <span className="fs-home-indicator" />
    </div>
  );
}

const SKELETONS = { desktop: DesktopSkeleton, mobile: MobileSkeleton, tablet: TabletSkeleton } as const;

/** One skeleton with its own tokens, for static screens drawn on the page. */
export function ScreenSkeleton({ kind }: { kind: SkeletonKind }) {
  const Skeleton = SKELETONS[kind];
  return (
    <div className="fs-root" aria-hidden="true">
      <Skeleton />
    </div>
  );
}
