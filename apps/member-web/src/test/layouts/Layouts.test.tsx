// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PublicLayout } from '../../layouts/PublicLayout.tsx';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'app.name': 'iPoint Member',
      };
      return translations[key] ?? key;
    },
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('PublicLayout', () => {
  it('renders the brand name', () => {
    render(
      <MemoryRouter>
        <PublicLayout>
          <div>Auth content</div>
        </PublicLayout>
      </MemoryRouter>,
    );

    expect(screen.getByText('iPoint Member')).toBeInTheDocument();
    expect(screen.getByText('Auth content')).toBeInTheDocument();
  });

  it('renders children within the card', () => {
    render(
      <MemoryRouter>
        <PublicLayout>
          <h1>Login Form</h1>
        </PublicLayout>
      </MemoryRouter>,
    );

    expect(screen.getByText('Login Form')).toBeInTheDocument();
    // The card should contain the children
    const card = document.querySelector('.ip-member-public-layout__card');
    expect(card).toBeInTheDocument();
    expect(card).toContainElement(screen.getByText('Login Form'));
  });
});
