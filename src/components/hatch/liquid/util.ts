export function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Darken a hex color by mixing it toward black. amount in [0,1]. */
export function darkenHex(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = 1 - amount;
  const dr = Math.max(0, Math.min(255, Math.round(r * f)));
  const dg = Math.max(0, Math.min(255, Math.round(g * f)));
  const db = Math.max(0, Math.min(255, Math.round(b * f)));
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

export const smoothstep = (x: number) => x * x * (3 - 2 * x);
