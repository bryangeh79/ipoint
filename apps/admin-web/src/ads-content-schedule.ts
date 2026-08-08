/**
 * P8-S1 explicit-UTC schedule conversion.
 *
 * The scheduling controls are `datetime-local` inputs labelled "(UTC)". The
 * browser renders and returns that control's value in the *local* timezone,
 * so the raw string must never be fed to `new Date(text)` (which would
 * interpret it as local time and shift the stored UTC instant — e.g. in
 * Asia/Kuala_Lumpur, entering 12:00 would store 04:00Z).
 *
 * The control value is therefore fixed to UTC explicitly: the submitted
 * instant is the clock value the operator sees, and the round trip
 * (stored ISO -> control -> stored ISO) never shifts with the browser
 * timezone.
 */
const LOCAL_CONTROL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;

/**
 * Converts a `datetime-local` control value (`YYYY-MM-DDTHH:mm`) to the UTC
 * instant it represents, without any local-time interpretation. Returns null
 * for empty or malformed values so a schedule is never silently corrupted.
 */
export function utcFromLocalControl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const match = LOCAL_CONTROL_PATTERN.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber] = [
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
  ];
  const secondNumber = Number(second ?? 0);
  // Range-check so out-of-range values never normalize into a different
  // instant (Date.UTC silently rolls over, e.g. 25:00 -> next day 01:00).
  if (
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > 31 ||
    hourNumber > 23 ||
    minuteNumber > 59 ||
    secondNumber > 59
  )
    return null;
  const instant = new Date(
    Date.UTC(
      yearNumber,
      monthNumber - 1,
      dayNumber,
      hourNumber,
      minuteNumber,
      secondNumber,
    ),
  );
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/**
 * Converts a stored UTC instant to the `datetime-local` control value that
 * displays the same UTC clock value (the control is labelled "(UTC)"). The
 * reverse of `utcFromLocalControl`; empty for null/empty timestamps.
 */
export function localControlFromUtc(value: string | null): string {
  if (!value) return '';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  return instant.toISOString().slice(0, 16);
}
