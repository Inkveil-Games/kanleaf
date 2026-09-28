import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { Providers } from './app/providers';
import { AppRouter } from './app/routing/AppRouter';
import { installInputModality } from './lib/inputModality';
import { installNativeScrollbarReveal } from './lib/nativeScrollbarReveal';
import '@fontsource-variable/geist-mono/wght.css';
import '@fontsource-variable/geist/wght.css';
import './styles/tokens.css';
import './styles/global.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Kanleaf root element is missing');
}

installInputModality();
const uninstallNativeScrollbarReveal = installNativeScrollbarReveal(document);

if (import.meta.hot) {
  import.meta.hot.dispose(uninstallNativeScrollbarReveal);
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
