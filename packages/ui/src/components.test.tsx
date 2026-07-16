// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, FormField, Input, Switch, Tabs } from './components.js';
import {
  AppShell,
  BottomNavigation,
  SideNavigation,
  TopBar,
} from './navigation.js';
import { Dialog } from './overlays.js';

afterEach(cleanup);

describe('component states', () => {
  it('exposes disabled and loading button state', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('connects a visible label and error state to an input', () => {
    render(
      <FormField label="Email" htmlFor="email" error="Enter a valid email">
        <Input id="email" error aria-describedby="email-error" />
      </FormField>,
    );
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email');
  });

  it('operates the switch with keyboard activation', async () => {
    const user = userEvent.setup();
    function Example() {
      const [checked, setChecked] = useState(false);
      return (
        <Switch
          checked={checked}
          onCheckedChange={setChecked}
          label="Notifications"
        />
      );
    }
    render(<Example />);
    const control = screen.getByRole('switch', { name: 'Notifications' });
    control.focus();
    await user.keyboard('[Space]');
    expect(control).toHaveAttribute('aria-checked', 'true');
  });
});

describe('keyboard navigation', () => {
  it('moves between enabled tabs with arrow keys', async () => {
    const user = userEvent.setup();
    function Example() {
      const [active, setActive] = useState('one');
      return (
        <Tabs
          label="Example tabs"
          activeId={active}
          onChange={setActive}
          tabs={[
            { id: 'one', label: 'One' },
            { id: 'disabled', label: 'Disabled', disabled: true },
            { id: 'two', label: 'Two' },
          ]}
        />
      );
    }
    render(<Example />);
    screen.getByRole('tab', { name: 'One' }).focus();
    await user.keyboard('[ArrowRight]');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus();
  });
});

describe('dialog focus management', () => {
  it('traps focus, closes on escape, and restores focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Launcher</button>
          <Dialog
            open={open}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            title="Confirm action"
          >
            <button>First action</button>
            <button>Last action</button>
          </Dialog>
        </>
      );
    }
    render(<Example />);
    const launcher = screen.getByRole('button', { name: 'Launcher' });
    await user.click(launcher);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    screen.getByRole('button', { name: 'Last action' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.keyboard('[Escape]');
    expect(onClose).toHaveBeenCalledOnce();
    expect(launcher).toHaveFocus();
  });
});

describe('responsive application shell', () => {
  it('renders semantic desktop and mobile navigation around main content', () => {
    const items = [{ id: 'home', label: 'Home', href: '#' }];
    render(
      <AppShell
        topBar={<TopBar brand="iPoint" />}
        sideNavigation={
          <SideNavigation
            items={items}
            activeId="home"
            label="Desktop navigation"
          />
        }
        bottomNavigation={
          <BottomNavigation
            items={items}
            activeId="home"
            label="Mobile navigation"
          />
        }
      >
        Dashboard
      </AppShell>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('Dashboard');
    expect(
      screen.getByRole('navigation', { name: 'Desktop navigation' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Mobile navigation' }),
    ).toBeInTheDocument();
  });

  it('has no automatically detectable WCAG violations in the shell foundation', async () => {
    const items = [{ id: 'home', label: 'Home', href: '#' }];
    const { container } = render(
      <AppShell
        topBar={<TopBar brand="iPoint" />}
        sideNavigation={<SideNavigation items={items} activeId="home" />}
      >
        <h1>Dashboard</h1>
      </AppShell>,
    );
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
