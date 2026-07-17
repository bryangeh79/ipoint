import '@ipoint/design-tokens/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './admin-app.js';
import './admin.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
