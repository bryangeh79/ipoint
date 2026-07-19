import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface PublicLayoutProps {
  children: ReactNode;
}

/**
 * Minimal layout for auth pages (login, register, password reset).
 * Displays the iPoint logo and a centered card.
 */
export function PublicLayout({ children }: PublicLayoutProps) {
  const { t } = useTranslation();

  return (
    <div className="ip-member-public-layout">
      <div className="ip-member-public-layout__container">
        <div className="ip-member-public-layout__brand">
          <span className="ip-wordmark" aria-hidden="true">
            <span>i</span>Point <small>{t('app.name')}</small>
          </span>
        </div>
        <div className="ip-member-public-layout__card">{children}</div>
      </div>
    </div>
  );
}
