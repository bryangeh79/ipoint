import { PageHeader, Card, EmptyState } from '@ipoint/ui';
import { useTranslation } from 'react-i18next';
import { BadgeCheck } from 'lucide-react';

export function KycPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('kyc.title')} />
      <Card>
        <EmptyState
          icon={<BadgeCheck size={24} />}
          title={t('kyc.title')}
          description={t('common.comingSoonDescription')}
        />
      </Card>
    </>
  );
}
