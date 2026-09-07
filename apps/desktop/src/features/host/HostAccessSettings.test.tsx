import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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

const hostEmail = 'host@example.com';

describe('HostAccessSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHostAccess).mockResolvedValue({
      restricted: false,
      allowed_emails: ['prepared@example.com', 'remove-me@example.com'],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the Host account and each approved email as its own row', async () => {
    renderSettings();

    expect(await screen.findByText(hostEmail)).toBeInTheDocument();
    expect(screen.getByText('Always allowed')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove prepared@example.com' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove remove-me@example.com' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `Remove ${hostEmail}` }),
    ).not.toBeInTheDocument();
  });

  it('stages a normalized email without saving', async () => {
    renderSettings();

    const input = await screen.findByRole('textbox', {
      name: 'Email address',
    });
    fireEvent.change(input, {
      target: { value: '  NEW.Person@Example.COM  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add email' }));

    expect(input).toHaveValue('');
    expect(screen.getByText('new.person@example.com')).toBeInTheDocument();
    expect(updateHostAccess).not.toHaveBeenCalled();
  });

  it('adds an email with Enter', async () => {
    renderSettings();

    const input = await screen.findByRole('textbox', {
      name: 'Email address',
    });
    fireEvent.change(input, { target: { value: 'enter@example.com' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('enter@example.com')).toBeInTheDocument();
    expect(updateHostAccess).not.toHaveBeenCalled();
  });

  it('includes a valid pending email when the policy is saved', async () => {
    vi.mocked(updateHostAccess).mockResolvedValue({
      restricted: false,
      allowed_emails: [
        'pending@example.com',
        'prepared@example.com',
        'remove-me@example.com',
      ],
    });
    renderSettings();

    const input = await screen.findByRole('textbox', {
      name: 'Email address',
    });
    fireEvent.change(input, { target: { value: ' PENDING@Example.COM ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save access policy' }));

    await waitFor(() =>
      expect(updateHostAccess).toHaveBeenCalledWith(context, {
        restricted: false,
        allowed_emails: [
          'prepared@example.com',
          'remove-me@example.com',
          'pending@example.com',
        ],
      }),
    );
    expect(input).toHaveValue('');
  });

  it('does not save an invalid pending email', async () => {
    renderSettings();

    const input = await screen.findByRole('textbox', {
      name: 'Email address',
    });
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save access policy' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a valid email address',
    );
    expect(input).toHaveValue('not-an-email');
    expect(updateHostAccess).not.toHaveBeenCalled();
  });

  it.each([
    ['', /enter an email address/i],
    ['not-an-email', /enter a valid email address/i],
    [' PREPARED@example.com ', /already (?:approved|added)/i],
  ])(
    'shows accessible feedback instead of adding %j',
    async (value, message) => {
      renderSettings();

      const input = await screen.findByRole('textbox', {
        name: 'Email address',
      });
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Add email' }));

      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(updateHostAccess).not.toHaveBeenCalled();
    },
  );

  it('stages removal without saving', async () => {
    renderSettings();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Remove prepared@example.com',
      }),
    );

    expect(screen.queryByText('prepared@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('remove-me@example.com')).toBeInTheDocument();
    expect(updateHostAccess).not.toHaveBeenCalled();
  });

  it('discards changes and restores the initial Restricted policy', async () => {
    vi.mocked(getHostAccess).mockResolvedValue({
      restricted: true,
      allowed_emails: ['prepared@example.com'],
    });
    renderSettings();

    const restricted = await screen.findByRole('checkbox', {
      name: /Restricted access/,
    });
    fireEvent.click(restricted);
    addEmail('added@example.com');
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove prepared@example.com' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(restricted).toBeChecked();
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.getByText('prepared@example.com')).toBeInTheDocument();
    expect(screen.queryByText('added@example.com')).not.toBeInTheDocument();
    expect(updateHostAccess).not.toHaveBeenCalled();
  });

  it('saves the full draft and reconciles the canonical response', async () => {
    vi.mocked(updateHostAccess).mockResolvedValue({
      restricted: false,
      allowed_emails: ['canonical@example.com', 'prepared@example.com'],
    });
    renderSettings();

    await screen.findByText('prepared@example.com');
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove remove-me@example.com' }),
    );
    addEmail('  STAGED@Example.COM ');
    fireEvent.click(screen.getByRole('button', { name: 'Save access policy' }));

    await waitFor(() =>
      expect(updateHostAccess).toHaveBeenCalledWith(context, {
        restricted: false,
        allowed_emails: ['prepared@example.com', 'staged@example.com'],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Access policy saved',
    );
    expect(screen.getByText('canonical@example.com')).toBeInTheDocument();
    expect(screen.getByText('prepared@example.com')).toBeInTheDocument();
    expect(screen.queryByText('staged@example.com')).not.toBeInTheDocument();
  });

  it('does not save when Restricted confirmation is cancelled', async () => {
    renderSettings();

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Restricted access/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save access policy' }));
    const dialog = screen.getByRole('alertdialog', {
      name: 'Save Restricted access?',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(updateHostAccess).not.toHaveBeenCalled();
  });

  it('preserves added and removed emails after a failed save', async () => {
    vi.mocked(updateHostAccess).mockRejectedValue(
      new Error('Policy unavailable'),
    );
    renderSettings();

    await screen.findByText('prepared@example.com');
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove prepared@example.com' }),
    );
    addEmail('added@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Save access policy' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Policy unavailable',
    );
    expect(screen.queryByText('prepared@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('remove-me@example.com')).toBeInTheDocument();
    expect(screen.getByText('added@example.com')).toBeInTheDocument();
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

  it('reconciles a pristine cached policy with its background refresh', async () => {
    const client = testQueryClient();
    client.setQueryData(['host-access', context.serverUrl, context.token], {
      restricted: false,
      allowed_emails: ['cached@example.com'],
    });
    vi.mocked(getHostAccess).mockResolvedValue({
      restricted: false,
      allowed_emails: ['fresh@example.com'],
    });
    vi.mocked(updateHostAccess).mockResolvedValue({
      restricted: false,
      allowed_emails: ['fresh@example.com', 'new@example.com'],
    });
    renderSettings(client);

    expect(screen.getByText('cached@example.com')).toBeInTheDocument();
    expect(await screen.findByText('fresh@example.com')).toBeInTheDocument();
    expect(screen.queryByText('cached@example.com')).not.toBeInTheDocument();
    addEmail('new@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Save access policy' }));

    await waitFor(() =>
      expect(updateHostAccess).toHaveBeenCalledWith(context, {
        restricted: false,
        allowed_emails: ['fresh@example.com', 'new@example.com'],
      }),
    );
  });
});

function addEmail(email: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add email' }));
}

function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderSettings(client = testQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <HostAccessSettings context={context} hostEmail={hostEmail} />
    </QueryClientProvider>,
  );
}
