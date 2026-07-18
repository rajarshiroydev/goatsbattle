const DARK_TEXT = '#0d0d0f';
const LIGHT_TEXT = '#f0f0f2';

/** Pick readable dark or light text for a solid six-digit hex accent. */
export function textOn(hex: string | null | undefined): string {
  const value = hex?.replace(/^#/, '') ?? '';
  if (!/^[0-9a-f]{6}$/i.test(value)) return DARK_TEXT;

  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.6 ? DARK_TEXT : LIGHT_TEXT;
}
