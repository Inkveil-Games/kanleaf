import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { useWorkspaceNotifications } from './useWorkspaceNotifications';

describe('Workspace notifications', () => {
  it('clears previous notifications and ignores late results from an old scope', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ scope }) => useWorkspaceNotifications(scope),
      {
        initialProps: { scope: 'account-a/workspace-a' },
        wrapper: ToastProvider,
      },
    );
    const previous = result.current;
    act(() => previous.notify({ title: 'Task created', variant: 'success' }));
    expect(screen.getByText('Task created')).toBeVisible();
    rerender({ scope: 'account-a/workspace-b' });
    await waitFor(() =>
      expect(screen.queryByText('Task created')).not.toBeInTheDocument(),
    );
    act(() => previous.notify({ title: 'Late result', variant: 'success' }));
    act(() => previous.setActionError('Old failure'));
    expect(screen.queryByText('Late result')).not.toBeInTheDocument();
    expect(screen.queryByText('Old failure')).not.toBeInTheDocument();
    rerender({ scope: 'account-a/workspace-a' });
    act(() =>
      previous.notify({
        title: 'Late result after return',
        variant: 'success',
      }),
    );
    expect(
      screen.queryByText('Late result after return'),
    ).not.toBeInTheDocument();
    act(() =>
      result.current.notify({ title: 'Current result', variant: 'success' }),
    );
    expect(screen.getByText('Current result')).toBeVisible();
    unmount();
    act(() =>
      previous.notify({ title: 'Unmounted result', variant: 'success' }),
    );
    expect(screen.queryByText('Unmounted result')).not.toBeInTheDocument();
  });

  it('replaces the current action error and clears it when an action is retried', async () => {
    const { result } = renderHook(() => useWorkspaceNotifications('scope'), {
      wrapper: ToastProvider,
    });
    act(() => result.current.setActionError('First failure'));
    expect(screen.getByRole('alert')).toHaveTextContent('First failure');
    act(() => result.current.setActionError('Next failure'));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Next failure');
    act(() => result.current.setActionError(null));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
  });
});
