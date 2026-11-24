import type { Panel } from "../../../types";
import type { NeighborInfo } from "../explainerConstants";
import { fmt, truncate } from "../explainerConstants";
import { Section, CodeBlock, Em, DistanceBar, PanelTrio } from "../explainerPrimitives";
import { Term } from "../../guide/Term";
import { panelImageUrl } from "../../../utils/imageUrl";
import { COLOR_CODE } from "../code/snippets";
import { CielabPlane } from "../CielabPlane";
import { RgbVsLab } from "../RgbVsLab";


const distNote = (d: number) => d.toFixed(1);

export function ColorExplanation({
  closest,
  furthest,
  anchorPanel,
  all,
  pool,
}: {
  closest: NeighborInfo;
  furthest: NeighborInfo;
  anchorPanel: Panel;
  /** Every panel the anchor was compared with, plotted on the a*-b* plane. */
  all?: NeighborInfo[];
  /** The gallery, for the RGB-versus-CIELAB example colors. */
  pool?: Panel[];
}) {
  const anchorColor = anchorPanel.dominantColors?.[0];
  const closeColor = closest.panel.dominantColors?.[0];
  const farColor = furthest.panel.dominantColors?.[0];

  return (
    <>
      <Section step="rgb" code={COLOR_CODE.lab}>
        <p>
          Computer screens mix red, green, and blue light to make colors, but
          the human eye isn't equally sensitive to each channel. Two colors can
          be far apart in RGB numbers yet look almost identical, or close in
          RGB yet appear strikingly different. <Term id="cielab" first>CIELAB</Term> is a color
          space specifically designed so that equal numeric distances correspond
          to equal <Em>perceived</Em> differences. If two colors are 10 units
          apart in CIELAB, they look about as different as any other pair that's
          10 units apart, no matter where they sit on the spectrum.
        </p>
        <RgbVsLab pool={pool} />
      </Section>

      <Section step="channels" code={COLOR_CODE.palette}>
        <p>
          CIELAB describes a color with three numbers:
        </p>
        <div className="guide-channels">
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
        <p>
          Together these form a 3D space. Any color lands at a specific point
          inside it. Two panels' dominant colors become two points, and the
          question becomes: how far apart are they?
        </p>

        {anchorColor && closeColor && farColor && (
          <CielabPlane key={anchorPanel.id} anchor={anchorPanel} closest={closest} furthest={furthest} all={all} />
        )}
      </Section>

      <Section step="split" code={COLOR_CODE.split}>
        <p>
          Before sorting, panels are split into two groups: <Em>chromatic</Em>{" "}
          (color) and <Em>achromatic</Em> (black-and-white). This matters
          because even grayscale pixels can have faint chroma values in CIELAB —
          a warm paper tint or a slight scanner cast is enough to give a
          technically "gray" pixel a nonzero position on the a*/b* axes. Without
          this split, black-and-white panels would land somewhere on the hue
          spectrum and break up the flow of actual color panels.
        </p>
        <p>
          The split uses a <Term id="colorfulness" first>colorfulness score</Term> derived from the spread
          of the a* and b* channels across the image. Panels with very little
          spread (below a threshold of about 5) are classified as achromatic.
          This is an interesting case where "colorfulness" is more of a human,
          perceptual judgment than a strict property of the light — a warm-toned
          newsprint scan might technically contain color, but it reads as
          black-and-white to the eye.
        </p>
        <p>
          This partition also applies to the similarity graph: a color panel
          will only ever show other color panels as neighbors, and likewise for
          black-and-white. Cross-group comparisons are excluded entirely.
        </p>
      </Section>

      <Section step="hue" code={COLOR_CODE.hue}>
        <p>
          Within each group, panels are sorted by the <Term id="hue-angle" first>hue angle</Term> of
          their most dominant color. The hue angle is calculated
          from the a* and b* channels using the arctangent function, which
          returns an angle around the color wheel. Reds sit near 0°,
          yellows around 90°, greens near 180°, and blues near 270°.
        </p>
        <CodeBlock>
{`hue  =  atan2( b*, a* )

       ← reds → oranges → yellows → greens → blues → purples →`}
        </CodeBlock>
        <p>
          Sorting by this angle produces a natural spectrum walk: reds flow
          into oranges, then yellows, greens, and so on. Lightness is used as
          a tiebreaker when two panels have a similar hue, so darker and lighter
          variants of the same color stay near each other.
        </p>
      </Section>

      <Section step="distance" code={COLOR_CODE.distance}>
        <p>
          The similarity graph uses a different measure than the sort order: the
          straight-line <Term id="delta-e" first>Euclidean distance</Term> through the full 3D CIELAB
          space between two panels' dominant colors.
        </p>
        {anchorColor && closeColor && (
          <CodeBlock>
{`distance  =  √( ΔL*² + Δa*² + Δb*² )

closest:   √( ${fmt(anchorColor[0] - closeColor[0], 1)}² + ${fmt(anchorColor[1] - closeColor[1], 1)}² + ${fmt(anchorColor[2] - closeColor[2], 1)}² )  ≈  ${fmt(closest.distance, 2)}`}
          </CodeBlock>
        )}
        <p>
          The dashed lines in the diagram above are this distance projected
          onto the a*/b* plane. The real distance also includes the L*
          (lightness) difference, which is why the numbers may not perfectly
          match the 2D picture.
        </p>
        <p>
          The distance is computed across all palette entries, not just the
          dominant color. Each entry is weighted by its <Em>perceptual
          importance</Em>: a combination of chroma (how saturated the color is)
          and lightness (peaking at mid-tones). Near-white and near-black
          colors, the kind that come from page margins, gutters, and panel
          borders, are heavily discounted so that the actual artwork colors
          drive the result.
        </p>
      </Section>

      <Section step="result">
        <p>
          Smaller numbers mean the colors are more alike to the human eye.
          As a rough guide: a distance under ~10 is a very close match (most
          people would call them "the same color"), 10–30 is noticeably
          different, and above ~50 is quite far apart.
        </p>
        <PanelTrio
          items={[
            { src: panelImageUrl(anchorPanel.image), title: anchorPanel.title, note: "anchor", color: "var(--color-ink, #e8e0d8)" },
            { src: panelImageUrl(closest.panel.image), title: closest.panel.title, note: distNote(closest.distance), color: "var(--color-accent, #e97d62)" },
            { src: panelImageUrl(furthest.panel.image), title: furthest.panel.title, note: distNote(furthest.distance), color: "rgba(255,255,255,0.45)" },
          ]}
        />
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