import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebhookSecret } from './WebhookSecret';
import { WebhookPreview } from './WebhookPreview';
import type { WebhookCatalog } from './types';

describe('Webhook copying', () => {
  it('preserves the signing secret and provides manual-copy guidance on rejection', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
    });
    render(<WebhookSecret secret="klf_secret" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select and copy the signing secret manually',
    );
    expect(screen.getByText('klf_secret')).toBeInTheDocument();
  });

  it('does not announce an old copy result after the preview event changes', async () => {
    let resolveCopy: () => void = () => undefined;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveCopy = resolve;
            }),
        ),
      },
    });
    const catalog: WebhookCatalog = {
      event_types: ['task.created', 'task.updated'],
      allow_http: false,
      examples: {
        'task.created': { event: 'task.created' },
        'task.updated': { event: 'task.updated' },
        'task.deleted': {},
        'comment.created': {},
        'comment.updated': {},
        'comment.deleted': {},
      },
    };
    const { rerender } = render(
      <WebhookPreview catalog={catalog} selected={['task.created']} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }));
    rerender(<WebhookPreview catalog={catalog} selected={['task.updated']} />);
    await act(async () => resolveCopy());
    expect(screen.queryByText('JSON copied')).not.toBeInTheDocument();
    expect(screen.getByLabelText('JSON request body')).toHaveTextContent(
      'task.updated',
    );
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeEnabled();
  });
});
