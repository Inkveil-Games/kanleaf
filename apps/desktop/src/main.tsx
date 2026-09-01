import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { Providers } from './app/providers';
import { AppRouter } from './app/routing/AppRouter';
import './styles/tokens.css';
import './styles/global.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Kanleaf root element is missing');
}

createRoot(root).render(
  <StrictMode>
    <Providers>
      <AppRouter>
        <App />
      </AppRouter>
    </Providers>
  </StrictMode>,
);
