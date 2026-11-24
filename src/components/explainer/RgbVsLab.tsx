import { useMemo, useState } from "react";
import type { Panel } from "../../types";
import { panelImageUrl } from "../../utils/imageUrl";
import { dist3, labToRgb8, panelName, rgbCss, rgbToLab, type Lab, type Rgb8 } from "./cielab";

/**
 * Two pairs of colours the same distance apart in RGB: one pair the eye can
 * barely tell apart, the other plainly two different colours. Bars put each
 * pair's RGB distance beside its CIELAB distance. One version uses colours
 * measured from gallery panels, the other pure colours that push the point
 * to its extreme.
 */

interface Swatch {
  rgb: Rgb8;
  lab: Lab;
  name: string;
  /** The panel the colour was measured from, if any. */
  panel?: Panel;
}

interface Pair {
  swatches: [Swatch, Swatch];
  /** What the eye sees. */
  verdict: string;
}

interface Example {
  pairs: [Pair, Pair];
  caption: (rgb: number, ratio: number) => string;
}

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)" };

function solid(rgb: Rgb8, name: string): Swatch {
  return { rgb, lab: rgbToLab(rgb), name };
}

/** Both pairs are 40.2 apart in RGB; CIELAB has them at about 2 and 37. */
const PURE: Example = {
  pairs: [
    { swatches: [solid([0, 255, 0], "pure green"), solid([40, 255, 4], "+40 red, +4 blue")], verdict: "the same green" },
    { swatches: [solid([93, 55, 75], "plum"), solid([74, 82, 52], "olive")], verdict: "a plum and an olive" },
  ],
  caption: (rgb, ratio) =>
    `Both pairs are ${rgb.toFixed(1)} apart in RGB. The first looks like one color, the second like two. CIELAB puts the second pair ${ratio}× further apart, which is what the eye sees.`,
};

/**
 * Dominant colours of four gallery panels (panel id, palette index), picked
 * by searching every pair of palette colours in the gallery for the widest
 * gap between RGB and CIELAB distance at a matched RGB distance. Checked
 * live in galleryExample, which drops the tab if the data has moved on.
 */
const GALLERY_PICKS: { pairs: [[string, number], [string, number]][]; verdicts: [string, string] } = {
  pairs: [
    [
      ["hup-1-1783237259", 0],
      ["stray-bullets-sunshine-roses-17-1771987399", 0],
    ],
    [
      ["odin-5-1794690321", 0],
      ["the-nice-house-by-the-sea-9-1775981688", 2],
    ],
  ],
  verdicts: ["two off-whites, a shade apart", "a dusky purple and a dark green"],
};

function galleryExample(pool: Panel[] | undefined): Example | null {
  if (!pool?.length) return null;
  const byId = new Map(pool.map((p) => [p.id, p]));
  const pairs: Pair[] = [];
  for (let i = 0; i < 2; i++) {
    const sw: Swatch[] = [];
    for (const [id, k] of GALLERY_PICKS.pairs[i]) {
      const panel = byId.get(id);
      const lab = panel?.dominantColors?.[k];
      if (!panel || !lab) return null;
      sw.push({ rgb: labToRgb8(...lab), lab, name: panelName(panel), panel });
    }
    pairs.push({ swatches: [sw[0], sw[1]], verdict: GALLERY_PICKS.verdicts[i] });
  }
  // The claim has to still hold on today's numbers.
  const [a, b] = pairs.map(measure);
  if (Math.abs(a.rgb - b.rgb) > 5 || a.lab * 3 > b.lab) return null;
  return {
    pairs: [pairs[0], pairs[1]],
    caption: (rgb, ratio) =>
      `Dominant colors from four panels. Both pairs are about ${Math.round(rgb)} apart in RGB, but the second looks far more different, and CIELAB puts it ${ratio}× further apart.`,
  };
}

function measure(p: Pair) {
  const [s, t] = p.swatches;
  return { rgb: dist3(s.rgb, t.rgb), lab: dist3(s.lab, t.lab) };
}

export function RgbVsLab({ pool }: { pool?: Panel[] }) {
  const gallery = useMemo(() => galleryExample(pool), [pool]);
  const [mode, setMode] = useState<"gallery" | "pure">("gallery");
  const ex = mode === "gallery" && gallery ? gallery : PURE;
  const m = ex.pairs.map(measure);
  const maxRgb = Math.max(m[0].rgb, m[1].rgb);
  const maxLab = Math.max(m[0].lab, m[1].lab);
  const ratio = Math.round(m[1].lab / Math.max(m[0].lab, 0.1));

  return (
    <figure className="guide-figure rgblab">
      {gallery && (
        <div className="rgblab-tabs" role="tablist" aria-label="Example colors">
          {(["gallery", "pure"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={ex === (k === "gallery" ? gallery : PURE)}
              onClick={() => setMode(k)}
            >
              {k === "gallery" ? "From the gallery" : "Pure colors"}
            </button>
          ))}
        </div>
      )}

      <div className="rgblab-pairs">
        {ex.pairs.map((pair, i) => (
          <div key={i} className="rgblab-card">
            {/* Edge to edge, so the seam shows whether the eye can tell them apart. */}
            <div className="rgblab-swatches">
              {pair.swatches.map((s, j) => (
                <div key={j} style={{ background: rgbCss(s.rgb) }} />
              ))}
            </div>
            <div className="rgblab-labels">
              {pair.swatches.map((s, j) => (
                <div key={j}>
                  <div className="rgblab-name" title={s.name}>
                    {s.panel && <img src={panelImageUrl(s.panel.image)} alt="" loading="lazy" />}
                    <span>{s.name}</span>
                  </div>
                  <div className="rgblab-rgb" style={mono}>
                    {s.rgb.join(", ")}
                  </div>
                </div>
              ))}
            </div>
            <p className="rgblab-verdict">Looks like: {pair.verdict}</p>
            <Bar label="RGB distance" value={m[i].rgb} max={maxRgb} />
            <Bar label="CIELAB distance" value={m[i].lab} max={maxLab} accent />
          </div>
        ))}
      </div>

      <figcaption className="guide-caption mt-2">{ex.caption(m[0].rgb, ratio)}</figcaption>
    </figure>
  );
}

function Bar({ label, value, max, accent = false }: { label: string; value: number; max: number; accent?: boolean }) {
  return (
    <div className="rgblab-bar">
      <div className="rgblab-bar-head" style={mono}>
        <span>{label}</span>
        <span>{value.toFixed(1)}</span>
      </div>
      <div className="rgblab-bar-track">
        <div
          className={accent ? "is-accent" : undefined}
          style={{ width: `${Math.max(1.5, (value / (max || 1)) * 100)}%` }}
        />
      </div>
    </div>
  );
}
