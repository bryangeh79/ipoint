import type { HTMLAttributes, ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { IconButton } from './components.js';

export interface NavigationItem {
  id: string;
  label: string;
  href?: string;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  topBar: ReactNode;
  sideNavigation?: ReactNode;
  bottomNavigation?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  topBar,
  sideNavigation,
  bottomNavigation,
  children,
  className = '',
  ...props
}: AppShellProps) {
  return (
    <div className={`ip-app-shell ${className}`} {...props}>
      {topBar}
      {sideNavigation}
      <main className="ip-app-shell__main" id="main-content" tabIndex={-1}>
        <div className="ip-page-container">{children}</div>
      </main>
      {bottomNavigation}
    </div>
  );
}

export interface TopBarProps extends HTMLAttributes<HTMLElement> {
  brand: ReactNode;
  navigationLabel?: string;
  onMenuClick?: () => void;
  actions?: ReactNode;
}

export function TopBar({
  brand,
  navigationLabel = 'Open navigation',
  onMenuClick,
  actions,
  className = '',
  ...props
}: TopBarProps) {
  return (
    <header className={`ip-top-bar ${className}`} {...props}>
      <a className="ip-skip-link" href="#main-content">
        Skip to main content
      </a>
      {onMenuClick ? (
        <IconButton
          className="ip-top-bar__menu"
          label={navigationLabel}
          icon={<Menu size={22} />}
          onClick={onMenuClick}
        />
      ) : null}
      <div className="ip-top-bar__brand">{brand}</div>
      {actions ? <div className="ip-top-bar__actions">{actions}</div> : null}
    </header>
  );
}

interface NavigationProps extends HTMLAttributes<HTMLElement> {
  items: ReadonlyArray<NavigationItem>;
  activeId: string;
  onNavigate?: (item: NavigationItem) => void;
  label?: string;
}

function NavigationLink({
  item,
  active,
  onNavigate,
}: {
  item: NavigationItem;
  active: boolean;
  onNavigate?: (item: NavigationItem) => void;
}) {
  return (
    <a
      href={item.disabled ? undefined : (item.href ?? '#')}
      aria-current={active ? 'page' : undefined}
      aria-disabled={item.disabled || undefined}
      tabIndex={item.disabled ? -1 : 0}
      onClick={(event) => {
        if (!item.href || item.disabled) event.preventDefault();
        if (!item.disabled) onNavigate?.(item);
      }}
    >
      {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
      <span>{item.label}</span>
      {item.badge ? (
        <span className="ip-navigation__badge">{item.badge}</span>
      ) : null}
    </a>
  );
}

export function SideNavigation({
  items,
  activeId,
  onNavigate,
  label = 'Primary navigation',
  className = '',
  ...props
}: NavigationProps) {
  return (
    <nav
      className={`ip-side-navigation ${className}`}
      aria-label={label}
      {...props}
    >
      {items.map((item) => (
        <NavigationLink
          key={item.id}
          item={item}
          active={item.id === activeId}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

export function BottomNavigation({
  items,
  activeId,
  onNavigate,
  label = 'Primary navigation',
  className = '',
  ...props
}: NavigationProps) {
  return (
    <nav
      className={`ip-bottom-navigation ${className}`}
      aria-label={label}
      {...props}
    >
      {items.map((item) => (
        <NavigationLink
          key={item.id}
          item={item}
          active={item.id === activeId}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

export interface PageHeaderProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'title'
> {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
  ...props
}: PageHeaderProps) {
  return (
    <header className={`ip-page-header ${className}`} {...props}>
      <div>
        {eyebrow ? (
          <span className="ip-page-header__eyebrow">{eyebrow}</span>
        ) : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? (
        <div className="ip-page-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}
