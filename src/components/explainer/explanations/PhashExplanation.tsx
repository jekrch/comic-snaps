import type { Panel } from "../../../types";
import type { NeighborInfo } from "../explainerConstants";
import { truncate } from "../explainerConstants";
import { Section, CodeBlock, Em, DistanceBar } from "../explainerPrimitives";

export function PhashExplanation({
  closest,
  furthest,
  anchorPanel,
}: {
  closest: NeighborInfo;
  furthest: NeighborInfo;
  anchorPanel: Panel;
}) {
  const anchorHash = anchorPanel.phash ? String(anchorPanel.phash) : "a3c1e7…";
  const closeHash = closest.panel.phash
    ? String(closest.panel.phash)
    : "a3c1e6…";

  return (
    <>
      <Section number={1} title="Shrink and simplify">
        <p className="m-0">
          The image is scaled way down (to about 32×32), converted to grayscale,
          and run through a frequency transform that captures the big-picture
          brightness patterns while ignoring fine detail. The result is a compact
          hash, a short string of hex characters.
        </p>
        <CodeBlock>
{`"${truncate(anchorPanel.title, 20)}"  →  ${anchorHash.slice(0, 16)}…
"${truncate(closest.panel.title, 20)}"  →  ${closeHash.slice(0, 16)}…`}
        </CodeBlock>
      </Section>

      <Section number={2} title="Count the differences">
        <p className="m-0">
          Each hex character encodes 4 bits. To compare two hashes, we look at
          every bit and count how many differ. This count is the{" "}
          <Em>Hamming distance</Em>.
        </p>
        <CodeBlock>
{`hash A:  1010 0011 1100 …
hash B:  1010 0010 1100 …
              ↑
         differences = ${closest.distance.toFixed(0)} (closest)
                     = ${furthest.distance.toFixed(0)} (furthest)`}
        </CodeBlock>
        <p className="mt-2 mb-0">
          Zero differing bits would mean two images are perceptually identical.
          The more bits differ, the less the images share in terms of overall
          brightness layout.
        </p>
      </Section>

      <Section number={3} title="Reading the result">
        <p className="m-0">
          pHash is best at finding near-duplicates (distances under ~10). For
          very different images, the distances cluster together and don't tell
          you much, which is why this mode is mostly useful for spotting close
          matches.
        </p>
        <div className="mt-3">
          <DistanceBar
            closeDist={closest.distance}
            farDist={furthest.distance}
            anchorLabel={truncate(anchorPanel.title, 18)}
            closeLabel={truncate(closest.panel.title, 18)}
            farLabel={truncate(furthest.panel.title, 18)}
            maxVal={64}
            unit=" bits"
          />
        </div>
      </Section>
    </>
  );
}