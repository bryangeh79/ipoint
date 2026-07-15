import '@ipoint/design-tokens/base.css';
import { ProductShell } from '@ipoint/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductShell appName="iPoint Member">
      <p>Member application foundation is ready.</p>
    </ProductShell>
  </StrictMode>,
);
