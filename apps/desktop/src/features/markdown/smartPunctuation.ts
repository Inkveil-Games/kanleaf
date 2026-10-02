export function punctuationReplacements(text: string) {
  const replacements: { start: number; end: number; value: string }[] = [];
  const pattern = /https?:\/\/\S+|---|--|\.\.\.|["']/g;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    if (token.startsWith('http')) continue;
    const start = match.index;
    const previous = text[start - 1] ?? '';
    const next = text[start + token.length] ?? '';
    let value = token === '---' ? '—' : token === '--' ? '–' : '…';
    if (token === '"' || token === "'") {
      const opening = !previous || /[\s([{]/.test(previous);
      value = token === '"' ? (opening ? '“' : '”') : opening ? '‘' : '’';
      if (token === "'" && /\w/.test(previous) && /\w/.test(next)) value = '’';
    }
    replacements.push({ start, end: start + token.length, value });
  }
  return replacements;
}

export function smartPunctuation(text: string) {
  let result = text;
  for (const item of punctuationReplacements(text).reverse()) {
    result = result.slice(0, item.start) + item.value + result.slice(item.end);
  }
  return result;
}

interface TextTree {
  type: string;
  value?: string;
  children?: TextTree[];
}

export function remarkSmartPunctuation() {
  return function transform(tree: TextTree) {
    if (tree.type === 'text' && tree.value)
      tree.value = smartPunctuation(tree.value);
    tree.children?.forEach(transform);
  };
}
