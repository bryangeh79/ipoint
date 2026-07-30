import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { apiClient } from '../api/client';
import { routes } from './routes';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider apiClient={apiClient} autoRestore>
        <Routes>
          {routes.map((route) => (
            <Route
              key={route.path ?? 'root'}
              path={route.path}
              element={route.element}
            />
          ))}
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
