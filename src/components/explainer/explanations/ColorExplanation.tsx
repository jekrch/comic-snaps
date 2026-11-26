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
import { isChromatic, matchPalettes, type PalettePair } from "../../../utils/sorting";
import { rangeText, usePoolStats } from "../../guide/galleryStats";


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
  const chromatic = isChromatic(anchorPanel);
  const stats = usePoolStats(pool);
  const bwSpread = stats?.color?.bw;
  // The matched pair that counts most toward the closest neighbour's distance.
  const topPair = (matchPalettes(
    anchorPanel.dominantColors,
    closest.panel.dominantColors,
    anchorPanel.dominantWeights,
    closest.panel.dominantWeights
  ) ?? []).reduce<PalettePair | null>(
    (best, p) => (!best || p.weight > best.weight ? p : best),
    null
  );
  const plane = anchorColor && closeColor && farColor
    ? (stage: "channels" | "hue" | "distance") => (
        <CielabPlane key={anchorPanel.id} stage={stage} anchor={anchorPanel} closest={closest} furthest={furthest} all={all} />
      )
    : () => null;

  return (
    <>
      <Section step="rgb" code={COLOR_CODE.lab}>
        <p>
          Screens make colors by mixing red, green and blue light, but the eye
          isn't equally sensitive to all three. Two colors can be far apart in
          RGB numbers and look almost the same, or close in RGB and look
          clearly different. <Term id="cielab" first>CIELAB</Term> is a color
          space designed so that equal distances roughly match equal{" "}
          <Em>perceived</Em> differences: two colors 10 units apart should look
          about as different as any other pair 10 units apart, wherever they
          sit. It doesn't fully manage that (it's known to be uneven among
          blues and vivid colors), but it comes much closer than RGB.
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
            is lightness, from <span style={{ opacity: 0.7 }}>0</span> (pure
            black) to <span style={{ opacity: 0.7 }}>100</span> (pure white)
          </div>
          <div>
            <span style={{ color: "var(--color-accent, #e97d62)" }}>a*</span>{" "}
            runs from green (negative) to red (positive)
          </div>
          <div>
            <span style={{ color: "var(--color-accent, #e97d62)" }}>b*</span>{" "}
            runs from blue (negative) to yellow (positive)
          </div>
        </div>
        <p>
          Together they make a 3D space where every color has its own point.
          Each panel is boiled down to three{" "}
          <Term id="palette" first>dominant colors</Term>, its palette: its
          pixels are sorted into three groups of similar color (a method
          called k-means) and each group is averaged. So a panel becomes
          three points. Its neighbours are the panels whose
          points sit closest to its own (step 5). The sort order works
          differently: it places each panel by a single color, measured
          another way (steps 3 and 4).
        </p>

        {plane("channels")}
      </Section>

      <Section step="split" code={COLOR_CODE.split}>
        <p>
          Before sorting, panels are split into <Em>chromatic</Em> (color) and{" "}
          <Em>achromatic</Em> (black-and-white). The split is needed because a
          black-and-white page photographed under a lamp is never perfectly
          gray. Yellowed paper and warm light tint it, so every pixel picks up
          a little <Term id="chroma" first>chroma</Term>, a nonzero position on
          the a*/b* axes. Without the split, black-and-white panels would land
          at arbitrary spots on the hue wheel, in among the real color panels.
        </p>
        <p>
          So the split first takes that tint out. It works out what the paper
          and lamp are adding, a faint yellow-orange, at each level of
          lightness from paper down to ink, and subtracts it. A tint that
          isn't weak and warm, or doesn't match the paper's, is left alone, so
          olive paint on white paper stays olive.
        </p>
        <p>
          Then it counts the pixels that are still clearly colored, ignoring
          the darkest, since black ink picks up the lamp's tint too. That
          count, as a fraction of the panel, is its{" "}
          <Term id="chroma-share" first>chroma share</Term>. At 4% or more the
          panel is color; below that it's black-and-white. Muted paint and
          watercolor washes come in at 4–10%, black-and-white pages under a
          warm lamp below 3%. (This step works in OKLab, a newer cousin of
          CIELAB built for the same job, but the idea is the same.)
        </p>
        <p>
          The <Term id="similarity-graph" first>similarity graph</Term> uses the
          same split: a color panel only ever shows color panels as neighbors,
          and a black-and-white panel only black-and-white ones.
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
          with vivid pixels counting more, averaged over the pixels near that
          peak.
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
          The similarity graph uses a different measure than the sort order:
          how far apart two panels' dominant colors sit in the full 3D CIELAB
          space. For one pair of colors that's the straight-line distance
          between them, called <Term id="delta-e" first>ΔE</Term>.
        </p>
        {plane("distance")}
        {topPair && (
          <CodeBlock>
{`ΔE  =  √( ΔL*² + Δa*² + Δb*² )

the pair that counts most:   √( ${fmt(topPair.a[0] - topPair.b[0], 1)}² + ${fmt(topPair.a[1] - topPair.b[1], 1)}² + ${fmt(topPair.a[2] - topPair.b[2], 1)}² )  ≈  ${fmt(topPair.distance, 2)}`}
          </CodeBlock>
        )}
        <p>
          That's one pair of colors. Each panel has three, and they're paired
          up whichever way makes the two palettes closest. The panel's distance
          is the average of the pairs' ΔE, each pair weighted by its{" "}
          <Term id="perceptual-weight" first>perceptual weight</Term>: a
          combination of chroma (how saturated the color is), lightness
          (peaking at mid-tones), and how much of the panel the color covers.
          Near-white and near-black colors, the kind that come from page
          margins, gutters, and panel borders, are heavily discounted, so the
          colors of the art itself decide the result.
        </p>
        {anchorColor && closeColor && farColor && (
          <PaletteDistance anchor={anchorPanel} closest={closest} furthest={furthest} />
        )}
      </Section>

      <Section step="result">
        {chromatic ? (
          <p>
            Smaller numbers mean the colors are more alike to the human eye.
            As a rough guide: a distance under ~10 is a very close match (the
            colors would get the same name, though about 2 is the smallest
            difference most people can see), 10–30 is noticeably different, and
            above ~50 is quite far apart.
          </p>
        ) : (
          <p>
            Smaller numbers mean more alike. This anchor is black-and-white, so
            it's only compared with other black-and-white panels, whose
            palettes differ mostly in lightness: paper, ink and grays. Their
            distances run small
            {bwSpread ? `, with most pairs between ${rangeText(bwSpread, 0)}` : ""}, so
            even a gap under 10 can be a real difference in tone. Read these
            numbers against each other, not against the color panels'.
          </p>
        )}
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
            maxVal={chromatic ? Math.max(furthest.distance * 1.2, 80) : furthest.distance * 1.2}
          />
        </div>
      </Section>
    </>
  );
}