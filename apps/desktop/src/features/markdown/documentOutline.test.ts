import { describe, expect, it, vi } from 'vitest';
import {
  activeHeadingIndex,
  DocumentOutlineStore,
  markdownHeadings,
} from './documentOutline';

describe('markdownHeadings', () => {
  it('reads ATX and setext headings with their source offsets', () => {
    const markdown = [
      '# Title',
      '',
      'Intro',
      '',
      '## **Plan** with `code`',
      '',
      'Setext two',
      '----------',
      '',
      '### Closed ###',
    ].join('\n');

    expect(markdownHeadings(markdown)).toEqual([
      { offset: 0, depth: 1, text: 'Title' },
      { offset: 16, depth: 2, text: 'Plan with code' },
      { offset: 41, depth: 2, text: 'Setext two' },
      { offset: 64, depth: 3, text: 'Closed' },
    ]);
  });

  it('skips front matter, fenced code and empty headings', () => {
    const markdown = [
      '---',
      'title: # not a heading',
      '---',
      '## Kept',
      '```sh',
      '# comment',
      '```',
      '~~~',
      '## still code',
      '~~~',
      '#',
      '#nospace',
    ].join('\n');

    expect(markdownHeadings(markdown).map(({ text }) => text)).toEqual([
      'Kept',
    ]);
  });

  it('shows links by their visible text', () => {
    expect(
      markdownHeadings(
        '## See [[notes/plan|the plan]], [[a/b]] and [docs](https://x.test)',
      )[0].text,
    ).toBe('See the plan, b and docs');
  });

  it('does not treat a list item or thematic break as setext text', () => {
    expect(markdownHeadings('- item\n---\n\n---')).toEqual([]);
  });
});

describe('activeHeadingIndex', () => {
  const headings = markdownHeadings('# A\n\ntext\n\n## B\n\ntext\n\n## C');

  it('picks the last heading at or above the viewport offset', () => {
    expect(activeHeadingIndex(headings, null)).toBe(-1);
    expect(activeHeadingIndex(headings, 0)).toBe(0);
    expect(activeHeadingIndex(headings, headings[1].offset + 3)).toBe(1);
    expect(activeHeadingIndex(headings, 10_000)).toBe(2);
  });
});

describe('DocumentOutlineStore', () => {
  it('notifies only on real changes and forwards reveal requests', () => {
    const store = new DocumentOutlineStore();
    const listener = vi.fn();
    const reveal = vi.fn();
    store.subscribe(listener);
    const headings = markdownHeadings('# A\n\n## B');

    store.publish(headings, reveal);
    store.publish(markdownHeadings('# A\n\n## B'), reveal);
    expect(listener).toHaveBeenCalledTimes(1);

    store.setActive(3);
    store.setActive(3);
    expect(listener).toHaveBeenCalledTimes(2);

    store.reveal(headings[1]);
    expect(reveal).toHaveBeenCalledWith(headings[1]);

    store.clear();
    expect(store.getSnapshot()).toEqual({
      headings: [],
      activeOffset: null,
      attached: false,
    });
    store.reveal(headings[1]);
    expect(reveal).toHaveBeenCalledTimes(1);
  });
});
