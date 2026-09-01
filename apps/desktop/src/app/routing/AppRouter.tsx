import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';

export function AppRouter({ children }: { children: ReactNode }) {
  return <BrowserRouter>{children}</BrowserRouter>;
}
