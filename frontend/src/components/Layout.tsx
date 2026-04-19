import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/routines', label: 'Routines' },
  { to: '/runs', label: 'Runs' },
  { to: '/settings', label: 'Settings' },
  ...(import.meta.env.VITE_DEV === 'true' ? [{ to: '/dev', label: 'Dev' }] : []),
];

export default function Layout() {
  return (
    <div className="relative flex h-full flex-col">
      {/* Ambient background glows */}
      <div className="pointer-events-none fixed -top-[10%] -right-[5%] h-[40vw] w-[40vw] rounded-full bg-accent/10 blur-[100px]" />
      <div className="pointer-events-none fixed -bottom-[10%] -left-[5%] h-[40vw] w-[40vw] rounded-full bg-accent-warm/10 blur-[100px]" />

      {/* Nav */}
      <div className="relative z-10 flex shrink-0 items-center gap-8 border-b border-accent/20 bg-accent/5 px-6 py-4 shadow-sm backdrop-blur-md">
        <NavLink to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-warm text-white shadow-md">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <span className="text-[16px] font-semibold tracking-tight text-foreground">
            Opencode Routines
          </span>
        </NavLink>

        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                isActive
                  ? 'rounded-md bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent shadow-sm'
                  : 'rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-surface/50 hover:text-foreground'
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Page content */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-8 py-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
