import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('forwards native props, invalid state, and its ref', () => {
    const ref = createRef<HTMLTextAreaElement>();

    render(
      <Textarea ref={ref} aria-label="Description" invalid disabled rows={4} />,
    );

    const textarea = screen.getByRole('textbox', { name: 'Description' });
    expect(textarea).toBeDisabled();
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('rows', '4');
    expect(ref.current).toBe(textarea);
  });
});
