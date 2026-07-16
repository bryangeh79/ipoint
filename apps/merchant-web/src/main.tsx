import '@ipoint/design-tokens/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductShell } from '@ipoint/ui';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductShell appName="iPoint Merchant">
      <p>Foundation status: awaiting Phase 0 completion</p>
    </ProductShell>
  </StrictMode>,
);
