import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider.tsx';
import { apiClient } from '../api/client.ts';
import { routes } from './routes.tsx';

export function App() {
  return (
    <AuthProvider apiClient={apiClient} autoRestore>
      <BrowserRouter>
        <Routes>
          {routes.map((route) => (
            <Route
              key={route.path ?? 'root'}
              path={route.path}
              element={route.element}
            />
          ))}
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
