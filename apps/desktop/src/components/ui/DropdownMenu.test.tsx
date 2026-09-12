import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from './DropdownMenu';

describe('DropdownMenu', () => {
  it('provides roving focus and typeahead navigation', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu label="Item actions">
        <DropdownMenuItem onClick={vi.fn()}>Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={vi.fn()}>Duplicate</DropdownMenuItem>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole('button', { name: 'Item actions' });
    trigger.focus();
    await user.keyboard('[ArrowDown]');

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus(),
    );
    await user.keyboard('d');
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toHaveFocus();
  });

  it('closes action items but keeps checkbox items open', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const toggle = vi.fn();
    render(
      <DropdownMenu label="Visible fields">
        <DropdownMenuCheckboxItem checked onCheckedChange={toggle}>
          Due date
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem onClick={action}>Apply</DropdownMenuItem>
      </DropdownMenu>,
    );

    screen.getByRole('button', { name: 'Visible fields' }).focus();
    await user.keyboard('[ArrowDown]');
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Due date' }),
    );
    expect(toggle).toHaveBeenCalledWith(false);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Apply' }));
    expect(action).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
  });

  it('restores trigger focus when dismissed with Escape', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu label="Item actions">
        <DropdownMenuItem onClick={vi.fn()}>Rename</DropdownMenuItem>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole('button', { name: 'Item actions' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('menu')).toHaveFocus());
    await user.keyboard('[Escape]');

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('supports right-side rail menus, trigger tooltips, and current items', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        label="Saved Views"
        placement="right"
        triggerTooltip="Saved Views"
        tooltipDelay={0}
      >
        <DropdownMenuItem ariaCurrent="page" onClick={vi.fn()}>
          Board View
        </DropdownMenuItem>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole('button', { name: 'Saved Views' });
    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Saved Views');

    await user.click(trigger);
    expect(screen.getByRole('menu')).toHaveAttribute('data-side', 'right');
    expect(
      screen.getByRole('menuitem', { name: 'Board View' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});
