import '@ipoint/design-tokens/base.css';
import '@ipoint/ui';
import './i18n/index';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

// Validate required environment variables at dev/build time
function validateEnv(): void {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const apiBaseUrl =
      (import.meta.env.VITE_API_BASE_URL as string) ??
      'http://localhost:3000/api/v1';
    if (
      typeof apiBaseUrl !== 'string' ||
      apiBaseUrl === '' ||
      apiBaseUrl === 'http://localhost:3000/api/v1'
    ) {
      console.info(
        `[member-web] VITE_API_BASE_URL not set, using default: ${apiBaseUrl}`,
      );
    }
  }
}

validateEnv();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
