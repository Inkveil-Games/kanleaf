import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from './api';
import { NotificationSettings } from './NotificationSettings';

vi.mock('./api', () => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

describe('NotificationSettings', () => {
  it('loads and saves account notification preferences', async () => {
    vi.mocked(getNotificationPreferences).mockResolvedValue({
      notify_comments: true,
      notify_metadata: false,
    });
    vi.mocked(updateNotificationPreferences).mockResolvedValue({
      notify_comments: false,
      notify_metadata: true,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <NotificationSettings context={context} />
      </QueryClientProvider>,
    );

    const comments = await screen.findByRole('checkbox', {
      name: /Comments and replies/,
    });
    const metadata = screen.getByRole('checkbox', { name: /Task changes/ });
    expect(comments).toBeChecked();
    expect(metadata).not.toBeChecked();
    fireEvent.click(comments);
    fireEvent.click(metadata);
    fireEvent.click(screen.getByRole('button', { name: 'Save notifications' }));

    await waitFor(() =>
      expect(updateNotificationPreferences).toHaveBeenCalledWith(context, {
        notify_comments: false,
        notify_metadata: true,
      }),
    );
    expect(
      await screen.findByText('Notification preferences saved'),
    ).toBeInTheDocument();
  });
});
