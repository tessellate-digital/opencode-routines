import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/routines', label: 'Routines' },
  { to: '/runs', label: 'Runs' },
  { to: '/settings', label: 'Settings' },
  ...(import.meta.env.VITE_DEV === 'true' ? [{ to: '/dev', label: 'Dev' }] : []),
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-white text-[#1d1d1f]">
      <header className="border-b border-[#d1d1d6]">
        <div className="mx-auto flex max-w-5xl items-center gap-8 px-6 py-3">
          <NavLink to="/" className="text-sm font-semibold text-[#1d1d1f]">
            Opencode Routines
          </NavLink>
          <nav className="flex items-center gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  isActive
                    ? 'rounded-md px-3 py-1.5 text-sm font-medium bg-[#f5f5f7] text-[#1d1d1f]'
                    : 'rounded-md px-3 py-1.5 text-sm text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]'
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
