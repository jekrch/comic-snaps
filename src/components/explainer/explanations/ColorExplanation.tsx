import type { Panel } from "../../../types";
import type { NeighborInfo } from "../explainerConstants";
import { fmt, truncate } from "../explainerConstants";
import { Section, CodeBlock, Em, DistanceBar, PanelTrio } from "../explainerPrimitives";
import { Term } from "../../guide/Term";
import { panelImageUrl } from "../../../utils/imageUrl";
import { COLOR_CODE } from "../code/snippets";
import { CielabPlane } from "../CielabPlane";
import { PaletteDistance } from "../PaletteDistance";
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
  const plane = anchorColor && closeColor && farColor
    ? (stage: "channels" | "hue" | "distance") => (
        <CielabPlane key={anchorPanel.id} stage={stage} anchor={anchorPanel} closest={closest} furthest={furthest} all={all} />
      )
    : () => null;

  return (
    <>
      <Section step="rgb" code={COLOR_CODE.lab}>
        <p>
          Computer screens mix red, green, and blue light to make colors, but
          the human eye isn't equally sensitive to each channel. Two colors can
          be far apart in RGB numbers yet look almost identical, or close in
          RGB yet appear strikingly different. <Term id="cielab" first>CIELAB</Term> is a color
          space designed so that equal numeric distances correspond, roughly,
          to equal <Em>perceived</Em> differences: two colors 10 units apart
          should look about as different as any other pair 10 units apart,
          wherever they sit. It's an approximation (CIELAB is known to be
          uneven, especially among blues and vivid colors), but a far better
          one than RGB.
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
          inside it. Each panel is boiled down to three{" "}
          <Term id="palette" first>dominant colors</Term>, its palette, and
          each becomes a point. The question becomes: how far apart are two
          panels' points?
        </p>

        {plane("channels")}
      </Section>

      <Section step="split" code={COLOR_CODE.split}>
        <p>
          Before sorting, panels are split into two groups: <Em>chromatic</Em>{" "}
          (color) and <Em>achromatic</Em> (black-and-white). This matters
          because a black-and-white page photographed under a lamp is never
          perfectly gray: yellowed paper and warm light tint it, giving every
          pixel a little <Term id="chroma" first>chroma</Term>, a nonzero
          position on the a*/b* axes. Without the split, black-and-white panels
          would land somewhere on the hue wheel and break up the flow of actual
          color panels.
        </p>
        <p>
          So the split first takes that tint out. It measures the tint of the
          paper and of each darker shade, and subtracts it wherever it looks
          like the paper's: weak and warm, the color of old paper and lamplight.
          Then it counts the pixels that are still clearly colored, skipping
          the darkest, where black ink picks up the lamp's cast. That count, as
          a fraction of the panel, is its{" "}
          <Term id="chroma-share" first>chroma share</Term>. At 4% or more the
          panel is color; below that it's black-and-white. Muted paint and
          watercolor washes come in at 4–10%, black-and-white pages under a
          warm lamp below 3%.
        </p>
        <p>
          This partition also applies to the{" "}
          <Term id="similarity-graph" first>similarity graph</Term>: a color panel
          will only ever show other color panels as neighbors, and likewise for
          black-and-white. Cross-group comparisons are excluded entirely.
        </p>
      </Section>

      <Section step="hue" code={COLOR_CODE.hue}>
        <p>
          Color panels are then lined up by{" "}
          <Term id="hue-angle" first>hue angle</Term>: the direction of a color
          around the a*/b* plane, worked out from a* and b* with the arctangent
          function. CIELAB's angles aren't spaced like the familiar color
          wheel's: reds sit near 40°, yellows near 100°, greens near 135°, and
          blues out near 305°.
        </p>
        <CodeBlock>{`hue  =  atan2( b*, a* )`}</CodeBlock>
        <p>
          The color whose hue counts is the panel's{" "}
          <Term id="key-color" first>key color</Term>. The dominant colors
          won't do: with only three, a panel usually spends one or two on paper
          and ink, and the last averages all its real color together, so a
          red-and-green panel comes out a muddy brown. The key color is
          measured from the colored pixels themselves: the hue they peak at,
          averaged over the pixels near that peak.
        </p>
        {plane("hue")}
        <p>
          The sort walks the wheel in 30° bands, starting at its widest empty
          stretch so the seam splits no run of panels. Within a band, panels go
          by lightness rather than exact hue, alternating light-to-dark and
          dark-to-light from one band to the next so the panels either side of
          a boundary stay close. Black-and-white panels come after every color
          panel, lightest first.
        </p>
      </Section>

      <Section step="distance" code={COLOR_CODE.distance}>
        <p>
          The similarity graph uses a different measure than the sort order: the
          straight-line <Term id="delta-e" first>Euclidean distance</Term> through the full 3D CIELAB
          space between two panels' dominant colors.
        </p>
        {plane("distance")}
        {anchorColor && closeColor && (
          <CodeBlock>
{`distance  =  √( ΔL*² + Δa*² + Δb*² )

main colors only:   √( ${fmt(anchorColor[0] - closeColor[0], 1)}² + ${fmt(anchorColor[1] - closeColor[1], 1)}² + ${fmt(anchorColor[2] - closeColor[2], 1)}² )  ≈  ${fmt(Math.hypot(anchorColor[0] - closeColor[0], anchorColor[1] - closeColor[1], anchorColor[2] - closeColor[2]), 2)}`}
          </CodeBlock>
        )}
        <p>
          That's one pair of colors. The distance is computed across all
          palette entries, not just the dominant color: each panel has three,
          and they're paired up whichever way makes the two palettes closest.
          Each pair is weighted by its{" "}
          <Term id="perceptual-weight" first>perceptual weight</Term>: a
          combination of chroma (how saturated the color is), lightness
          (peaking at mid-tones), and how much of the panel the color covers.
          Near-white and near-black colors, the kind that come from page
          margins, gutters, and panel borders, are heavily discounted so that
          the actual artwork colors drive the result.
        </p>
        {anchorColor && closeColor && farColor && (
          <PaletteDistance anchor={anchorPanel} closest={closest} furthest={furthest} />
        )}
      </Section>

      <Section step="result">
        <p>
          Smaller numbers mean the colors are more alike to the human eye.
          As a rough guide: a distance under ~10 is a very close match (the
          colors would get the same name, though about 2 is the smallest
          difference most people can see), 10–30 is noticeably different, and
          above ~50 is quite far apart.
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