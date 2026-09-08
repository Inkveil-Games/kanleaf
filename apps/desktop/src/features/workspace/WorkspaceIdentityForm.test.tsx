import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { WorkspaceIdentityForm } from './WorkspaceIdentityForm';

describe('WorkspaceIdentityForm', () => {
  it('suggests a normalized Workspace ID until the user edits it', () => {
    render(
      <WorkspaceIdentityForm
        submitLabel="Create Workspace"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Đội Ngũ Sản Phẩm' },
    });
    expect(screen.getByLabelText('Workspace ID')).toHaveValue(
      'doi-ngu-san-pham',
    );

    fireEvent.change(screen.getByLabelText('Workspace ID'), {
      target: { value: 'product-hub' },
    });
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'A different name' },
    });
    expect(screen.getByLabelText('Workspace ID')).toHaveValue('product-hub');

    fireEvent.click(screen.getByRole('button', { name: 'Reset from name' }));
    expect(screen.getByLabelText('Workspace ID')).toHaveValue(
      'a-different-name',
    );
  });

  it('keeps reserved identifiers local and associated with the field', () => {
    const submit = vi.fn();
    render(
      <WorkspaceIdentityForm
        submitLabel="Create Workspace"
        onSubmit={submit}
      />,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Host' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create Workspace' }).closest('form')!,
    );

    expect(
      screen.getByText('This Workspace ID is reserved'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace ID')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('allows invite because canonical Workspace routes are namespaced under /w', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceIdentityForm
        submitLabel="Create Workspace"
        onSubmit={submit}
      />,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Invite' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        name: 'Invite',
        identifier: 'invite',
      }),
    );
  });

  it('submits the visible name and identifier without clearing a server error draft', async () => {
    const submit = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'conflict', 'Workspace ID is in use'),
      );
    render(
      <WorkspaceIdentityForm
        submitLabel="Create Workspace"
        onSubmit={submit}
      />,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Product' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        name: 'Product',
        identifier: 'product',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace ID is in use',
    );
    expect(screen.getByLabelText('Workspace ID')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Product');
    expect(screen.getByLabelText('Workspace ID')).toHaveValue('product');
  });

  it('associates a whitespace-only name error with the name field', () => {
    const submit = vi.fn();
    render(
      <WorkspaceIdentityForm
        submitLabel="Create Workspace"
        onSubmit={submit}
      />,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: '   ' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create Workspace' }).closest('form')!,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a Workspace name',
    );
    expect(screen.getByLabelText('Workspace name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('renders non-conflict request failures at form level', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('Server unavailable'));
    render(
      <WorkspaceIdentityForm
        submitLabel="Create Workspace"
        onSubmit={submit}
      />,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Product' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server unavailable',
    );
    expect(screen.getByLabelText('Workspace ID')).not.toHaveAttribute(
      'aria-invalid',
    );
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Product');
    expect(screen.getByLabelText('Workspace ID')).toHaveValue('product');
  });
});
