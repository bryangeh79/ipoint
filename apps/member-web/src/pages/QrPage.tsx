import { PageHeader, Card, EmptyState } from '@ipoint/ui';
import { useTranslation } from 'react-i18next';
import { QrCode } from 'lucide-react';

export function QrPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('qr.title')} />
      <Card>
        <EmptyState
          icon={<QrCode size={24} />}
          title={t('qr.title')}
          description={t('common.comingSoonDescription')}
        />
      </Card>
    </>
  );
}
