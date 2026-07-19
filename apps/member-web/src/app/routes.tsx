import { type RouteObject } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute.tsx';
import { MemberLayout } from '../layouts/MemberLayout.tsx';
import { LoginPage } from '../pages/LoginPage.tsx';
import { RegisterPage } from '../pages/RegisterPage.tsx';
import { VerifyOtpPage } from '../pages/VerifyOtpPage.tsx';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage.tsx';
import { ResetPasswordPage } from '../pages/ResetPasswordPage.tsx';
import { HomePage } from '../pages/HomePage.tsx';
import { ProfilePage } from '../pages/ProfilePage.tsx';
import { ProfileEditPage } from '../pages/ProfileEditPage.tsx';
import { MarketSwitchPage } from '../pages/MarketSwitchPage.tsx';
import { CountryChangePage } from '../pages/CountryChangePage.tsx';
import { KycPage } from '../pages/KycPage.tsx';
import { KycDocumentsPage } from '../pages/KycDocumentsPage.tsx';
import { QrPage } from '../pages/QrPage.tsx';
import { MerchantListPage } from '../pages/MerchantListPage.tsx';
import { MerchantDetailPage } from '../pages/MerchantDetailPage.tsx';
import { NearbyPage } from '../pages/NearbyPage.tsx';
import { SettingsPage } from '../pages/SettingsPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';

/**
 * Application route definitions.
 *
 * Public routes (no auth required) — wrapped with requireGuest to prevent
 * authenticated users from accessing login/register pages.
 *
 * Protected routes (auth required) — wrapped in ProtectedRoute which
 * redirects to /login if not authenticated.
 */
export const routes: RouteObject[] = [
  // ---- Public (guest-only) routes ----
  {
    path: '/login',
    element: (
      <ProtectedRoute requireGuest>
        <LoginPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/register',
    element: (
      <ProtectedRoute requireGuest>
        <RegisterPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/register/verify',
    element: (
      <ProtectedRoute requireGuest>
        <VerifyOtpPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/forgot-password',
    element: (
      <ProtectedRoute requireGuest>
        <ForgotPasswordPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/reset-password',
    element: (
      <ProtectedRoute requireGuest>
        <ResetPasswordPage />
      </ProtectedRoute>
    ),
  },

  // ---- Protected routes (auth required) ----
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <HomePage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/profile',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <ProfilePage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/profile/edit',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <ProfileEditPage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/market',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <MarketSwitchPage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/country-change',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <CountryChangePage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/kyc',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <KycPage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/kyc/documents',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <KycDocumentsPage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/qr',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <QrPage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/merchants',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <MerchantListPage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/merchants/:id',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <MerchantDetailPage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/merchants/nearby',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <NearbyPage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/settings',
    element: (
      <ProtectedRoute>
        <MemberLayout>
          <SettingsPage />
        </MemberLayout>
      </ProtectedRoute>
    ),
  },

  // ---- 404 ----
  {
    path: '*',
    element: <NotFoundPage />,
  },
];
