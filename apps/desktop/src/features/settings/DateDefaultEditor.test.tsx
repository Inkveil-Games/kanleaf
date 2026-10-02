import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { DateDefault } from '../workspace/types';
import { DateDefaultEditor } from './DateDefaultEditor';

function Editor({ initial }: { initial: DateDefault | null }) {
  const [value, setValue] = useState(initial);
  return <DateDefaultEditor value={value} onChange={setValue} />;
}

describe('Date default mode controls', () => {
  it('retains the fixed date when the selected mode is clicked again', async () => {
    const user = userEvent.setup();
    render(<Editor initial={{ mode: 'fixed', date: '2026-10-15' }} />);
    const modes = screen.getByRole('group', { name: 'Default value' });
    await user.click(
      within(modes).getByRole('button', { name: 'Fixed', pressed: true }),
    );
    expect(screen.getByLabelText('Fixed date')).toHaveValue('2026-10-15');
  });

  it('retains dynamic amount and offset when the selected mode is clicked again', async () => {
    const user = userEvent.setup();
    render(
      <Editor
        initial={{
          mode: 'dynamic',
          amount: 3,
          unit: 'month',
          direction: 'before',
        }}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Dynamic', pressed: true }),
    );
    expect(
      screen.getByRole('spinbutton', { name: 'Offset amount' }),
    ).toHaveValue(3);
    expect(screen.getByRole('combobox', { name: 'Offset' })).toHaveTextContent(
      'Months before',
    );
    await user.click(screen.getByRole('combobox', { name: 'Offset' }));
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual([
      'Days after',
      'Weeks after',
      'Months after',
      'Years after',
      'Days before',
      'Weeks before',
      'Months before',
      'Years before',
    ]);
  });

  it('switches modes by keyboard and discloses details from the help button', async () => {
    const user = userEvent.setup();
    render(<Editor initial={null} />);
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'None', pressed: true }),
    ).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(
      screen.getByRole('button', { name: 'Fixed', pressed: true }),
    ).toHaveFocus();
    expect(screen.getByLabelText('Fixed date')).toHaveValue('');
    await user.keyboard('{ArrowRight}');
    expect(
      screen.getByRole('spinbutton', { name: 'Offset amount' }),
    ).toHaveValue(0);
    await user.tab();
    expect(
      screen.getByRole('spinbutton', { name: 'Offset amount' }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Offset' })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'How date defaults work' }),
    ).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'creator’s time zone',
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Zero uses that day');
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'short months use their last day',
    );
  });
});
