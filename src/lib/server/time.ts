const DAY_MS = 1000 * 60 * 60 * 24;
const MAX_TZ_OFFSET_MINUTES = 14 * 60;

export const clampTimezoneOffsetMinutes = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  return Math.min(MAX_TZ_OFFSET_MINUTES, Math.max(-MAX_TZ_OFFSET_MINUTES, normalized));
};

export const dayRangeForTimezoneOffset = (referenceAt: number, tzOffsetMinutes: number) => {
  const safeOffsetMinutes = clampTimezoneOffsetMinutes(tzOffsetMinutes);
  const offsetMs = safeOffsetMinutes * 60 * 1000;
  const shifted = new Date(referenceAt - offsetMs);
  const dayStartShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const dayStart = dayStartShifted + offsetMs;
  return { dayStart, dayEnd: dayStart + DAY_MS, tzOffsetMinutes: safeOffsetMinutes };
};
