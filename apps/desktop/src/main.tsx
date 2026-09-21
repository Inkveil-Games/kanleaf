import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { Providers } from './app/providers';
import { AppRouter } from './app/routing/AppRouter';
import { installInputModality } from './lib/inputModality';
import './styles/tokens.css';
import './styles/global.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Kanleaf root element is missing');
}

installInputModality();

createRoot(root).render(
  <StrictMode>
    <Providers>
      <AppRouter>
        <App />
      </AppRouter>
    </Providers>
  </StrictMode>,
);
