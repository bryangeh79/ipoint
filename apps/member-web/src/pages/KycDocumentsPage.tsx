import { PageHeader, Card, EmptyState } from '@ipoint/ui';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';

export function KycDocumentsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('kyc.documents')} />
      <Card>
        <EmptyState
          icon={<FileText size={24} />}
          title={t('kyc.documents')}
          description={t('common.comingSoonDescription')}
        />
      </Card>
    </>
  );
}
