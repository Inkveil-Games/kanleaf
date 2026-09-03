import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pencil, Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  SettingsAction,
  SettingsActionsMenu,
  SettingsActionSeparator,
  SettingsEmptyState,
  SettingsList,
  SettingsListCell,
  SettingsListRow,
} from './SettingsList';

describe('SettingsList', () => {
  it('exposes one labelled list with matching header and data cells', () => {
    render(
      <SettingsList
        ariaLabel="Active labels"
        className="labels-settings-grid"
        header={
          <>
            <SettingsListCell>Color</SettingsListCell>
            <SettingsListCell>Name</SettingsListCell>
            <SettingsListCell>Description</SettingsListCell>
            <SettingsListCell ariaLabel="Actions" />
          </>
        }
      >
        <SettingsListRow>
          <SettingsListCell>
            <span aria-label="Green" />
          </SettingsListCell>
          <SettingsListCell primary>Documentation</SettingsListCell>
          <SettingsListCell>Needs a written guide</SettingsListCell>
          <SettingsListCell>
            <button type="button">Actions</button>
          </SettingsListCell>
        </SettingsListRow>
      </SettingsList>,
    );

    const list = screen.getByRole('list', { name: 'Active labels' });
    expect(list).toHaveClass('labels-settings-grid');
    expect(within(list).getByText('Color')).toBeVisible();
    expect(within(list).getByText('Documentation')).toBeVisible();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('renders a compact empty state inside the labelled list', () => {
    render(
      <SettingsList ariaLabel="Custom properties">
        <SettingsEmptyState
          title="No custom properties yet"
          description="Create a property to add structured metadata to Tasks."
        />
      </SettingsList>,
    );

    const list = screen.getByRole('list', { name: 'Custom properties' });
    expect(
      within(list).getByText('No custom properties yet'),
    ).toBeVisible();
    expect(within(list).getByRole('status')).toBeInTheDocument();
  });
});

describe('SettingsActionsMenu', () => {
  it('runs labelled actions and separates destructive commands', async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    const remove = vi.fn();

    render(
      <SettingsActionsMenu label="Actions for Documentation">
        <SettingsAction icon={<Pencil size={14} />} onClick={edit}>
          Edit
        </SettingsAction>
        <SettingsActionSeparator />
        <SettingsAction
          destructive
          icon={<Trash2 size={14} />}
          onClick={remove}
        >
          Delete
        </SettingsAction>
      </SettingsActionsMenu>,
    );

    await user.click(
      screen.getByRole('button', { name: 'Actions for Documentation' }),
    );
    expect(await screen.findByRole('separator')).toBeInTheDocument();
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
    expect(deleteItem).toHaveClass('danger-menu-item');

    await user.click(deleteItem);
    expect(remove).toHaveBeenCalledOnce();
    expect(edit).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
  });
});
