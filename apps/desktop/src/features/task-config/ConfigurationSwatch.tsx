import type { CSSProperties } from 'react';

export function ConfigurationSwatch({ color }: { color: string }) {
  return (
    <span
      className="configuration-color-swatch"
      style={{ '--swatch-color': color } as CSSProperties}
      aria-hidden="true"
    />
  );
}
