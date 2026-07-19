import { EmptyState, Button } from '@ipoint/ui';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';

export function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
      }}
    >
      <EmptyState
        icon={<TriangleAlert size={24} />}
        title={t('errors.notFound')}
        description={t('errors.notFoundDescription')}
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            {t('common.back')}
          </Button>
        }
      />
    </div>
  );
}
