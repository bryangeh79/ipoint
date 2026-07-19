import { PageHeader, Card, EmptyState } from '@ipoint/ui';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';

export function NearbyPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('merchants.nearby')} />
      <Card>
        <EmptyState
          icon={<MapPin size={24} />}
          title={t('merchants.nearby')}
          description={t('common.comingSoonDescription')}
        />
      </Card>
    </>
  );
}
