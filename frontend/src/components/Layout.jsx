import { useState } from 'react';
import { Outlet, NavLink, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTimer, formatTimer } from '../hooks/useTimer';

// Left-rail nav per wireframe 2a: Clients · Deliverables · Timesheet · Expenses,
// brand at top, user pinned at the bottom.
const primaryLinks = [
  { to: '/clients', label: 'Clients' },
  { to: '/tasks', label: 'Deliverables' },
  { to: '/time', label: 'Timesheet' },
  { to: '/expenses', label: 'Expenses' },
];
const secondaryLinks = [
  { to: '/projects', label: 'Projects' },
  { to: '/reports', label: 'Reports' },
  { to: '/settings', label: 'Settings' },
];

function RailIcon({ active }) {
  return <i className={`w-4 h-4 rounded-[5px] shrink-0 ${active ? 'bg-purple-dark' : 'bg-border'}`} />;
}

function RailLink({ to, label, small = false, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg font-semibold transition-colors ${small ? 'text-xs' : 'text-sm'} ${
          isActive ? 'bg-bg-light text-purple-dark' : 'text-text-muted hover:bg-bg-page hover:text-text-body'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <RailIcon active={isActive} />
          {label}
        </>
      )}
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { running, seconds } = useTimer();
  const [menuOpen, setMenuOpen] = useState(false);

  const timerChip = running && (
    <Link
      to="/time"
      className="flex items-center justify-center gap-1.5 bg-red-500 text-white text-xs font-semibold px-2.5 py-1.5 rounded-full hover:bg-red-600 transition-colors tabular-nums"
      title="Timer running — go to Timesheet to stop"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
      </span>
      {formatTimer(seconds)}
    </Link>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop left rail (wireframe 2a) */}
      <aside className="hidden md:flex md:flex-col w-52 shrink-0 bg-[#f8f5fc] border-r border-border px-3 py-4 sticky top-0 h-screen">
        <Link to="/clients" className="flex items-center gap-2.5 px-2 pb-5">
          <img src="/favicon.png" alt="" className="h-7 w-7 rounded-lg" />
          <span className="font-bold text-lg tracking-tight text-purple-darkest">NorthStar</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {primaryLinks.map((l) => <RailLink key={l.to} {...l} />)}
        </nav>
        <div className="border-t border-border my-3 mx-2" />
        <nav className="flex flex-col gap-0.5">
          {secondaryLinks.map((l) => <RailLink key={l.to} {...l} small />)}
        </nav>
        <div className="flex-1" />
        {timerChip && <div className="px-1 pb-3">{timerChip}</div>}
        <div className="flex items-center gap-2.5 px-3 py-2 border-t border-border pt-3">
          <span className="w-7 h-7 rounded-lg bg-bg-light border border-border flex items-center justify-center text-[10px] font-bold text-purple-dark shrink-0">
            {user?.name?.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-text-body truncate">{user?.name}</div>
            <button onClick={logout} className="text-[11px] text-text-muted hover:text-text-body transition-colors">
              Log out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <nav className="md:hidden bg-purple-darkest text-white shadow-md sticky top-0 z-40">
        <div className="px-4 flex items-center justify-between h-14">
          <Link to="/clients" className="flex items-center gap-2 font-bold text-lg tracking-tight text-white">
            <img src="/favicon.png" alt="NorthStar" className="h-7 w-7 rounded" />
            NorthStar
          </Link>
          <div className="flex items-center gap-3">
            {timerChip}
            <button
              className="text-white/80 hover:text-white"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-white/10 px-4 py-3 flex flex-col gap-2">
            {[...primaryLinks, ...secondaryLinks].map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `text-sm py-1 ${isActive ? 'text-olive font-semibold' : 'text-white/80'}`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <div className="border-t border-white/10 pt-2 mt-1">
              <span className="text-sm text-white/60 block">{user?.name}</span>
              <button onClick={logout} className="text-sm text-white/50 mt-1">
                Log out
              </button>
            </div>
          </div>
        )}
      </nav>

      <main className="flex-1 min-w-0 px-4 md:px-8 py-6">
        <div className="max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
