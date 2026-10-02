import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomPropertyDefinition } from '../workspace/types';
import { PropertyEditorForm } from './PropertyEditor';

const context = { serverUrl: 'https://kanleaf.example.com', token: 'token' };
const property: CustomPropertyDefinition = {
  id: 'property-platform',
  workspace_id: 'workspace-1',
  name: 'Platform',
  type: 'multi_select',
  description: '',
  position: 0,
  configuration: {},
  default_date: null,
  default_option_id: null,
  default_option_ids: ['option-web', 'option-ios'],
  usage_count: 0,
  archived_at: null,
  created_at: '',
  updated_at: '',
  options: ['Web', 'iOS'].map((name, position) => ({
    id: position === 0 ? 'option-web' : 'option-ios',
    workspace_id: 'workspace-1',
    property_id: 'property-platform',
    name,
    color: '#64748B',
    description: '',
    position,
    archived_at: null,
    created_at: '',
    updated_at: '',
  })),
};

afterEach(() => vi.unstubAllGlobals());

function renderEditor(value = property) {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  render(
    <PropertyEditorForm
      context={context}
      workspaceId="workspace-1"
      property={value}
      onBack={() => {}}
      onSaved={async () => {}}
    />,
  );
  return requests;
}

describe('PropertyEditor defaults', () => {
  it('loads multiple defaults and clears only the unchecked option on save', async () => {
    const user = userEvent.setup();
    const requests = renderEditor();
    expect(
      screen.getByRole('checkbox', { name: 'Use Web as default' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Use iOS as default' }),
    ).toBeChecked();
    await user.click(
      screen.getByRole('checkbox', { name: 'Use Web as default' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(requests[0]).toMatchObject({ default_option_ids: ['option-ios'] }),
    );
  });

  it('persists a new default option UUID alongside existing defaults', async () => {
    const user = userEvent.setup();
    const requests = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Add option' }));
    const editor = screen.getByRole('dialog', { name: 'Add option' });
    fireEvent.change(
      within(editor).getByRole('textbox', { name: 'Option name' }),
      { target: { value: 'Android' } },
    );
    await user.click(
      within(editor).getByRole('checkbox', { name: 'Set as default' }),
    );
    await user.click(
      within(editor).getByRole('button', { name: 'Add option' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    const options = requests[0].options as Array<{ id: string; name: string }>;
    expect(options[2]).toMatchObject({
      name: 'Android',
      id: expect.stringMatching(/^[\da-f-]{36}$/),
    });
    expect(requests[0].default_option_ids).toEqual([
      'option-web',
      'option-ios',
      options[2].id,
    ]);
  });

  it.each([false, true])(
    'saves selected defaults when creating or defining a property (define=%s)',
    async (defineExisting) => {
      const user = userEvent.setup();
      const requests: Array<{ url: string; body: Record<string, unknown> }> =
        [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          requests.push({
            url: input.toString(),
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          });
          return new Response(JSON.stringify(property), {
            headers: { 'content-type': 'application/json' },
          });
        }),
      );
      render(
        <PropertyEditorForm
          context={context}
          workspaceId="workspace-1"
          initialName="Platform"
          defineExisting={defineExisting}
          onBack={() => {}}
          onSaved={async () => {}}
        />,
      );
      await user.click(screen.getByRole('combobox', { name: 'Property type' }));
      await user.click(screen.getByRole('option', { name: 'Multi select' }));
      for (const name of ['Web', 'iOS']) {
        await user.click(screen.getByRole('button', { name: 'Add option' }));
        const editor = screen.getByRole('dialog', { name: 'Add option' });
        fireEvent.change(
          within(editor).getByRole('textbox', { name: 'Option name' }),
          { target: { value: name } },
        );
        await user.click(
          within(editor).getByRole('checkbox', { name: 'Set as default' }),
        );
        await user.click(
          within(editor).getByRole('button', { name: 'Add option' }),
        );
        await waitFor(() =>
          expect(
            screen.queryByRole('dialog', { name: 'Add option' }),
          ).toBeNull(),
        );
      }
      await user.click(
        screen.getByRole('button', {
          name: defineExisting ? 'Define property' : 'Create property',
        }),
      );
      await waitFor(() => expect(requests).toHaveLength(1));
      const options = requests[0].body.options as Array<{ id: string }>;
      expect(requests[0].url).toBe(
        `https://kanleaf.example.com/api/workspaces/workspace-1/properties${defineExisting ? '/define' : ''}`,
      );
      expect(requests[0].body.default_option_ids).toEqual([
        options[0].id,
        options[1].id,
      ]);
      expect(options[0].id).toMatch(/^[\da-f-]{36}$/);
      expect(options[1].id).toMatch(/^[\da-f-]{36}$/);
    },
  );

  it('preserves the scalar single-select default and radio behavior', async () => {
    const user = userEvent.setup();
    const requests = renderEditor({
      ...property,
      type: 'single_select',
      default_option_id: 'option-web',
      default_option_ids: [],
    });
    expect(
      screen.getByRole('radio', { name: 'Use Web as default' }),
    ).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Use iOS as default' }));
    expect(
      screen.getByRole('radio', { name: 'Use Web as default' }),
    ).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(requests[0]).toMatchObject({ default_option_id: 'option-ios' }),
    );
    expect(requests[0]).not.toHaveProperty('default_option_ids');
  });
});

describe('Date defaults and Type tooltip', () => {
  it('loads a fixed date, switches to dynamic weeks after and clears on save', async () => {
    const user = userEvent.setup();
    const requests = renderEditor({
      ...property,
      type: 'date',
      default_option_ids: [],
      default_date: { mode: 'fixed', date: '2026-10-15' },
    });
    expect(screen.getByLabelText('Fixed date')).toHaveValue('2026-10-15');
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Property description' }),
      {
        target: { value: 'Schedule the next review.' },
      },
    );
    await user.click(screen.getByRole('button', { name: 'Dynamic' }));
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Offset amount' }),
      { target: { value: '2' } },
    );
    await user.click(screen.getByRole('combobox', { name: 'Offset' }));
    await user.click(screen.getByRole('option', { name: 'Weeks after' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(requests[0]).toMatchObject({
        description: 'Schedule the next review.',
        default_date: {
          mode: 'dynamic',
          amount: 2,
          unit: 'week',
          direction: 'after',
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'None' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(requests[1]).toMatchObject({ default_date: null }),
    );
  });

  it('requires a fixed date and a nonnegative integer offset before saving', async () => {
    const user = userEvent.setup();
    const requests = renderEditor({
      ...property,
      type: 'date',
      default_date: null,
    });
    await user.click(screen.getByRole('button', { name: 'Fixed' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Fixed date'), {
      target: { value: '2026-10-12' },
    });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(requests[0]).toMatchObject({
        default_date: { mode: 'fixed', date: '2026-10-12' },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Dynamic' }));
    for (const value of ['', '-1', '1.5']) {
      fireEvent.change(
        screen.getByRole('spinbutton', { name: 'Offset amount' }),
        { target: { value } },
      );
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeDisabled();
    }
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Offset amount' }),
      { target: { value: '0' } },
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(requests[1]).toMatchObject({
        default_date: {
          mode: 'dynamic',
          amount: 0,
          unit: 'day',
          direction: 'after',
        },
      }),
    );
  });

  it.each([false, true])(
    'persists a Date default when creating or defining (define=%s)',
    async (defineExisting) => {
      const user = userEvent.setup();
      const requests: Record<string, unknown>[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          );
          return new Response(JSON.stringify(property), {
            headers: { 'content-type': 'application/json' },
          });
        }),
      );
      render(
        <PropertyEditorForm
          context={context}
          workspaceId="workspace-1"
          initialName="Review date"
          defineExisting={defineExisting}
          onBack={() => {}}
          onSaved={async () => {}}
        />,
      );
      await user.click(screen.getByRole('combobox', { name: 'Property type' }));
      await user.click(screen.getByRole('option', { name: 'Date' }));
      await user.click(screen.getByRole('button', { name: 'Dynamic' }));
      fireEvent.change(
        screen.getByRole('spinbutton', { name: 'Offset amount' }),
        { target: { value: '3' } },
      );
      await user.click(screen.getByRole('combobox', { name: 'Offset' }));
      expect(screen.getAllByRole('option')).toHaveLength(8);
      await user.click(screen.getByRole('option', { name: 'Months before' }));
      await user.click(
        screen.getByRole('button', {
          name: defineExisting ? 'Define property' : 'Create property',
        }),
      );
      await waitFor(() =>
        expect(requests[0]).toMatchObject({
          type: 'date',
          default_date: {
            mode: 'dynamic',
            amount: 3,
            unit: 'month',
            direction: 'before',
          },
        }),
      );
    },
  );

  it.each([
    'text',
    'number',
    'date',
    'single_select',
    'multi_select',
    'checkbox',
    'url',
  ] as const)(
    'exposes the immutable %s Type explanation by keyboard focus',
    async (type) => {
      renderEditor({ ...property, type });
      const control = screen.getByRole('textbox', { name: 'Property type' });
      expect(control).toHaveAttribute('readonly');
      expect(control).not.toBeDisabled();
      expect(
        screen.queryByText('Type cannot be changed after creation.'),
      ).toBeNull();
      control.focus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Type cannot be changed after creation.',
      );
      expect(control).toHaveAccessibleDescription(
        'Type cannot be changed after creation.',
      );
    },
  );
});
