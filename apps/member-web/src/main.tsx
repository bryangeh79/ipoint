import '@ipoint/design-tokens/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductShell } from '@ipoint/ui';

const navigation = [
  { id: 'overview', label: 'Home', href: '#' },
  { id: 'merchants', label: 'Merchants', href: '#' },
  { id: 'wallet', label: 'Wallet', href: '#' },
  { id: 'team', label: 'Team', href: '#' },
  { id: 'profile', label: 'Profile', href: '#' },
] as const;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductShell
      appName="Member workspace"
      audience="Member"
      navigation={navigation}
    />
  </StrictMode>,
);
