import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it.each([
    ['  quang  tran  ', 2, 'QT'],
    ['quang', 2, 'Q'],
    ['  élodie durand ', 1, 'É'],
    ['👩🏽‍💻 Ada', 2, '👩🏽‍💻A'],
    [' \t ', 2, 'U'],
  ] as const)(
    'renders readable initials for %j',
    (name, initials, expected) => {
      render(<Avatar name={name} fallback="U" initials={initials} />);
      expect(screen.getByRole('img')).toHaveTextContent(expected);
      expect(screen.getByRole('img')).toHaveAccessibleName(
        name.trim().replace(/\s+/u, ' ') || 'U',
      );
    },
  );

  it('can be decorative when adjacent text names the person', () => {
    render(<Avatar name="Ada Lovelace" fallback="U" aria-hidden="true" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('A')).toHaveAttribute('aria-hidden', 'true');
  });
});
