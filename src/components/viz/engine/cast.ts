import type { Panel } from "../../../types";

/**
 * Who is on screen, ranked.
 *
 * The credit line only ever needed one name, but the composition is a
 * superimposition — at any moment there are several panels carrying it, and the
 * pinned label shows them as a stack. This is what decides the order of that
 * stack, and it is shared by both paths: the flat one scores shards, the
 * spatial one scores slots, and both hand the result here to be ranked.
 */

/** How many names the stack will show. Past this it stops being a list. */
export const CAST_MAX = 5;

/** Never listed: a layer this faint is not carrying anything. Matches the floor
 *  the single-feature credit line used before the stack existed. */
export const CAST_FLOOR = 0.15;

/**
 * How much of the leader's weight an incumbent is credited with for already
 * being in the list. Two layers crossing at similar weight would otherwise swap
 * places every time the cast is sampled, which reads as the list twitching
 * rather than as the composition changing.
 */
const INCUMBENT_BONUS = 0.15;

/**
 * Turn per-panel weights into the ordered cast, most prominent first.
 *
 * `incumbents` is the list the caller is already showing, in order; the head of
 * it — the panel currently being named — is held onto hardest, since that is
 * the one a reader is actually looking at.
 */
export function rankCast(
  scores: Map<string, number>,
  incumbents: string[],
  limit: number,
  resolve: (id: string) => Panel | null
): Panel[] {
  if (scores.size === 0) return [];

  let top = 0;
  for (const weight of scores.values()) top = Math.max(top, weight);
  const bonus = top * INCUMBENT_BONUS;

  const ranked = [...scores.entries()]
    .map(([id, weight]) => {
      const seat = incumbents.indexOf(id);
      return { id, weight: weight + (seat === 0 ? bonus : seat > 0 ? bonus * 0.5 : 0) };
    })
    .sort((a, b) => b.weight - a.weight);

  const cast: Panel[] = [];
  for (const entry of ranked) {
    const panel = resolve(entry.id);
    if (panel) cast.push(panel);
    if (cast.length === limit) break;
  }
  return cast;
}
