/**
 * P7-S6D Admin Commission Rate Configuration adapter constants.
 *
 * §7 technical precision ceiling (stored `numeric(38,10)`) and §7 display
 * precision ceiling (the UI shows at most 6 decimals) — mirroring the
 * accepted S6B/S6C display conventions (D-054 §7: exact decimals, no JS
 * float math; the display string is server-derived and display-only).
 */

/** D-054 §7 technical precision ceiling (stored numeric(38,10)). */
export const COMMISSION_RATE_TECHNICAL_DECIMALS = 10;

/** D-054 §7 display precision ceiling (UI shows at most 6 decimals). */
export const COMMISSION_RATE_DISPLAY_DECIMALS = 6;
