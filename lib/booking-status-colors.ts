const neutral = { light: "#536477", dark: "#b8c5d4" };
const colors = new Map([
  ["CONFIRMED", { light: "#166344", dark: "#87deb3" }],
  ["CANCELLED", { light: "#993439", dark: "#ffabb1" }],
  ["DRAFT", { light: "#405d83", dark: "#a6c8fc" }],
  ["PENDING", { light: "#805410", dark: "#f3cb82" }],
]);

/** Receipts use the light ink on paper. The web badge also supports a dark surface. */
export function bookingStatusColors(status: string) {
  return colors.get(status) ?? neutral;
}
