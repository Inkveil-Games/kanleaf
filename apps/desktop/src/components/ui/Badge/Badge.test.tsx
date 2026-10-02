import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('preserves readable status text without adding a live region', () => {
    render(
      <Badge variant="success" dot>
        Approved
      </Badge>,
    );
    expect(screen.getByText('Approved')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('supports an explicit accessible name for abbreviated metadata', () => {
    render(
      <Badge appearance="outline" size="md" aria-label="3 approved members">
        3
      </Badge>,
    );
    expect(screen.getByLabelText('3 approved members')).toHaveTextContent('3');
  });
});
