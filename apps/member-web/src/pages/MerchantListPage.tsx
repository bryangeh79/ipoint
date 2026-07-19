import { PageHeader, Card, EmptyState } from '@ipoint/ui';
import { useTranslation } from 'react-i18next';
import { Store } from 'lucide-react';

export function MerchantListPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('merchants.title')} />
      <Card>
        <EmptyState
          icon={<Store size={24} />}
          title={t('merchants.title')}
          description={t('common.comingSoonDescription')}
        />
      </Card>
    </>
  );
}
