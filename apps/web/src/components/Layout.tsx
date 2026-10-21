import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { cx } from './ui';

export const DISCLAIMER = 'NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden focusable="false">
      <polygon points="16,2 30,9 16,16 2,9" fill="#5fb83f" />
      <polygon points="2,9 16,16 16,30 2,23" fill="#8b5a3c" />
      <polygon points="16,16 30,9 30,23 16,30" fill="#5e3b26" />
      <polygon points="2,9 16,16 16,19 2,12" fill="#3d7f27" />
      <polygon points="16,16 30,9 30,12 16,19" fill="#2f6420" />
      <rect x="21" y="3" width="2" height="2" fill="#f2c14e" />
      <rect x="9" y="7" width="2" height="2" fill="#7cd157" />
      <rect x="15" y="10" width="2" height="2" fill="#7cd157" />
    </svg>
  );
}

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/tools', label: 'Tools', end: false },
  { to: '/about', label: 'About', end: false },
];

function Header() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const link = ({ isActive }: { isActive: boolean }) =>
    cx('font-pixel block px-3 py-2 text-lg text-ink no-underline hover:bg-panel-2 hover:no-underline', isActive && 'bg-panel-2 text-gold');
  return (
    <header className="border-b-2 border-shadow bg-panel">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2">
        <Link to="/" className="flex items-center gap-2 text-ink no-underline hover:no-underline" aria-label="Blockwright home">
          <Logo />
          <span className="font-pixel text-2xl tracking-wider">Blockwright</span>
        </Link>
        <nav aria-label="Main" className="hidden sm:block">
          <ul className="flex gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={link}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className="px-btn px-btn-secondary px-btn-sm sm:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t-2 border-shadow sm:hidden">
          <ul className="px-2 py-2">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={link}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t-2 border-shadow bg-panel">
      <div className="grass-strip" aria-hidden />
      <div className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted">
        <p className="font-pixel mb-3 text-base text-gold" data-testid="disclaimer">
          {DISCLAIMER}
        </p>
        <p className="mb-3">
          Minecraft is a trademark of Mojang Synergies AB. Blockwright is an independent fan-made project and uses the name only to describe compatibility. All
          graphics on this site are original.
        </p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li>
              <Link to="/about">About</Link>
            </li>
            <li>
              <Link to="/privacy">Privacy &amp; data deletion</Link>
            </li>
            <li>
              <Link to="/terms">Terms</Link>
            </li>
            <li>
              <Link to="/tools">All tools</Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-panel focus:p-2">
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}
