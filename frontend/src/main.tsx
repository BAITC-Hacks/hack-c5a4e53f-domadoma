import { createRoot } from 'react-dom/client';
import App from './App';
import { HttpApiClient } from './api/http';
import type { ApiClient } from './api/client';
import './styles.css';

async function start() {
  // Compile-time DEV guard removes all mock modules from production builds.
  const api: ApiClient = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true'
    ? new (await import('./mocks/client')).MockApiClient()
    : new HttpApiClient();
  createRoot(document.getElementById('root')!).render(<App api={api}/>);
}
void start();
