export interface ColorSwatch {
  label: string;
  value: string;
}

export const COLOR_SWATCH_PALETTE: ColorSwatch[] = [
  { label: 'Gray 500', value: '#6B7280' },
  { label: 'Slate 500', value: '#64748B' },
  { label: 'Blue 500', value: '#3B82F6' },
  { label: 'Cyan 500', value: '#06B6D4' },
  { label: 'Teal 500', value: '#14B8A6' },
  { label: 'Green 500', value: '#22C55E' },
  { label: 'Lime 500', value: '#84CC16' },
  { label: 'Yellow 500', value: '#EAB308' },
  { label: 'Orange 500', value: '#F97316' },
  { label: 'Red 500', value: '#EF4444' },
  { label: 'Pink 500', value: '#EC4899' },
  { label: 'Purple 500', value: '#A855F7' },
  { label: 'Indigo 500', value: '#6366F1' },
];

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}
