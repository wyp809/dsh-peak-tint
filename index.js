/**
 * Host half of dsh-peak-tint.
 *
 * The plugin is client-only: the clock, the token layering and the settings UI
 * all live in the browser, where the theme layers actually compose. This file
 * exists so the bundle scan finds a Host row; it registers nothing.
 */
export function apply() {}
