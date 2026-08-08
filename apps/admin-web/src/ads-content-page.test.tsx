import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AdsContentPage } from './ads-content-page.js';

vi.mock('./admin-session.js', () => ({
  useAdminSession: () => ({
    bootstrap: {
      effectivePermissions: [
        'ads.view',
        'ads.manage',
        'content.view',
        'content.manage',
      ],
    },
  }),
}));
vi.mock('./pwa-policy.js', () => ({
  useAdminWriteEnvironment: () => ({
    online: true,
    desktop: true,
    standalone: false,
  }),
  canPerformSensitiveAdminWrite: () => true,
}));
vi.mock('./admin-api.js', () => ({
  adminAdsContentApi: {
    placements: vi.fn().mockResolvedValue({
      market_id: '11111111-1111-4111-8111-111111111111',
      items: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          market_id: '11111111-1111-4111-8111-111111111111',
          code: 'HOME_HERO',
          name: 'Home hero',
          description: null,
          position: 0,
          status: 'ACTIVE',
          version: 1,
        },
      ],
    }),
    listAds: vi.fn().mockResolvedValue({
      market_id: '11111111-1111-4111-8111-111111111111',
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          public_id: '44444444-4444-4444-8444-444444444444',
          market_id: '11111111-1111-4111-8111-111111111111',
          placement_id: '22222222-2222-4222-8222-222222222222',
          placement_code: 'HOME_HERO',
          fee_config_id: null,
          title: 'Dining week',
          summary: null,
          creative_media_url: 'https://cdn.example.test/ad.webp',
          creative_alt_text: 'Dining',
          target_url: null,
          is_sponsored: true,
          sponsor_label: 'Sponsored',
          status: 'ACTIVE',
          schedule_start_at: null,
          schedule_end_at: null,
          version: 2,
          created_at: '2026-08-08T00:00:00.000Z',
          updated_at: '2026-08-08T00:00:00.000Z',
          archived_at: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    }),
    listArticles: vi.fn().mockResolvedValue({
      market_id: '11111111-1111-4111-8111-111111111111',
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    }),
  },
}));

describe('P8-S1 Ads & Content Admin page', () => {
  it('renders market-scoped ads with sponsor editing and lifecycle controls', async () => {
    render(
      <MemoryRouter
        initialEntries={['/admin/11111111-1111-4111-8111-111111111111/ads']}
      >
        <Routes>
          <Route
            path={'/admin/:marketId/ads'}
            element={<AdsContentPage mode={'ads'} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Advertising operations' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Dining week')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New draft' })).toBeEnabled();
    await waitFor(() =>
      expect(screen.getByLabelText('Placement')).toBeInTheDocument(),
    );
  });

  it('renders the explicit empty editorial state', async () => {
    render(
      <MemoryRouter
        initialEntries={['/admin/11111111-1111-4111-8111-111111111111/content']}
      >
        <Routes>
          <Route
            path={'/admin/:marketId/content'}
            element={<AdsContentPage mode={'content'} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'News & content publishing' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing in this market')).toBeInTheDocument();
  });
});
