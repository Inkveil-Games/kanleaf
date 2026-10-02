import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthForm } from './AuthForm';

describe('AuthForm password recovery', () => {
  it('changes account mode with the keyboard and retains the email draft', () => {
    render(
      <AuthForm
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'member@example.com' },
    });
    const modes = screen.getByRole('group', { name: 'Authentication mode' });
    fireEvent.keyDown(within(modes).getByRole('button', { name: 'Sign in' }), {
      key: 'ArrowRight',
    });
    expect(
      within(modes).getByRole('button', { name: 'New account' }),
    ).toHaveFocus();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('member@example.com');
  });

  it('offers password recovery only while signing in', () => {
    render(
      <AuthForm
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={vi.fn()}
        onForgotPassword={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Forgot password?' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New account' }));
    expect(
      screen.queryByRole('button', { name: 'Forgot password?' }),
    ).not.toBeInTheDocument();
  });

  it('delegates recovery navigation without submitting credentials', () => {
    const forgotPassword = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthForm
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={vi.fn()}
        onForgotPassword={forgotPassword}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(forgotPassword).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
