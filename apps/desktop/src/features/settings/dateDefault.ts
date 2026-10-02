import type { DateDefault } from '../workspace/types';

export function isDateDefaultComplete(value: DateDefault | null) {
  if (!value) return true;
  if (value.mode === 'fixed') return /^\d{4}-\d{2}-\d{2}$/.test(value.date);
  return (
    Number.isInteger(value.amount) &&
    value.amount >= 0 &&
    value.amount <= 4_294_967_295
  );
}
