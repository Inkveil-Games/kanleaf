import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsArticle } from './SettingsArticle';

describe('SettingsArticle', () => {
  it('keeps the primary page action inside the shared header', () => {
    render(
      <SettingsArticle
        eyebrow="Workspace"
        title="Properties"
        description="Add custom fields for structured Task information."
        action={<button type="button">New property</button>}
      >
        <p>Property list</p>
      </SettingsArticle>,
    );

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Properties',
    });
    const header = heading.closest('header');

    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByRole('button', {
        name: 'New property',
      }),
    ).toBeInTheDocument();
    expect(within(header as HTMLElement).getByText('Workspace')).toBeVisible();
  });
});
