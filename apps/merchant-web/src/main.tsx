import '@ipoint/design-tokens/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MerchantApp } from './merchant-app.js';
import './merchant.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MerchantApp />
  </StrictMode>,
);
