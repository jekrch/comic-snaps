import type { Panel } from "../../../types";
import type { MetricKey } from "../../graph/similarityConfig";
import type { NeighborInfo } from "../explainerConstants";
import { EMBEDDING_DIM, METRIC_INFO, fmt, truncate } from "../explainerConstants";
import { Section, CodeBlock, Em, Mono, DistanceBar } from "../explainerPrimitives";
import { AngleDiagram } from "../explainerDiagrams";

export function EmbeddingExplanation({
  metric,
  info,
  closest,
  furthest,
  anchorPanel,
}: {
  metric: MetricKey;
  info: (typeof METRIC_INFO)[MetricKey];
  closest: NeighborInfo;
  furthest: NeighborInfo;
  anchorPanel: Panel;
}) {
  const dim = EMBEDDING_DIM[metric] ?? 768;
  const closeDist = closest.distance;
  const farDist = furthest.distance;
  const closeSim = 1 - closeDist;
  const farSim = 1 - farDist;

  return (
    <>
      <Section number={1} title="Turn each image into a direction">
        <p className="m-0">
          A neural network looks at each panel and produces {dim} numbers.
          These aren't just a list; they define an <Em>arrow</Em> (or
          vector) pointing from the origin through {dim}-dimensional space.
          Each arrow's direction encodes what the model sees in that image
          {metric === "embedding-siglip"
            ? ": subject, composition, mood, all compressed into orientation."
            : metric === "embedding-dino"
            ? ": shapes, spatial layout, texture, all compressed into orientation."
            : ": line quality, hatching, ink texture, all compressed into orientation."}
        </p>
        <CodeBlock>
{`"${truncate(anchorPanel.title, 20)}"  →  [0.0312, -0.1450, 0.0821, …, -0.0044]
"${truncate(closest.panel.title, 20)}"  →  [0.0298, -0.1510, 0.0790, …,  0.0112]

        ${dim} numbers each → a direction through ${dim}D space`}
        </CodeBlock>
        <p className="mt-2 mb-0">
          Before comparing, every arrow is scaled to the same length (a step
          called <Em>normalization</Em>). This is important because the raw
          magnitude of the vector is an artifact of how strongly the network's
          neurons activated, not a meaningful measure of what's in the
          image. An overexposed photo and a dim one might produce vectors of
          different lengths that point the same way. Normalizing removes that
          noise so only the direction, the part that encodes actual content,
          is used for comparison.
        </p>
      </Section>

      <Section number={2} title="Measure the angle between arrows">
        <p className="m-0">
          Two images that look similar to the model get arrows pointing nearly
          the same way. To measure how aligned two arrows are, we compute
          their <Em>dot product</Em>: multiply matching numbers and add
          everything up.
        </p>
        <CodeBlock>
{`similarity  =  a[1]×b[1]  +  a[2]×b[2]  +  …  +  a[${dim}]×b[${dim}]

            =  (0.0312 × 0.0298)
             + (-0.1450 × -0.1510)
             + (0.0821 × 0.0790)
             + …

            ≈  ${fmt(closeSim)}      ← similarity score`}
        </CodeBlock>
        <p className="mt-2 mb-0">
          Because the arrows are normalized, this dot product equals
          the <Em>cosine</Em> of the angle between them. Cosine is a
          function from trigonometry that takes an angle and returns a number
          between −1 and 1. When two arrows point in the same direction
          the angle is 0° and the cosine is <Mono>1.0</Mono>.
        </p>
        <p className="mt-2">
          As the arrows spread apart the angle grows and the cosine falls
          toward <Mono>0</Mono> (perpendicular)
          or <Mono>−1</Mono> (opposite). This is why the technique is
          called <Em>cosine similarity</Em>: it uses the cosine to turn an
          angle into a single similarity score.
        </p>

        <AngleDiagram closeDist={closeDist} farDist={farDist} />

        <p
          className="mt-1 mb-0 text-center text-[9.5px]"
          style={{ color: "rgba(255,255,255,0.3)" }}
        >
          2D projection; the real arrows live in {dim} dimensions
        </p>
      </Section>

      <Section number={3} title="From similarity to distance">
        <p className="m-0">
          A similarity score is convenient, but for sorting we want
          a <Em>distance</Em> where smaller = more similar. The conversion is
          simple: subtract the similarity from 1.
        </p>
        <CodeBlock>
{`distance  =  1  −  similarity

closest neighbor:   1 − ${fmt(closeSim)}  =  ${fmt(closeDist)}
furthest neighbor:  1 − ${fmt(farSim)}  =  ${fmt(farDist)}`}
        </CodeBlock>

        <p className="mt-2 mb-0">
          A distance of <Mono>0</Mono> means two arrows point in exactly
          the same direction; the images are identical
          to {info.name}. A distance of <Mono>1</Mono> means the arrows are
          perpendicular (nothing in common). In practice, most comic panels
          land somewhere in between.
        </p>

        <div className="mt-3">
          <DistanceBar
            closeDist={closeDist}
            farDist={farDist}
            anchorLabel={truncate(anchorPanel.title, 18)}
            closeLabel={truncate(closest.panel.title, 18)}
            farLabel={truncate(furthest.panel.title, 18)}
          />
        </div>

        <p className="mt-3 mb-0">
          The <Em>closest</Em> neighbor to{" "}
          <Mono>{truncate(anchorPanel.title, 20)}</Mono>{" "}
          is{" "}
          <Mono>{truncate(closest.panel.title, 20)}</Mono>{" "}
          at distance <Mono>{fmt(closeDist)}</Mono>. The{" "}
          <Em>furthest</Em> shown is{" "}
          <Mono>{truncate(furthest.panel.title, 20)}</Mono>{" "}
          at <Mono>{fmt(farDist)}</Mono>.
        </p>
      </Section>
    </>
  );
}