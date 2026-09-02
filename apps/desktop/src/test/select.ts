import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

export async function chooseSelectOption(
  selectName: string | RegExp,
  optionName: string | RegExp,
) {
  const user = userEvent.setup();
  const trigger = screen.getByRole('combobox', { name: selectName });
  await waitFor(() => {
    trigger.focus();
    expect(trigger).toHaveFocus();
  });
  await user.keyboard('[ArrowDown]');
  await user.click(await screen.findByRole('option', { name: optionName }));
}
