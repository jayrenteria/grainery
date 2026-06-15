import { invoke } from '@tauri-apps/api/core';

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

const TITLEBAR_COLOR_PROPERTY = '--color-base-100';

export async function syncNativeTitlebarTheme(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const color = resolveThemeColor(TITLEBAR_COLOR_PROPERTY);
  if (!color) {
    return;
  }

  try {
    await invoke('set_titlebar_theme_color', {
      red: color.red,
      green: color.green,
      blue: color.blue,
      dark: getRelativeLuminance(color) < 0.45,
    });
  } catch (error) {
    console.warn('Failed to sync native titlebar theme', error);
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function resolveThemeColor(propertyName: string): RgbColor | null {
  const rawValue = getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim();
  const parsedValue = parseCssColor(rawValue);
  if (parsedValue) {
    return parsedValue;
  }

  if (!document.body) {
    return null;
  }

  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.inset = '0';
  probe.style.pointerEvents = 'none';
  probe.style.visibility = 'hidden';
  probe.style.backgroundColor = `var(${propertyName})`;

  document.body.appendChild(probe);
  const computedColor = getComputedStyle(probe).backgroundColor;
  probe.remove();

  return parseCssColor(computedColor);
}

function parseCssColor(value: string): RgbColor | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return (
    parseHexColor(normalized) ??
    parseRgbColor(normalized) ??
    parseColorSrgb(normalized) ??
    parseOklchColor(normalized) ??
    parseCanvasNormalizedColor(normalized)
  );
}

function parseHexColor(value: string): RgbColor | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (!match) {
    return null;
  }

  const hex = match[1].length === 3
    ? match[1].split('').map((char) => char + char).join('')
    : match[1];

  return {
    red: parseInt(hex.slice(0, 2), 16),
    green: parseInt(hex.slice(2, 4), 16),
    blue: parseInt(hex.slice(4, 6), 16),
  };
}

function parseRgbColor(value: string): RgbColor | null {
  if (!value.startsWith('rgb')) {
    return null;
  }

  const channels = extractNumericTokens(value).slice(0, 3);
  if (channels.length < 3) {
    return null;
  }

  return {
    red: parseRgbChannel(channels[0]),
    green: parseRgbChannel(channels[1]),
    blue: parseRgbChannel(channels[2]),
  };
}

function parseColorSrgb(value: string): RgbColor | null {
  if (!value.startsWith('color(srgb')) {
    return null;
  }

  const channels = extractNumericTokens(value).slice(0, 3);
  if (channels.length < 3) {
    return null;
  }

  return {
    red: parseUnitChannel(channels[0]),
    green: parseUnitChannel(channels[1]),
    blue: parseUnitChannel(channels[2]),
  };
}

function parseOklchColor(value: string): RgbColor | null {
  if (!value.startsWith('oklch')) {
    return null;
  }

  const channels = extractNumericTokens(value);
  if (channels.length < 3) {
    return null;
  }

  const lightness = parseLightness(channels[0]);
  const chroma = parseFloat(channels[1]);
  const hueRadians = (parseFloat(channels[2]) * Math.PI) / 180;
  const okA = chroma * Math.cos(hueRadians);
  const okB = chroma * Math.sin(hueRadians);

  const longL = lightness + 0.3963377774 * okA + 0.2158037573 * okB;
  const longM = lightness - 0.1055613458 * okA - 0.0638541728 * okB;
  const longS = lightness - 0.0894841775 * okA - 1.2914855480 * okB;

  const l = longL ** 3;
  const m = longM ** 3;
  const s = longS ** 3;

  return {
    red: linearSrgbToByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    green: linearSrgbToByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    blue: linearSrgbToByte(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  };
}

function parseCanvasNormalizedColor(value: string): RgbColor | null {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.fillStyle = '#000001';
  context.fillStyle = value;

  const normalized = String(context.fillStyle).toLowerCase();
  if (normalized === '#000001' && value !== '#000001') {
    return null;
  }

  return parseHexColor(normalized) ?? parseRgbColor(normalized);
}

function extractNumericTokens(value: string): string[] {
  return value.match(/-?(?:\d*\.\d+|\d+)%?/g) ?? [];
}

function parseRgbChannel(value: string): number {
  if (value.endsWith('%')) {
    return clampByte((parseFloat(value) / 100) * 255);
  }

  return clampByte(parseFloat(value));
}

function parseUnitChannel(value: string): number {
  if (value.endsWith('%')) {
    return clampByte((parseFloat(value) / 100) * 255);
  }

  return clampByte(parseFloat(value) * 255);
}

function parseLightness(value: string): number {
  if (value.endsWith('%')) {
    return clamp01(parseFloat(value) / 100);
  }

  return clamp01(parseFloat(value));
}

function linearSrgbToByte(value: number): number {
  const encoded = value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;

  return clampByte(encoded * 255);
}

function getRelativeLuminance(color: RgbColor): number {
  const red = srgbByteToLinear(color.red);
  const green = srgbByteToLinear(color.green);
  const blue = srgbByteToLinear(color.blue);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function srgbByteToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function clampByte(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
