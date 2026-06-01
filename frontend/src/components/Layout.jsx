import { useState } from 'react';
import { Outlet, NavLink, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const navLinks = [
  { to: '/time', label: 'Time' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/projects', label: 'Projects' },
  { to: '/team', label: 'Team', comingSoon: true },
  { to: '/reports', label: 'Reports', comingSoon: true },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="bg-purple-darkest text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link to="/time" className="font-bold text-lg tracking-tight text-white">
              NorthStar
            </Link>
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) =>
                link.comingSoon ? (
                  <span
                    key={link.to}
                    className="px-3 py-1.5 text-sm text-white/40 cursor-not-allowed"
                    title="Coming soon"
                  >
                    {link.label}
                  </span>
                ) : (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive }) =>
                      `px-3 py-1.5 text-sm rounded transition-colors ${
                        isActive
                          ? 'text-olive font-semibold underline underline-offset-4'
                          : 'text-white/80 hover:text-white'
                      }`
                    }
                  >
                    {link.label}
                  </NavLink>
                )
              )}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <span className="text-sm text-white/70">{user?.name}</span>
            <button onClick={logout} className="text-sm text-white/60 hover:text-white transition-colors">
              Log out
            </button>
          </div>

          <button
            className="md:hidden text-white/80 hover:text-white"
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

        {menuOpen && (
          <div className="md:hidden border-t border-white/10 px-4 py-3 flex flex-col gap-2">
            {navLinks.map((link) =>
              link.comingSoon ? (
                <span key={link.to} className="text-sm text-white/40 py-1">
                  {link.label} <span className="text-xs">(coming soon)</span>
                </span>
              ) : (
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
              )
            )}
            <div className="border-t border-white/10 pt-2 mt-1">
              <span className="text-sm text-white/60 block">{user?.name}</span>
              <button onClick={logout} className="text-sm text-white/50 mt-1">
                Log out
              </button>
            </div>
          </div>
        )}
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
