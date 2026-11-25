import { useState } from "react";
import type { Panel } from "../../types";
import type { NeighborInfo } from "./explainerConstants";
import { matchPalettes, paletteDistance } from "../../utils/sorting";
import { colorName, labCss, num } from "./cielab";

/**
 * The colour distance worked through for real: the two palettes matched
 * colour-for-colour (`matchPalettes`), each pair's CIELAB distance and
 * weight, and the weighted average that comes out. Computed with the same
 * functions the similarity graph uses, so the bottom line is the number
 * shown everywhere else.
 */

type Which = "closest" | "furthest";

const ROLE_COLOR: Record<Which, string> = {
  closest: "var(--color-accent, #e97d62)",
  furthest: "rgba(255,255,255,0.55)",
};

const lab = (c: readonly number[]) => `L* ${num(c[0])}, a* ${num(c[1])}, b* ${num(c[2])}`;

function Swatch({ c }: { c: readonly [number, number, number] }) {
  return (
    <span className="palette-dist-swatch" style={{ background: labCss(c[0], c[1], c[2]) }}
      title={lab(c)} aria-label={`${colorName(c[0], c[1], c[2])} (${lab(c)})`} role="img" />
  );
}

export function PaletteDistance({
  anchor,
  closest,
  furthest,
}: {
  anchor: Panel;
  closest: NeighborInfo;
  furthest: NeighborInfo;
}) {
  const [which, setWhich] = useState<Which>("closest");
  const other = which === "closest" ? closest : furthest;
  const args = [anchor.dominantColors, other.panel.dominantColors, anchor.dominantWeights, other.panel.dominantWeights] as const;
  const pairs = matchPalettes(...args) ?? [];
  const total = paletteDistance(...args);
  // Weights are tiny products of importance and pixel share; scale them so
  // they read as each pair's share of the average.
  const weightSum = pairs.reduce((s, p) => s + p.weight, 0);
  const share = (w: number) => (weightSum > 0 ? w / weightSum : 1 / pairs.length);

  const fmt = (n: number, d: number) => n.toFixed(d);
  const sum = pairs.map((p) => `${fmt(p.distance, 1)}×${fmt(share(p.weight), 2)}`).join(" + ");

  return (
    <figure className="guide-figure palette-dist">
      <div className="rgblab-tabs" role="tablist" aria-label="Neighbor">
        {(["closest", "furthest"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={which === k} onClick={() => setWhich(k)}>
            {k} match
          </button>
        ))}
      </div>

      <table className="palette-dist-table">
        <thead>
          <tr>
            <th scope="col">anchor</th>
            <th scope="col" style={{ color: ROLE_COLOR[which] }}>{which}</th>
            <th scope="col">distance</th>
            <th scope="col">counts for</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i}>
              <td><Swatch c={p.a} /></td>
              <td><Swatch c={p.b} /></td>
              <td>{fmt(p.distance, 1)}</td>
              <td className={share(p.weight) < 0.1 ? "is-faint" : undefined}>{Math.round(share(p.weight) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="palette-dist-sum">
        <span>{sum}</span>
        <span>
          = <strong style={{ color: ROLE_COLOR[which] }}>{fmt(total, 1)}</strong>
        </span>
      </p>

      <figcaption className="guide-caption mt-2 text-center">
        Each anchor color is paired with whichever color in the other palette makes the two
        palettes closest overall. A pair counts for more when its colors are vivid mid-tones
        that cover much of the panel; paper white and ink black barely move the result.
      </figcaption>
    </figure>
  );
}
