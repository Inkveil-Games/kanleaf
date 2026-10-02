import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@codemirror/view';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MilkdownEditor } from './MilkdownEditor';
import { createRef } from 'react';

beforeAll(() => {
  // JSDOM has no hit testing; let unhandled pointer events find no position.
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => null,
  });
  // Code block node views mount only when visible. jsdom has no layout engine.
  vi.stubGlobal(
    'IntersectionObserver',
    class implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        queueMicrotask(() =>
          this.callback(
            [
              {
                target,
                isIntersecting: true,
                intersectionRatio: 1,
                time: 0,
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRect: target.getBoundingClientRect(),
                rootBounds: null,
              },
            ],
            this,
          ),
        );
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'elementFromPoint');
});

function imageFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'capture.png', {
    type: 'image/png',
  });
}

async function renderEditor(value = '# Editor') {
  const onChange = vi.fn();
  const uploadImage = vi
    .fn<(file: File) => Promise<string>>()
    .mockResolvedValue(
      'kanleaf-asset://images/550e8400-e29b-41d4-a716-446655440000.png',
    );
  const view = render(
    <MilkdownEditor
      value={value}
      onChange={onChange}
      uploadImage={uploadImage}
      resolveAsset={vi.fn().mockResolvedValue('https://example.com/image.png')}
    />,
  );
  await waitFor(() =>
    expect(view.container.querySelector('.ProseMirror')).toBeTruthy(),
  );
  return { ...view, onChange, uploadImage };
}

describe('MilkdownEditor image uploads', () => {
  it('preserves ordinary Markdown images without titles when another block is edited', async () => {
    const image =
      '![Screenshot](kanleaf-asset://images/550e8400-e29b-41d4-a716-446655440000.png)';
    const { onChange } = await renderEditor(`${image}\n\n- [ ] Review image`);
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Toggle checklist item',
    });
    fireEvent.pointerDown(checkbox);
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining(image));
      expect(onChange).toHaveBeenLastCalledWith(
        expect.stringContaining('[x] Review image'),
      );
    });
  });

  it.each(['paste', 'drop'] as const)(
    'uses the shared upload pipeline for image %s',
    async (method) => {
      const { container, uploadImage } = await renderEditor();
      const shell = container.querySelector('.milkdown-editor-shell');
      expect(shell).toBeTruthy();
      if (method === 'paste') {
        fireEvent.paste(shell!, { clipboardData: { files: [imageFile()] } });
      } else {
        fireEvent.drop(shell!, { dataTransfer: { files: [imageFile()] } });
      }
      await waitFor(() => expect(uploadImage).toHaveBeenCalledOnce());
    },
  );

  it('leaves the Markdown valid when upload fails', async () => {
    const { container, onChange, uploadImage } = await renderEditor();
    uploadImage.mockRejectedValueOnce(new Error('Upload unavailable'));
    const shell = container.querySelector('.milkdown-editor-shell');
    fireEvent.drop(shell!, {
      dataTransfer: { files: [imageFile()] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Upload unavailable',
    );
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('!['));
  });

  it('uses the shared upload pipeline from the Crepe image picker', async () => {
    const { container, uploadImage } = await renderEditor();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Insert image' }),
    );

    const input = await waitFor(() => {
      const picker =
        container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(picker).toBeTruthy();
      return picker!;
    });
    fireEvent.change(input, { target: { files: [imageFile()] } });

    await waitFor(() => expect(uploadImage).toHaveBeenCalledOnce());
  });
});

