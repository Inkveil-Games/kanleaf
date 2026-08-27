import type { User } from '../../lib/api/types';

export function applyTheme(theme: User['theme']) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}
