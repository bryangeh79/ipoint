import { PageHeader, Card, EmptyState } from '@ipoint/ui';
import { useTranslation } from 'react-i18next';
import { Store } from 'lucide-react';

export function MerchantDetailPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('merchants.detail')} />
      <Card>
        <EmptyState
          icon={<Store size={24} />}
          title={t('merchants.detail')}
          description={t('common.comingSoonDescription')}
        />
      </Card>
    </>
  );
}