describe('MilkdownEditor Crepe block editing', () => {
  it('captures the visible Markdown block without changing the draft', async () => {
    const ref = createRef<{
      captureViewport: () => { offset: number; inset: number } | null;
    }>();
    const value =
      '# First\n\nText\n\n$$\nx^2\n$$\n\n## Thiết kế\n\nLast paragraph';
    const onChange = vi.fn();
    const { container } = render(
      <MilkdownEditor
        ref={ref}
        value={value}
        onChange={onChange}
        uploadImage={vi.fn()}
        resolveAsset={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Visual Markdown editor')).toHaveAttribute(
        'aria-busy',
        'false',
      ),
    );
    const viewport = screen.getByLabelText('Visual Markdown editor');
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 100, 400, 400),
    );
    const children = container.querySelectorAll(
      '.ProseMirror > :not(.markdown-block-exit)',
    );
    children.forEach((element, index) =>
      vi
        .spyOn(element, 'getBoundingClientRect')
        .mockReturnValue(new DOMRect(0, index * 50 - 30, 400, 30)),
    );
    expect(ref.current?.captureViewport()).toEqual({
      offset: value.indexOf('## Thiết kế'),
      inset: 20,
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ['code block', '```ts\nvalue\n```'],
    ['table', '| A | B |\n| - | - |\n| 1 | 2 |'],
    ['formula', '$$\nx^2\n$$'],
    ['divider', '---'],
  ])('offers a caret target after a final %s', async (_kind, source) => {
    const { container, onChange } = await renderEditor(source);
    const target = await screen.findByRole('button', {
      name: 'Continue after block',
    });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.mouseDown(target, { button: 0 });
    const paragraph = container.querySelector('.ProseMirror > p:last-child');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.contains(window.getSelection()?.anchorNode ?? null)).toBe(
      true,
    );
  });

  it('allows keyboard activation of the after-block caret target', async () => {
    const { container } = await renderEditor('```ts\nvalue\n```');
    const target = await screen.findByRole('button', {
      name: 'Continue after block',
    });
    target.focus();
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(
      container
        .querySelector('.ProseMirror > p:last-child')
        ?.contains(window.getSelection()?.anchorNode ?? null),
    ).toBe(true);
  });

  it('places a paragraph between adjacent code and table blocks', async () => {
    const { container } = await renderEditor(
      '```ts\nvalue\n```\n\n| A |\n| - |\n| B |',
    );
    const editor = container.querySelector<HTMLElement>('.ProseMirror');
    const code = editor?.firstElementChild;
    const table = editor?.querySelector('.milkdown-table-block');
    if (!editor || !code || !table)
      throw new Error('Adjacent blocks are missing');
    vi.spyOn(code, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 100),
    );
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 130, 400, 100),
    );
    fireEvent.mouseDown(editor, { clientX: 30, clientY: 115, button: 0 });
    const paragraph = table.previousElementSibling;
    expect(paragraph?.tagName).toBe('P');
    expect(paragraph?.nextElementSibling).toBe(table);
    expect(paragraph?.contains(window.getSelection()?.anchorNode ?? null)).toBe(
      true,
    );
  });

  it('reuses the paragraph after a block without adding another one', async () => {
    const { container, onChange } = await renderEditor(
      '```ts\nvalue\n```\n\nExisting text',
    );
    const editor = container.querySelector<HTMLElement>('.ProseMirror');
    const code = editor?.firstElementChild;
    const paragraph = editor?.querySelector(':scope > p');
    if (!editor || !code || !paragraph)
      throw new Error('Editor blocks are missing');
    vi.spyOn(code, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 100),
    );
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 130, 400, 30),
    );
    fireEvent.mouseDown(editor, { clientX: 30, clientY: 115, button: 0 });
    expect(editor.querySelectorAll(':scope > p')).toHaveLength(1);
    expect(paragraph.contains(window.getSelection()?.anchorNode ?? null)).toBe(
      true,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ['code block', '```ts\nvalue\n```'],
    ['table', '| A | B |\n| - | - |\n| 1 | 2 |'],
  ])(
    'places a text caret below a final %s without changing content on mount',
    async (_kind, source) => {
      const { container, onChange } = await renderEditor(source);
      await waitFor(() =>
        expect(screen.getByLabelText('Visual Markdown editor')).toHaveAttribute(
          'aria-busy',
          'false',
        ),
      );
      const editor = container.querySelector<HTMLElement>('.ProseMirror');
      const block = editor?.firstElementChild;
      if (!editor || !block) throw new Error('Editor block is missing');
      expect(onChange).not.toHaveBeenCalled();
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 400, 100),
      );
      fireEvent.mouseDown(editor, { clientX: 30, clientY: 115, button: 0 });
      const paragraph = editor.lastElementChild;
      expect(paragraph?.tagName).toBe('P');
      expect(
        paragraph?.contains(window.getSelection()?.anchorNode ?? null),
      ).toBe(true);
      fireEvent.mouseDown(editor, { clientX: 30, clientY: 115, button: 0 });
      expect(editor.querySelectorAll(':scope > p')).toHaveLength(1);
    },
  );
  it('indents code blocks by four spaces with Tab and removes them with Shift+Tab', async () => {
    const { container, onChange } = await renderEditor('```ts\nvalue\n```');
    const content = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        '.milkdown-code-block .cm-content',
      );
      expect(element).toBeTruthy();
      if (!element) throw new Error('Code editor did not mount');
      return element;
    });
    const view = EditorView.findFromDOM(content);
    if (!view) throw new Error('Code editor view is missing');
    await waitFor(() =>
      expect(view.scrollDOM).toHaveClass('ui-native-scrollbar'),
    );
    view.dispatch({ selection: { anchor: 0 } });
    view.focus();
    fireEvent.keyDown(content, { key: 'Tab', code: 'Tab' });
    expect(view.state.doc.toString()).toBe('    value');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining('    value'),
    );
    fireEvent.keyDown(content, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(view.state.doc.toString()).toBe('value');
  });
  it('preserves Mermaid source across the Crepe preview sanitation boundary', async () => {
    const { container, onChange } = await renderEditor(
      '```mermaid\ngraph LR\nA --> B\n```',
    );
    await waitFor(() =>
      expect(
        container.querySelector('kanleaf-mermaid-preview'),
      ).toHaveAttribute('data-source', 'graph LR\nA --> B'),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
  it('disables browser spelling marks without changing the Markdown', async () => {
    const { container, onChange } = await renderEditor('Kanleaf tiếng Việt');
    expect(container.querySelector('.ProseMirror')).toHaveAttribute(
      'spellcheck',
      'false',
    );
    expect(onChange).not.toHaveBeenCalled();
  });
  it('shows tooltips for formatting controls on hover and keyboard focus', async () => {
    const user = userEvent.setup();
    await renderEditor();
    await user.hover(screen.getByRole('button', { name: 'Bold' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bold');
    await user.unhover(screen.getByRole('button', { name: 'Bold' }));
    const style = screen.getByRole('combobox', { name: 'Text style' });
    style.focus();
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent('Text style'),
    );
  });
  it('renders inline and block math while retaining Markdown math syntax', async () => {
    const { container, onChange } = await renderEditor(
      '$x^2$\n\n$$\nx^2 + y^2\n$$',
    );
    await waitFor(() =>
      expect(container.querySelectorAll('.katex')).toHaveLength(2),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'LaTeX' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit math formula' }),
    ).toBeInTheDocument();
  });
  it('edits a displayed math formula and persists only its LaTeX Markdown', async () => {
    const { onChange } = await renderEditor('$$\nx^2\n$$\n\nAfter math');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit math formula' }),
    );
    const source = screen.getByRole('textbox', { name: 'LaTeX formula' });
    expect(source.parentElement).toHaveAttribute('draggable', 'false');
    fireEvent.input(source, { target: { value: 'x^2 + y^2' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining('$$\nx^2 + y^2\n$$'),
    );
    fireEvent.blur(source);
    expect(source.parentElement).toHaveAttribute('draggable', 'true');
    expect(
      screen.queryByRole('textbox', { name: 'LaTeX formula' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit math formula' }),
    ).toHaveTextContent('x');
  });
  it('decorates punctuation without rewriting the canonical draft', async () => {
    const { container, onChange } = await renderEditor(
      '"Hello" -- isn\'t ...\n\n`"code" --`',
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-smart-punctuation="”"]'),
      ).toBeTruthy(),
    );
    expect(container.querySelector('code [data-smart-punctuation]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('provides a fixed shared toolbar and drag handle without an inline add button', async () => {
    const { container } = await renderEditor();

    expect(container.querySelector('.milkdown-editor')).toHaveClass(
      'ui-native-scrollbar',
    );

    expect(
      screen.getByRole('toolbar', { name: 'Markdown formatting' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add block' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Drag block' }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('combobox', { name: 'Text style' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Checklist' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Insert table' }),
    ).toBeInTheDocument();
  });
  it('applies heading formatting from the toolbar to the canonical Markdown', async () => {
    const user = userEvent.setup();
    const { onChange } = await renderEditor('Toolbar heading');
    await user.click(screen.getByRole('combobox', { name: 'Text style' }));
    await user.click(await screen.findByRole('option', { name: 'Heading 2' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('## Toolbar heading'),
      ),
    );
  });
});

describe('MilkdownEditor checklists', () => {
  it('renders interactive checkboxes and serializes their state to Markdown', async () => {
    const { onChange } = await renderEditor('- [ ] Review the editor');
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Toggle checklist item',
    });

    fireEvent.pointerDown(checkbox);

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('[x] Review the editor'),
      ),
    );
    await waitFor(() =>
      expect(checkbox).toHaveAttribute('aria-checked', 'true'),
    );
  });
});
