const modifierKeys = new Set([
  'Alt',
  'AltGraph',
  'Control',
  'Meta',
  'OS',
  'Shift',
  'Super',
  'Win',
]);

const textInputNavigationKeys = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Enter',
  'Escape',
  'Home',
  'PageDown',
  'PageUp',
  'Tab',
]);

export function installInputModality(ownerDocument: Document = document) {
  const root = ownerDocument.documentElement;
  const setPointerModality = () =>
    root.setAttribute('data-input-modality', 'pointer');
  const setKeyboardModality = (event: KeyboardEvent) => {
    if (modifierKeys.has(event.key)) return;
    const target = event.target;
    const isTextInput =
      target instanceof Element &&
      target.matches('input, textarea, [contenteditable="true"]');
    if (isTextInput && !textInputNavigationKeys.has(event.key)) return;
    root.setAttribute('data-input-modality', 'keyboard');
  };

  if (!root.hasAttribute('data-input-modality')) setPointerModality();
  ownerDocument.addEventListener('pointerdown', setPointerModality, true);
  ownerDocument.addEventListener('keydown', setKeyboardModality, true);

  return () => {
    ownerDocument.removeEventListener('pointerdown', setPointerModality, true);
    ownerDocument.removeEventListener('keydown', setKeyboardModality, true);
  };
}
