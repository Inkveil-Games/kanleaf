import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  SettingsSortableProvider,
  SettingsSortableRow,
} from './SettingsSortable';
import { reorderSettingsIds } from './settingsSortable';

describe('SettingsSortable', () => {
  it('exposes the library keyboard instructions and stable reorder result', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsSortableProvider ids={['todo', 'doing']} onReorder={onReorder}>
        <SettingsSortableRow id="todo" index={0} label="Todo">
          <span>Todo</span>
        </SettingsSortableRow>
        <SettingsSortableRow id="doing" index={1} label="Doing">
          <span>Doing</span>
        </SettingsSortableRow>
      </SettingsSortableProvider>,
    );

    const handle = screen.getByRole('button', { name: 'Reorder Todo' });
    await waitFor(() =>
      expect(handle).toHaveAttribute('aria-roledescription', 'draggable'),
    );
    const description = document.getElementById(
      handle.getAttribute('aria-describedby') ?? '',
    );
    expect(description).toHaveTextContent(/use the arrow keys/i);
    await user.tab();
    expect(handle).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Drag or press Space, then use arrow keys',
    );
    expect(handle.getAttribute('aria-describedby')?.split(' ')).toContain(
      description?.id,
    );
    expect(handle).toHaveAttribute('aria-roledescription', 'draggable');
    expect(handle).not.toHaveAttribute('title');
    expect(reorderSettingsIds(['todo', 'doing'], 0, 1)).toEqual([
      'doing',
      'todo',
    ]);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('disables the drag handle while persistence is unavailable', () => {
    render(
      <SettingsSortableProvider ids={['todo']} disabled onReorder={vi.fn()}>
        <SettingsSortableRow id="todo" index={0} label="Todo" disabled>
          <span>Todo</span>
        </SettingsSortableRow>
      </SettingsSortableProvider>,
    );

    expect(screen.getByRole('button', { name: 'Reorder Todo' })).toBeDisabled();
  });
});
