import { useEffect, useState } from "react";
import type { Panel } from "../../../types";
import type { MetricKey } from "../../graph/similarityConfig";
import type { NeighborInfo } from "../explainerConstants";
import { EMBEDDING_DIM, METRIC_INFO, fmt, truncate } from "../explainerConstants";
import { Section, CodeBlock, Em, Mono, DistanceBar } from "../explainerPrimitives";
import { AngleDiagram } from "../explainerDiagrams";
import { PreprocessFigure } from "../PreprocessFigure";
import { loadEmbeddings, peekEmbeddings } from "../../../utils/sorting";

type EmbeddingMetric = "embedding-siglip" | "embedding-dino" | "embedding-gram";
type EmbeddingMap = Record<string, number[]>;

/** How each model's input is prepared; sits beside the PreprocessFigure. */
const PREPARATION: Record<EmbeddingMetric, string> = {
  "embedding-siglip":
    "SigLIP only accepts a 224 × 224 pixel square, so every panel is squashed to fit and then cut into a 14 × 14 grid of 16-pixel patches, which the model reads like words in a sentence. Squashing keeps the whole picture but stretches it, and 224 pixels is coarse, which is part of why SigLIP picks up the gist more than the fine linework.",
  "embedding-dino":
    "DINOv2 gets each panel whole and at its own shape. It's scaled so the short side is 256 pixels and then cut into a grid of 14-pixel patches, however many that takes, so a wide panel just gets a longer grid. (Out of the box, DINOv2 would crop to the centre square instead, which cut off a third or more of a typical panel.)",
  "embedding-gram":
    "VGG-16 gets the whole panel at its own shape, scaled so the short side is 448 pixels: twice the detail SigLIP gets, because hatching and line weight live in the small stuff. It doesn't cut the image into patches. Instead it slides small filters across it, layer after layer, from fine marks up to broader strokes. The Gram matrix then records which filters fire together across the whole panel and throws away where they fired. The scrambled tile is a rough picture of what survives: all the marks are still there, but their arrangement is gone.",
};

/** Gram only: where its numbers come from, since there's no single network output. */
const GRAM_REDUCTION =
  "For the Gram model those numbers aren't a network output. Four VGG-16 layers give 174,560 raw style numbers per panel, and PCA, fitted across the whole gallery, compresses them to the few directions where panels differ most. The fit is redone whenever a panel is added, so every panel's numbers shift a little as the gallery grows.";

/** How the distances this model produces are spread out in practice. */
const DISTANCE_RANGE: Record<EmbeddingMetric, string> = {
  "embedding-siglip":
    "SigLIP's distances bunch up well below 1. Every image here is a comic panel, so even the least alike pair still has a lot in common as far as SigLIP is concerned.",
  "embedding-dino":
    "DINOv2 spreads them wider, with its least alike pairs getting close to 1.",
  "embedding-gram":
    "Gram distances regularly go past 1. PCA centres the arrows on the gallery's average style, so two panels that differ from that average in opposite ways point in roughly opposite directions.",
};

const ANGLE_WORDS: Record<EmbeddingMetric, string> = {
  "embedding-siglip": "subject, composition, mood",
  "embedding-dino": "shapes, spatial layout, texture",
  "embedding-gram": "line quality, hatching, ink texture",
};

/** A vector component, sign-padded so columns line up. */
const comp = (v: number) => (v < 0 ? "" : " ") + v.toFixed(4);

