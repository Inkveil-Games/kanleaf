import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('describes a composed icon trigger on hover and focus', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip
        label="Inbox"
        delay={0}
        trigger={
          <button type="button" aria-label="Inbox">
            I
          </button>
        }
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Inbox' });
    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Inbox');

    await user.unhover(trigger);
    trigger.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Inbox');
  });
});
