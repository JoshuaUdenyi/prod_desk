/**
 * App shell: the persistent left rail from the reference kit, collapsed behind a
 * sheet on small screens (PRD §10 asks for mobile-first behaviour).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { FolderKanban, LayoutDashboard, LogOut, Menu, Settings, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { initials } from '../lib/format';
import { useSession } from '../lib/session';
import { IconButton } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-1">
      <span className="grid size-8 place-items-center rounded-[10px] bg-accent text-[13px] font-bold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]">
        PD
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink">ProductionDesk</span>
    </Link>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors',
              isActive
                ? 'bg-accent-soft font-medium text-ink'
                : 'text-muted hover:bg-raised hover:text-ink',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn('size-4', isActive ? 'text-accent' : 'text-faint')} aria-hidden />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function UserRow() {
  const { user, logout } = useSession();
  if (!user) return null;

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-raised px-3 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
        {initials(user.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{user.name}</p>
        <p className="truncate text-[11px] text-faint capitalize">{user.role}</p>
      </div>
      <IconButton
        label="Sign out"
        onClick={() => void logout()}
        className="size-8 border-transparent bg-transparent"
      >
        <LogOut className="size-3.5" aria-hidden />
      </IconButton>
    </div>
  );
}

function Rail({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="pt-1">
        <Brand />
      </div>
      <NavItems onNavigate={onNavigate} />
      <div className="mt-auto space-y-3">
        <UserRow />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the mobile sheet whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="fixed inset-y-0 left-0 hidden w-[248px] border-r border-line bg-surface lg:block">
        <Rail />
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="relative h-full w-[264px] border-r border-line bg-surface">
            <IconButton
              label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="absolute top-4 right-3 border-transparent bg-transparent"
            >
              <X className="size-4" aria-hidden />
            </IconButton>
            <Rail onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur lg:hidden">
          <IconButton label="Open menu" onClick={() => setMenuOpen(true)}>
            <Menu className="size-4" aria-hidden />
          </IconButton>
          <Brand />
        </header>

        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  tabs,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink lg:text-2xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-xs text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="mt-4">{tabs}</div> : null}
    </div>
  );
}

/** Full-screen layout for the signed-out screens. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex justify-center">
          <Brand />
        </div>
        <div className="card p-6 sm:p-7">{children}</div>
        <p className="mt-5 text-center text-[11px] text-faint">
          ProductionDesk — cost every production, price it responsibly.
        </p>
      </div>
    </div>
  );
}