/** First three and last component: "[ 0.0312, -0.1450,  0.0821, …, -0.0044]". */
function preview(vec: number[] | undefined): string {
  if (!vec || vec.length < 4) return "[ 0.0312, -0.1450,  0.0821, …, -0.0044]";
  return `[${comp(vec[0])}, ${comp(vec[1])}, ${comp(vec[2])}, …, ${comp(vec[vec.length - 1])}]`;
}

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
  const mode = metric as EmbeddingMetric;

  // The real vectors, so the worked example shows this panel's own numbers.
  // Whoever opened the explainer has almost always loaded the file already.
  const [embeddings, setEmbeddings] = useState<EmbeddingMap | null>(() => peekEmbeddings(mode));
  useEffect(() => {
    if (embeddings) return;
    let live = true;
    loadEmbeddings(mode).then((map) => {
      if (live && Object.keys(map).length > 0) setEmbeddings(map);
    });
    return () => {
      live = false;
    };
  }, [mode, embeddings]);

  const anchorVec = embeddings?.[anchorPanel.id];
  const closeVec = embeddings?.[closest.panel.id];
  const real = !!anchorVec && !!closeVec && anchorVec.length === closeVec.length;

  const dim = anchorVec?.length ?? EMBEDDING_DIM[metric] ?? 768;
  const closeDist = closest.distance;
  const farDist = furthest.distance;
  const closeSim = 1 - closeDist;
  const farSim = 1 - farDist;

  const products = real
    ? [0, 1, 2].map((i) => `(${comp(anchorVec[i])} × ${comp(closeVec[i])})`)
    : ["(0.0312 × 0.0298)", "(-0.1450 × -0.1510)", "(0.0821 × 0.0790)"];

  return (
    <>
      <Section number={1} title="Prepare the image">
        <p className="m-0">{PREPARATION[mode]}</p>
        <PreprocessFigure metric={mode} panel={anchorPanel} />
      </Section>

      <Section number={2} title="Turn each image into a direction">
        <p className="m-0">
          A neural network looks at each panel and produces {dim} numbers.
          These aren't just a list; they define an <Em>arrow</Em> (or
          vector) pointing from the origin through {dim}-dimensional space.
          Each arrow's direction encodes what the model sees in that image:{" "}
          {ANGLE_WORDS[mode]}, all compressed into orientation.
        </p>
        <CodeBlock>
{`"${truncate(anchorPanel.title, 20)}"  →  ${preview(anchorVec)}
"${truncate(closest.panel.title, 20)}"  →  ${preview(closeVec)}

        ${dim} numbers each → a direction through ${dim}D space`}
        </CodeBlock>
        {!real && (
          <p className="mt-1 mb-0 text-[9.5px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            Illustrative numbers; the real ones are still loading.
          </p>
        )}
        {mode === "embedding-gram" && <p className="mt-2 mb-0">{GRAM_REDUCTION}</p>}
        <p className="mt-2 mb-0">
          Before comparing, every arrow is scaled to the same length (a step
          called <Em>normalization</Em>). An arrow's length mostly reflects
          how strongly the network responded overall, which rises and falls
          with things like contrast and the amount of detail. Normalizing
          leaves only the direction: which features are present, and in what
          proportions.
        </p>
      </Section>

      <Section number={3} title="Measure the angle between arrows">
        <p className="m-0">
          Two images that look similar to the model get arrows pointing nearly
          the same way. To measure how aligned two arrows are, we compute
          their <Em>dot product</Em>: multiply matching numbers and add
          everything up.
        </p>
        <CodeBlock>
{`similarity  =  a[1]×b[1]  +  a[2]×b[2]  +  …  +  a[${dim}]×b[${dim}]

            =  ${products[0]}
             + ${products[1]}
             + ${products[2]}
             + …  (${dim - 3} more)

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

      <Section number={4} title="From similarity to distance">
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
          A distance of <Mono>0</Mono> means two arrows point the same way:
          the images are identical as far as {info.name} can tell.{" "}
          <Mono>1</Mono> means perpendicular, and <Mono>2</Mono> means they
          point in opposite directions. {DISTANCE_RANGE[mode]}
        </p>
        <p className="mt-2 mb-0">
          So a distance only means something next to other distances from
          the same model: a <Mono>0.4</Mono> from SigLIP and
          a <Mono>0.4</Mono> from DINOv2 aren't the same amount of alike.
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
