import '@ipoint/design-tokens/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductShell } from '@ipoint/ui';

const navigation = [
  { id: 'overview', label: 'Overview', href: '#' },
  { id: 'operations', label: 'Operations', href: '#' },
  { id: 'activity', label: 'Activity', href: '#' },
  { id: 'settings', label: 'Settings', href: '#' },
] as const;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductShell
      appName="Merchant workspace"
      audience="Merchant"
      navigation={navigation}
    />
  </StrictMode>,
);
