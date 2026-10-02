import type { HTMLAttributes } from 'react';
import './Avatar.css';

export interface AvatarProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children'
> {
  name: string;
  fallback: string;
  initials?: 1 | 2;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  shape?: 'circle' | 'square';
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function Avatar({
  name,
  fallback,
  initials = 1,
  size = 'md',
  shape = 'circle',
  className,
  ...props
}: AvatarProps) {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const parts =
    initials === 2 && words.length > 1
      ? [words[0], words[words.length - 1]]
      : words.slice(0, 1);
  const label =
    parts
      .map(
        (part) =>
          segmenter.segment(part)[Symbol.iterator]().next().value?.segment ??
          '',
      )
      .join('')
      .toLocaleUpperCase() || fallback;

  return (
    <span
      role="img"
      aria-label={name.trim() || fallback}
      {...props}
      className={`ui-avatar${className ? ` ${className}` : ''}`}
      data-size={size}
      data-shape={shape}
    >
      {label}
    </span>
  );
}
