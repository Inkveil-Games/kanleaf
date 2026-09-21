import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { installInputModality } from './inputModality';

describe('input modality', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.documentElement.removeAttribute('data-input-modality');
  });

  it.each(['Meta', 'OS', 'Super', 'Win'])(
    'ignores modifier-only %s presses but enables keyboard focus for Tab',
    (key) => {
      cleanup = installInputModality();
      fireEvent.pointerDown(document.body);
      fireEvent.keyDown(document.body, { key, metaKey: true });

      expect(document.documentElement).toHaveAttribute(
        'data-input-modality',
        'pointer',
      );

      fireEvent.keyDown(document.body, { key: 'Tab' });
      expect(document.documentElement).toHaveAttribute(
        'data-input-modality',
        'keyboard',
      );
    },
  );

  it('does not turn mouse-focused text entry into keyboard navigation', () => {
    cleanup = installInputModality();
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.pointerDown(input);
    fireEvent.keyDown(input, { key: 'a' });

    expect(document.documentElement).toHaveAttribute(
      'data-input-modality',
      'pointer',
    );
    input.remove();
  });

  it('returns to pointer focus presentation after pointer input', () => {
    cleanup = installInputModality();
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    fireEvent.pointerDown(document.body);

    expect(document.documentElement).toHaveAttribute(
      'data-input-modality',
      'pointer',
    );
  });
});
