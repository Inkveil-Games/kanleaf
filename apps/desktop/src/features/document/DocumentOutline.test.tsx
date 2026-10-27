import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DocumentOutlineContext,
  DocumentOutlineStore,
  markdownHeadings,
  outlineTree,
} from '../markdown/documentOutline';
import { DocumentOutline } from './DocumentOutline';

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  localStorage.removeItem('kanleaf.library.outline-open');
});

const MARKDOWN = [
  '# Guide',
  '## Setup',
  '### Install',
  '### Configure',
  '## Usage',
].join('\n\n');

function renderOutline() {
  const store = new DocumentOutlineStore();
  const reveal = vi.fn();
  const headings = markdownHeadings(MARKDOWN);
  render(
    <DocumentOutlineContext.Provider value={store}>
      <DocumentOutline />
    </DocumentOutlineContext.Provider>,
  );
  act(() => store.publish(headings, reveal));
  return { store, reveal, headings };
}

describe('outlineTree', () => {
  it('nests by depth and tolerates skipped levels', () => {
    const tree = outlineTree(markdownHeadings('# A\n\n### B\n\n## C\n\n# D'));
    expect(
      tree.map((node) => [
        node.heading.text,
        node.children.map((child) => child.heading.text),
      ]),
    ).toEqual([
      ['A', ['B', 'C']],
      ['D', []],
    ]);
  });
});

describe('DocumentOutline', () => {
  it('stays visible with an empty state when there is nothing to list', () => {
    const store = new DocumentOutlineStore();
    render(
      <DocumentOutlineContext.Provider value={store}>
        <DocumentOutline />
      </DocumentOutlineContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Outline' })).toBeVisible();
    expect(screen.queryByText('This note has no sections')).toBeNull();

    act(() => store.publish([], vi.fn()));
    expect(screen.getByText('This note has no sections')).toBeInTheDocument();
  });

  it('reveals a heading and marks the reader location', () => {
    const { store, reveal, headings } = renderOutline();

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(reveal).toHaveBeenCalledWith(headings[3]);

    act(() => store.setActive(headings[4].offset));
    expect(screen.getByRole('button', { name: 'Usage' })).toHaveAttribute(
      'aria-current',
      'location',
    );
  });

  it('collapses sections and the whole outline without unmounting them', () => {
    renderOutline();
    const setup = screen.getByRole('button', { name: 'Collapse Setup' });

    fireEvent.click(setup);
    expect(
      screen.getByRole('button', { name: 'Expand Setup' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByText('Install').closest('.document-outline-collapsible'),
    ).toHaveAttribute('data-open', 'false');

    const toggle = screen.getByRole('button', { name: 'Outline' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      document.getElementById(toggle.getAttribute('aria-controls') ?? ''),
    ).toHaveAttribute('data-open', 'false');
  });

  it('remembers the open state for every note', () => {
    const { unmount } = render(
      <DocumentOutlineContext.Provider value={new DocumentOutlineStore()}>
        <DocumentOutline />
      </DocumentOutlineContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    unmount();

    renderOutline();
    expect(screen.getByRole('button', { name: 'Outline' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('moves focus between visible items with the arrow keys', () => {
    renderOutline();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Setup' }));
    const setup = screen.getByRole('button', { name: 'Setup' });
    setup.focus();

    fireEvent.keyDown(setup, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Usage' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(setup).toHaveFocus();
  });
});
