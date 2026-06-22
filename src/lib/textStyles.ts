export const MAX_FONT_FAMILY_LENGTH = 128;
export const MIN_FONT_WEIGHT = 1;
export const MAX_FONT_WEIGHT = 1000;
export const MIN_TEXT_SIZE_PT = 6;
export const MAX_TEXT_SIZE_PT = 72;

export type FontStyleValue = 'normal' | 'italic' | 'oblique';
export type TextAlignment = 'left' | 'center' | 'right';

export function normalizeFontFamily(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\u0000/g, '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_FONT_FAMILY_LENGTH);
}

export function normalizeFontWeight(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const lowerValue = value.trim().toLowerCase();
    if (lowerValue === 'normal') {
      return 400;
    }
    if (lowerValue === 'bold') {
      return 700;
    }
  }

  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.min(MAX_FONT_WEIGHT, Math.max(MIN_FONT_WEIGHT, Math.round(numeric)));
}

export function normalizeFontStyle(value: unknown): FontStyleValue | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'normal' || normalized === 'italic' || normalized === 'oblique') {
    return normalized;
  }

  return null;
}

export function normalizeTextSize(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const clamped = Math.min(MAX_TEXT_SIZE_PT, Math.max(MIN_TEXT_SIZE_PT, numeric));
  return Math.round(clamped * 10) / 10;
}

export function normalizeTextAlignment(value: unknown): TextAlignment | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'left' || normalized === 'center' || normalized === 'right') {
    return normalized;
  }

  return null;
}
