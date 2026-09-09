import { routePaths } from './routePaths';

export type PublicRoute = 'invite' | 'forgotPassword' | 'resetPassword';

export function publicRouteFromPathname(pathname: string): PublicRoute | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === routePaths.invite()) return 'invite';
  if (normalized === routePaths.forgotPassword()) return 'forgotPassword';
  if (normalized === routePaths.resetPassword()) return 'resetPassword';
  return null;
}
