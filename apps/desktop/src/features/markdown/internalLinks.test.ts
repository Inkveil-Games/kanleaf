import { Editor, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { afterEach, describe, expect, it } from 'vitest';
import { milkdownInternalLinks } from './milkdownInternalLinks';
import { InternalLinkController } from './internalLinkController';
import {
  createInternalLinkIndex,
  internalLinkLabel,
  parseInternalLink,
  searchInternalLinks,
  type InternalLinkEntry,
} from './internalLinks';

const entries: InternalLinkEntry[] = [
  {
    kind: 'page',
    id: 'grep',
    title: 'grep - sed - awk',
    path: 'library/linux/grep_sed_awk',
    hint: 'linux',
    projectId: null,
  },
  {
    kind: 'page',
    id: 'notes-a',
    title: 'Notes',
    path: 'library/a/notes',
    hint: 'a',
    projectId: null,
  },
  {
    kind: 'page',
    id: 'notes-b',
    title: 'Notes',
    path: 'library/b/notes',
    hint: 'b',
    projectId: null,
  },
  {
    kind: 'task',
    id: 'task-42',
    title: 'Đổi tên vault',
    path: 'tasks/42',
    hint: '#42',
    projectId: null,
  },
];

const editors: Editor[] = [];

async function roundTrip(markdown: string) {
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, document.createElement('div')))
    .use(commonmark)
    .use(gfm)
    .use(milkdownInternalLinks(new InternalLinkController()))
    .create();
  editors.push(editor);
  let output = '';
  editor.action((ctx) => {
    output = ctx.get(serializerCtx)(ctx.get(parserCtx)(markdown));
  });
  return output;
}

describe('internal links', () => {
  afterEach(async () => {
    await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  });

  it('links by the shortest unique vault path, like Obsidian', () => {
    const index = createInternalLinkIndex(entries);
    const [grep, notesA, , task] = entries;

    expect(index.linkTarget(grep!)).toBe('grep_sed_awk');
    expect(index.linkTarget(notesA!)).toBe('a/notes');
    expect(index.linkTarget(task!)).toBe('42');
    expect(index.resolve('grep_sed_awk')?.id).toBe('grep');
    expect(index.resolve('library/b/notes.md')?.id).toBe('notes-b');
    expect(index.resolve('tasks/42')?.id).toBe('task-42');
    expect(index.resolve('missing')).toBeNull();
  });

  it('searches titles without accents and labels links with live titles', () => {
    const index = createInternalLinkIndex(entries);

    expect(searchInternalLinks(index, 'doi ten').map(({ id }) => id)).toEqual([
      'task-42',
    ]);
    expect(searchInternalLinks(index, 'grep')[0]?.id).toBe('grep');

    const parts = parseInternalLink('[[grep_sed_awk#Bài tập]]');
    expect(parts).toEqual({
      target: 'grep_sed_awk',
      heading: 'Bài tập',
      alias: null,
    });
    expect(internalLinkLabel(parts!, index.resolve('grep_sed_awk'))).toBe(
      'grep - sed - awk › Bài tập',
    );
    expect(internalLinkLabel(parseInternalLink('[[42|the task]]')!, null)).toBe(
      'the task',
    );
  });

  it('keeps links verbatim through the visual editor', async () => {
    const source =
      'See [[grep_sed_awk]], [[a/notes|notes]] and [[42#Plan]].\n\n`[[code]]` stays code.\n';

    const output = await roundTrip(source);

    expect(output).toBe(source);
    expect(await roundTrip(output)).toBe(output);
  });
});
