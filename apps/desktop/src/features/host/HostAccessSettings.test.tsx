import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHostAccess, updateHostAccess } from './api';
import { HostAccessSettings } from './HostAccessSettings';

vi.mock('./api', () => ({
  getHostAccess: vi.fn(),
  updateHostAccess: vi.fn(),
}));

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'host-token',
};

describe('HostAccessSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHostAccess).mockResolvedValue({
      restricted: false,
      allowed_emails: ['prepared@example.com'],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('confirms and saves a canonical Restricted policy', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(updateHostAccess).mockResolvedValue({
      restricted: true,
      allowed_emails: ['first@example.com', 'second@example.com'],
    });
    renderSettings();

    const restricted = await screen.findByRole('checkbox', {
      name: /Restricted access/,
    });
    const emails = screen.getByRole('textbox', { name: 'Approved emails' });
    expect(restricted).not.toBeChecked();
    expect(emails).toHaveValue('prepared@example.com');

    fireEvent.click(restricted);
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    fireEvent.change(emails, {
      target: {
        value: '  SECOND@example.com  \n\nfirst@example.com\n',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save access policy' }));

    expect(window.confirm).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(updateHostAccess).toHaveBeenCalledWith(context, {
        restricted: true,
        allowed_emails: ['SECOND@example.com', 'first@example.com'],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Access policy saved',
    );
    expect(emails).toHaveValue('first@example.com\nsecond@example.com');
  });

  it('does not save when Restricted confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSettings();

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Restricted access/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save access policy' }));

    expect(updateHostAccess).not.toHaveBeenCalled();
  });

  it('preserves the draft after a failed save', async () => {
    vi.mocked(updateHostAccess).mockRejectedValue(
      new Error('One email is invalid'),
    );
    renderSettings();

    const emails = await screen.findByRole('textbox', {
      name: 'Approved emails',
    });
    fireEvent.change(emails, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save access policy' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'One email is invalid',
    );
    expect(emails).toHaveValue('not-an-email');
  });

  it('retries a failed policy load', async () => {
    vi.mocked(getHostAccess)
      .mockRejectedValueOnce(new Error('Policy unavailable'))
      .mockResolvedValueOnce({ restricted: false, allowed_emails: [] });
    renderSettings();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Policy unavailable',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('checkbox', { name: /Restricted access/ }),
    ).not.toBeChecked();
  });
});

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HostAccessSettings context={context} />
    </QueryClientProvider>,
  );
}
