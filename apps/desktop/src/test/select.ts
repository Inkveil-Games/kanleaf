import { fireEvent, screen } from '@testing-library/react';

export function chooseSelectOption(
  selectName: string | RegExp,
  optionName: string | RegExp,
) {
  fireEvent.click(screen.getByRole('combobox', { name: selectName }));
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}
