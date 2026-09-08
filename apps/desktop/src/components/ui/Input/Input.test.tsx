import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
  it('forwards native props, invalid state, and its ref', () => {
    const ref = createRef<HTMLInputElement>();

    render(
      <Input
        ref={ref}
        aria-label="Workspace ID"
        invalid
        disabled
        placeholder="kanleaf-team"
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Workspace ID' });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('placeholder', 'kanleaf-team');
    expect(ref.current).toBe(input);
  });
});
