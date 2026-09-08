import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../Button';
import { Input } from '../Input';
import { Select } from '../Select';
import { FormField } from './FormField';

describe('FormField', () => {
  it('associates its label, guidance, error, and required state with the control', () => {
    render(
      <FormField
        label="Workspace ID"
        description="Used in Workspace links."
        hint="Lowercase letters and hyphens only."
        error="This ID is already taken."
        required
        action={
          <Button variant="text" size="sm">
            Reset from name
          </Button>
        }
      >
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Workspace ID' });
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'Used in Workspace links. Lowercase letters and hyphens only. This ID is already taken.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This ID is already taken.',
    );
    expect(
      screen.getByRole('button', { name: 'Reset from name' }),
    ).toBeInTheDocument();
  });

  it('preserves explicitly supplied accessibility relationships', () => {
    render(
      <>
        <span id="external-guidance">External guidance</span>
        <FormField label="Name" hint="Visible hint">
          <Input id="custom-name" aria-describedby="external-guidance" />
        </FormField>
      </>,
    );

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('id', 'custom-name');
    expect(input).toHaveAccessibleDescription('External guidance Visible hint');
  });

  it('provides the same label and validation contract to Select', () => {
    render(
      <FormField
        label="Default state"
        hint="Applied to new tasks."
        error="Choose an available state."
      >
        <Select
          ariaLabel="Default state"
          value="todo"
          options={[{ value: 'todo', label: 'Todo' }]}
          onValueChange={() => undefined}
        />
      </FormField>,
    );

    const select = screen.getByRole('combobox', { name: 'Default state' });
    expect(select).toHaveAttribute('id');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription(
      'Applied to new tasks. Choose an available state.',
    );
  });
});
