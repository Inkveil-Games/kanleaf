import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu } from './ContextMenu';

describe('ContextMenu', () => {
  it('closes after an action or a pointer press outside', () => {
    const action = vi.fn();
    render(
      <div>
        <ContextMenu label="Item actions">
          <button role="menuitem" type="button" onClick={action}>
            Rename
          </button>
        </ContextMenu>
        <button type="button">Outside</button>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Item actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Item actions' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes with Escape and restores focus to the trigger', () => {
    const parentShortcut = vi.fn();
    window.addEventListener('keydown', parentShortcut);
    render(
      <ContextMenu label="Item actions">
        <button role="menuitem" type="button">
          Rename
        </button>
      </ContextMenu>,
    );

    const trigger = screen.getByRole('button', { name: 'Item actions' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    window.removeEventListener('keydown', parentShortcut);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(parentShortcut).not.toHaveBeenCalled();
  });

  it('closes with Escape even when focus has left a pending menu action', () => {
    render(
      <ContextMenu label="Item actions">
        <button disabled role="menuitem" type="button">
          Saving
        </button>
      </ContextMenu>,
    );

    const trigger = screen.getByRole('button', { name: 'Item actions' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps multi-select actions open until focus moves outside', () => {
    render(
      <div>
        <ContextMenu label="Visible fields">
          <button data-menu-keep-open role="menuitemcheckbox" type="button">
            Due date
          </button>
        </ContextMenu>
        <button type="button">Outside</button>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Visible fields' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Due date' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
