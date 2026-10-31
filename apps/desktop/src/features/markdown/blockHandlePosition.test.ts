import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstLineRect } from './blockHandlePosition';

function rect(top: number, height: number, left = 100, width = 400) {
  return DOMRect.fromRect({ x: left, y: top, width, height });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('firstLineRect', () => {
  it('anchors a padded checklist item to its first text line', () => {
    const item = document.createElement('li');
    const paragraph = document.createElement('p');
    paragraph.style.paddingTop = '4px';
    paragraph.style.lineHeight = '24px';
    item.append(paragraph);
    document.body.append(item);
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(474, 32, 110));
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue(
      rect(474, 32, 140),
    );

    expect(firstLineRect(item)).toMatchObject({
      left: 110,
      top: 478,
      height: 24,
      bottom: 502,
    });
  });

  it('uses only the first line of a multi-line paragraph', () => {
    const paragraph = document.createElement('p');
    paragraph.style.lineHeight = '24px';
    document.body.append(paragraph);
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue(rect(200, 96));

    expect(firstLineRect(paragraph)).toMatchObject({ top: 200, height: 24 });
  });

  it('falls back to the top of blocks without a text line', () => {
    const code = document.createElement('div');
    document.body.append(code);
    vi.spyOn(code, 'getBoundingClientRect').mockReturnValue(rect(50, 300));

    expect(firstLineRect(code)).toMatchObject({ top: 50, height: 32 });
  });
});
