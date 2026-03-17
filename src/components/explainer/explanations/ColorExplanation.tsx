import type { Panel } from "../../../types";
import type { NeighborInfo } from "../explainerConstants";
import { fmt, truncate } from "../explainerConstants";
import { Section, CodeBlock, Em, DistanceBar } from "../explainerPrimitives";
import { CielabDiagram } from "../explainerDiagrams";

export function ColorExplanation({
  closest,
  furthest,
  anchorPanel,
}: {
  closest: NeighborInfo;
  furthest: NeighborInfo;
  anchorPanel: Panel;
}) {
  const anchorColor = anchorPanel.dominantColors?.[0];
  const closeColor = closest.panel.dominantColors?.[0];
  const farColor = furthest.panel.dominantColors?.[0];

  return (
    <>
      <Section number={1} title="Why not just use RGB?">
        <p className="m-0">
          Computer screens mix red, green, and blue light to make colors, but
          the human eye isn't equally sensitive to each channel. Two colors can
          be far apart in RGB numbers yet look almost identical, or close in
          RGB yet appear strikingly different. <Em>CIELAB</Em> is a color
          space specifically designed so that equal numeric distances correspond
          to equal <Em>perceived</Em> differences. If two colors are 10 units
          apart in CIELAB, they look about as different as any other pair that's
          10 units apart, no matter where they sit on the spectrum.
        </p>
      </Section>

      <Section number={2} title="The three CIELAB channels">
        <p className="m-0">
          CIELAB describes a color with three numbers:
        </p>
        <div
          className="mt-2 mb-0 text-[10.5px] leading-[1.8]"
          style={{
            fontFamily: "var(--font-mono, monospace)",
            color: "rgba(255,255,255,0.55)",
          }}
        >
          <div>
            <span style={{ color: "var(--color-accent, #e97d62)" }}>L*</span>{" "}
            — lightness, from <span style={{ opacity: 0.7 }}>0</span> (pure
            black) to <span style={{ opacity: 0.7 }}>100</span> (pure white)
          </div>
          <div>
            <span style={{ color: "var(--color-accent, #e97d62)" }}>a*</span>{" "}
            — the green‑red axis: negative values are green, positive are red
          </div>
          <div>
            <span style={{ color: "var(--color-accent, #e97d62)" }}>b*</span>{" "}
            — the blue‑yellow axis: negative values are blue, positive are yellow
          </div>
        </div>
        <p className="mt-2 mb-0">
          Together these form a 3D space. Any color lands at a specific point
          inside it. Two panels' dominant colors become two points, and the
          question becomes: how far apart are they?
        </p>

        {anchorColor && closeColor && farColor && (
          <>
            <CodeBlock>
{`"${truncate(anchorPanel.title, 20)}"  →  L*=${fmt(anchorColor[0], 1)}  a*=${fmt(anchorColor[1], 1)}  b*=${fmt(anchorColor[2], 1)}
"${truncate(closest.panel.title, 20)}"  →  L*=${fmt(closeColor[0], 1)}  a*=${fmt(closeColor[1], 1)}  b*=${fmt(closeColor[2], 1)}
"${truncate(furthest.panel.title, 20)}"  →  L*=${fmt(farColor[0], 1)}  a*=${fmt(farColor[1], 1)}  b*=${fmt(farColor[2], 1)}`}
            </CodeBlock>

            <CielabDiagram
              anchorLab={anchorColor as [number, number, number]}
              closeLab={closeColor as [number, number, number]}
              farLab={farColor as [number, number, number]}
              anchorLabel={truncate(anchorPanel.title, 14)}
              closeLabel={truncate(closest.panel.title, 14)}
              farLabel={truncate(furthest.panel.title, 14)}
            />
            <p
              className="mt-1 mb-0 text-center text-[9.5px]"
              style={{ color: "rgba(255,255,255,0.3)" }}
            >
              a*/b* plane (lightness L* is the third axis, not shown)
            </p>
          </>
        )}
      </Section>

      <Section number={3} title="Color vs. black-and-white">
        <p className="m-0">
          Before sorting, panels are split into two groups: <Em>chromatic</Em>{" "}
          (color) and <Em>achromatic</Em> (black-and-white). This matters
          because even grayscale pixels can have faint chroma values in CIELAB —
          a warm paper tint or a slight scanner cast is enough to give a
          technically "gray" pixel a nonzero position on the a*/b* axes. Without
          this split, black-and-white panels would land somewhere on the hue
          spectrum and break up the flow of actual color panels.
        </p>
        <p className="mt-2 mb-0">
          The split uses a <Em>colorfulness score</Em> derived from the spread
          of the a* and b* channels across the image. Panels with very little
          spread (below a threshold of about 5) are classified as achromatic.
          This is an interesting case where "colorfulness" is more of a human,
          perceptual judgment than a strict property of the light — a warm-toned
          newsprint scan might technically contain color, but it reads as
          black-and-white to the eye.
        </p>
        <p className="mt-2 mb-0">
          This partition also applies to the similarity graph: a color panel
          will only ever show other color panels as neighbors, and likewise for
          black-and-white. Cross-group comparisons are excluded entirely.
        </p>
      </Section>

      <Section number={4} title="Hue-angle sorting within each group">
        <p className="m-0">
          Within each group, panels are sorted by the <Em>hue angle</Em> of
          their most dominant color. The hue angle is calculated
          from the a* and b* channels using the arctangent function, which
          returns an angle around the color wheel. Reds sit near 0°,
          yellows around 90°, greens near 180°, and blues near 270°.
        </p>
        <CodeBlock>
{`hue  =  atan2( b*, a* )

       ← reds → oranges → yellows → greens → blues → purples →`}
        </CodeBlock>
        <p className="mt-2 mb-0">
          Sorting by this angle produces a natural spectrum walk: reds flow
          into oranges, then yellows, greens, and so on. Lightness is used as
          a tiebreaker when two panels have a similar hue, so darker and lighter
          variants of the same color stay near each other.
        </p>
      </Section>

      <Section number={5} title="Measuring distance between neighbors">
        <p className="m-0">
          The similarity graph uses a different measure than the sort order: the
          straight-line <Em>Euclidean distance</Em> through the full 3D CIELAB
          space between two panels' dominant colors.
        </p>
        {anchorColor && closeColor && (
          <CodeBlock>
{`distance  =  √( ΔL*² + Δa*² + Δb*² )

closest:   √( ${fmt(anchorColor[0] - closeColor[0], 1)}² + ${fmt(anchorColor[1] - closeColor[1], 1)}² + ${fmt(anchorColor[2] - closeColor[2], 1)}² )  ≈  ${fmt(closest.distance, 2)}`}
          </CodeBlock>
        )}
        <p className="mt-2 mb-0">
          The dashed lines in the diagram above are this distance projected
          onto the a*/b* plane. The real distance also includes the L*
          (lightness) difference, which is why the numbers may not perfectly
          match the 2D picture.
        </p>
        <p className="mt-2 mb-0">
          The distance is computed across all palette entries, not just the
          dominant color. Each entry is weighted by its <Em>perceptual
          importance</Em>: a combination of chroma (how saturated the color is)
          and lightness (peaking at mid-tones). Near-white and near-black
          colors, the kind that come from page margins, gutters, and panel
          borders, are heavily discounted so that the actual artwork colors
          drive the result.
        </p>
      </Section>

      <Section number={6} title="Reading the result">
        <p className="m-0">
          Smaller numbers mean the colors are more alike to the human eye.
          As a rough guide: a distance under ~10 is a very close match (most
          people would call them "the same color"), 10–30 is noticeably
          different, and above ~50 is quite far apart.
        </p>
        <div className="mt-3">
          <DistanceBar
            closeDist={closest.distance}
            farDist={furthest.distance}
            anchorLabel={truncate(anchorPanel.title, 18)}
            closeLabel={truncate(closest.panel.title, 18)}
            farLabel={truncate(furthest.panel.title, 18)}
            maxVal={Math.max(furthest.distance * 1.2, 80)}
          />
        </div>
      </Section>
    </>
  );
}