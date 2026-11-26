import { useEffect, useMemo, useState } from "react";
import type { Panel } from "../../../types";
import type { NeighborInfo } from "../explainerConstants";
import { EMBEDDING_DIM, METRIC_INFO, fmt, truncate } from "../explainerConstants";
import { Section, Layer, CodeBlock, Em, Mono, DistanceBar, NeighbourBar, PanelTrio, Caption } from "../explainerPrimitives";
import { NeighbourGuess } from "../Guess";
import { AngleDiagram } from "../explainerDiagrams";
import { PreprocessFigure } from "../PreprocessFigure";
import { TransformerExamples } from "../TransformerFigures";
import { VectorStrips } from "../VectorStrips";
import type { PatchModel } from "../patchMaps";
import { loadEmbeddings, peekEmbeddings } from "../../../utils/sorting";
import { panelImageUrl } from "../../../utils/imageUrl";
import { EMBEDDING_CODE } from "../code/snippets";
import { Term } from "../../guide/Term";
import { GuideLink, Recap } from "../../guide/GuideLink";
import { useAllEmbeddings } from "../../guide/specimen";
import { percent, rangeText, useEmbeddingStats, type Spread } from "../../guide/galleryStats";

export type EmbeddingMetric = "embedding-siglip" | "embedding-dino" | "embedding-gram";
type EmbeddingMap = Record<string, number[]>;

/** How each model's input is prepared; sits beside the PreprocessFigure. */
const PREPARATION: Record<EmbeddingMetric, React.ReactNode> = {
  "embedding-siglip": (
    <>
      SigLIP is a <Term id="vision-language" first>vision-language</Term> model, trained on images paired with their
      captions. It only accepts a 224 × 224 pixel square, so every panel is squashed to fit and then cut into a 14 × 14
      grid of 16-pixel <Term id="patch" first>patches</Term>, which the model reads like words in a sentence.
      Squashing keeps the whole picture but stretches it, and 224 pixels is coarse, which is part of why SigLIP picks
      up the gist more than the fine linework.
    </>
  ),
  "embedding-dino": (
    <>
      DINOv2 is <Term id="self-supervised" first>self-supervised</Term>: it learned from pictures alone, with no
      captions or labels. It gets each panel whole and at its own shape, scaled so the short side is about 256 pixels
      (rounded to fit whole patches) and then cut into a grid of 14-pixel <Term id="patch">patches</Term>, however
      many that takes, so a wide panel just gets a longer grid. (Out of the box, DINOv2 would crop to the centre
      square instead, which would cut off a third or more of a typical panel.)
    </>
  ),
  "embedding-gram": (
    <>
      <Term id="vgg16" first>VGG-16</Term>, a network built to name what's in a photo, gets the whole panel at its
      own shape, scaled so the short side is 448 pixels: twice the detail SigLIP
      gets, because hatching and line weight live in the small stuff. It doesn't cut the image into patches. Instead
      it slides small <Term id="filter" first>filters</Term> across it, layer after layer, from fine marks up to
      broader strokes. The <Term id="gram" first>Gram matrix</Term> then records which filters fire together across
      the whole panel and throws away where they fired. The scrambled tile is a rough picture of what survives: all
      the marks are still there, but their arrangement is gone.
    </>
  ),
};

/** The same, in a sentence: each model lesson's Essentials. */
const PREPARE_ESSENTIALS: Record<EmbeddingMetric, React.ReactNode> = {
  "embedding-siglip": (
    <>
      SigLIP squashes every panel into a 224-pixel square and cuts it into a 14 × 14 grid of{" "}
      <Term id="patch">patches</Term>, which it reads like words in a sentence.
    </>
  ),
  "embedding-dino": (
    <>
      DINOv2 keeps each panel's own shape and cuts it into 14-pixel <Term id="patch">patches</Term>, as many as that
      takes.
    </>
  ),
  "embedding-gram": (
    <>
      VGG-16 reads the panel at twice SigLIP's detail and slides small <Term id="filter">filters</Term> over it. The{" "}
      <Term id="gram">Gram matrix</Term> keeps which marks turn up together and throws away where, like the scrambled
      tile.
    </>
  ),
};

/** Gram only: where its numbers come from, since there's no single network output. */
const GRAM_REDUCTION = (
  <>
    For the Gram model those numbers aren't a network output. Four VGG-16 layers give 174,560 raw style numbers per
    panel, and <Term id="pca" first>PCA</Term>, fitted across the whole gallery, compresses them to the few directions
    where panels differ most. The fit is redone whenever a panel is added, so every panel's numbers shift a little as
    the gallery grows.
  </>
);

/** How the distances this model produces are spread out in practice; the fallback for `distanceRange`. */
const DISTANCE_RANGE: Record<EmbeddingMetric, string> = {
  "embedding-siglip":
    "SigLIP's distances bunch up well below 1. Partly that's the gallery: every image here is a comic panel, so even the least alike pair still has a lot in common as far as SigLIP is concerned. Partly it's the model: image-and-caption models are known to crowd all their arrows into a narrow cone, so even unrelated pictures never point far apart.",
  "embedding-dino":
    "DINOv2 spreads them wider, with its least alike pairs getting close to 1.",
  "embedding-gram":
    "About half of all Gram pairs are past 1, so a typical pair sits near 1, at right angles. PCA centres the arrows on the gallery's average style, so two panels that differ from that average in opposite ways point in roughly opposite directions.",
};

/** `DISTANCE_RANGE`, with the gallery's own numbers once they're measured. */
function distanceRange(mode: EmbeddingMetric, s: Spread | undefined): string {
  if (!s) return DISTANCE_RANGE[mode];
  const most = rangeText(s);
  switch (mode) {
    case "embedding-siglip":
      return `SigLIP's distances bunch up well below 1: most pairs fall between ${most}. Partly that's the gallery: every image here is a comic panel, so even the least alike pair still has a lot in common as far as SigLIP is concerned. Partly it's the model: image-and-caption models are known to crowd all their arrows into a narrow cone, so even unrelated pictures never point far apart.`;
    case "embedding-dino":
      return `DINOv2 spreads them wider, with most pairs between ${most} and its least alike getting close to 1.`;
    case "embedding-gram":
      return `Most Gram pairs fall between ${most}, and ${percent(s.overOne)} are past 1, so a typical pair sits near 1, at right angles. PCA centres the arrows on the gallery's average style, so two panels that differ from that average in opposite ways point in roughly opposite directions.`;
  }
}

/**
 * Why distances from different models can't be compared, with each model's
 * median pair once the gallery is measured.
 */
function ModelScales() {
  const maps = useAllEmbeddings(true);
  const siglip = useEmbeddingStats(maps["embedding-siglip"]);
  const dino = useEmbeddingStats(maps["embedding-dino"]);
  const gram = useEmbeddingStats(maps["embedding-gram"]);
  if (!siglip || !dino || !gram) {
    return (
      <p>
        Each model spreads its distances differently, so a distance only means something next to other distances
        from the same model: a <Mono>0.4</Mono> from SigLIP and a <Mono>0.4</Mono> from DINOv2 aren't the same
        amount of alike.
      </p>
    );
  }
  return (
    <p>
      Each model spreads its distances differently. Across the gallery, a typical pair of panels sits{" "}
      <Mono>{fmt(siglip.spread.mid, 2)}</Mono> apart by SigLIP, <Mono>{fmt(dino.spread.mid, 2)}</Mono> by DINOv2
      and <Mono>{fmt(gram.spread.mid, 2)}</Mono> by the Gram model. So a distance only means something next to
      other distances from the same model: the same number can be an ordinary pair from one and a close one from
      another.
    </p>
  );
}

/** The two transformers get the "patches compare notes" section; VGG-16 isn't one. */
const TRANSFORMER: Partial<Record<EmbeddingMetric, { key: PatchModel; name: string }>> = {
  "embedding-siglip": { key: "siglip", name: "SigLIP" },
  "embedding-dino": { key: "dino", name: "DINOv2" },
};

/** How many of a vector's numbers the cell strips show. */
const STRIP_CELLS = 96;

export const ANGLE_WORDS: Record<EmbeddingMetric, string> = {
  "embedding-siglip": "subject, composition, mood",
  "embedding-dino": "shapes, spatial layout, texture",
  "embedding-gram": "line quality, hatching, ink texture",
};

/**
 * How far a dimension's gallery-wide mean must sit from zero, in standard
 * deviations, to count as fixed: high for every panel alike. SigLIP has three
 * (78, 153, 759, all above 9σ); DINOv2 and the Gram PCA have none above 3σ.
 */
const FIXED_SIGMAS = 5;

/** Indices below `n` whose value is near-constant across the gallery. */
function fixedDims(embeddings: EmbeddingMap | null, n: number): number[] {
  const vecs = embeddings ? Object.values(embeddings) : [];
  if (vecs.length < 10) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let sq = 0;
    for (const v of vecs) {
      sum += v[i];
      sq += v[i] * v[i];
    }
    const mean = sum / vecs.length;
    const sd = Math.sqrt(Math.max(0, sq / vecs.length - mean * mean));
    if (Math.abs(mean) > FIXED_SIGMAS * sd) out.push(i);
  }
  return out;
}

/** How many of the first `n` components share a sign. */
function signMatches(a: number[], b: number[], n: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (Math.sign(a[i]) === Math.sign(b[i])) k++;
  return k;
}

/** "the 79th" style ordinal for a 0-based index, counted from 1. */
function ordinal(i: number): string {
  const n = i + 1;
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** A vector component, sign-padded so columns line up. */
const comp = (v: number) => (v < 0 ? "" : " ") + v.toFixed(4);

/** First three and last component: "[ 0.0312, -0.1450,  0.0821, …, -0.0044]". */
function preview(vec: number[] | undefined): string {
  if (!vec || vec.length < 4) return "[ 0.0312, -0.1450,  0.0821, …, -0.0044]";
  return `[${comp(vec[0])}, ${comp(vec[1])}, ${comp(vec[2])}, …, ${comp(vec[vec.length - 1])}]`;
}

export interface WorkedProps {
  closest: NeighborInfo;
  furthest: NeighborInfo;
  anchorPanel: Panel;
}

/**
 * The anchor's real vectors and everything worked out from them. Whoever
 * opened the Guide has usually loaded the file already.
 */
export function useWorkedNumbers(mode: EmbeddingMetric, { anchorPanel, closest, furthest }: WorkedProps) {
  const [embeddings, setEmbeddings] = useState<EmbeddingMap | null>(() => peekEmbeddings(mode));
  useEffect(() => {
    const have = peekEmbeddings(mode);
    if (have) {
      setEmbeddings(have);
      return;
    }
    let live = true;
    loadEmbeddings(mode).then((map) => {
      if (live && Object.keys(map).length > 0) setEmbeddings(map);
    });
    return () => {
      live = false;
    };
  }, [mode]);

  const anchorVec = embeddings?.[anchorPanel.id];
  const closeVec = embeddings?.[closest.panel.id];
  const farVec = embeddings?.[furthest.panel.id];
  const real = !!anchorVec && !!closeVec && anchorVec.length === closeVec.length;
  const dim = anchorVec?.length ?? EMBEDDING_DIM[mode] ?? 768;
  const stripN = Math.min(dim, STRIP_CELLS);
  const strips = real && !!farVec && farVec.length === anchorVec.length;
  const stripScope = stripN === dim ? `All ${dim} numbers` : `First ${stripN} of ${dim} numbers`;
  const fixed = useMemo(() => fixedDims(embeddings, stripN), [embeddings, stripN]);
  const closeMatches = strips ? signMatches(anchorVec, closeVec, stripN) : 0;
  const farMatches = strips && farVec ? signMatches(anchorVec, farVec, stripN) : 0;
  const products = real
    ? [0, 1, 2].map((i) => `(${comp(anchorVec[i])} × ${comp(closeVec[i])})`)
    : ["(0.0312 × 0.0298)", "(-0.1450 × -0.1510)", "(0.0821 × 0.0790)"];
  return {
    anchorVec,
    closeVec,
    farVec,
    real,
    strips,
    dim,
    stripN,
    stripScope,
    fixed,
    closeMatches,
    farMatches,
    products,
    closeDist: closest.distance,
    farDist: furthest.distance,
    closeSim: 1 - closest.distance,
    farSim: 1 - furthest.distance,
  };
}

export type Worked = ReturnType<typeof useWorkedNumbers>;

// Blocks shared by the Vectors lesson and the model lessons. Each takes the
// worked numbers, so the same figure reads off whichever model's vectors.

function VectorPreview({ w, anchorPanel, closest }: { w: Worked } & Pick<WorkedProps, "anchorPanel" | "closest">) {
  return (
    <>
      <CodeBlock>
{`"${truncate(anchorPanel.title, 20)}"  →  ${preview(w.anchorVec)}
"${truncate(closest.panel.title, 20)}"  →  ${preview(w.closeVec)}

        ${w.dim} numbers each → a direction through ${w.dim}D space`}
      </CodeBlock>
      {!w.real && <Caption>Illustrative numbers; the real ones are still loading.</Caption>}
    </>
  );
}

/** Caption sentence for the fixed dimensions on show, or "" when none are. */
function fixedNote(w: Worked, what: string): string {
  if (w.fixed.length === 0) return "";
  const cells = w.fixed.length === 1 ? `cell (the ${ordinal(w.fixed[0])})` : "cells";
  const verb = w.fixed.length === 1 ? "is" : "are";
  return ` The bright ${cells} in the same spot on every row ${verb} ${what} for every panel in the gallery. That's a quirk of the model rather than anything these panels have in common, and it adds the same amount to every pair's similarity, which is part of why the distances bunch up.`;
}

export function ValueStrips({ w, anchorPanel, closest, furthest }: { w: Worked } & WorkedProps) {
  if (!w.strips || !w.anchorVec || !w.closeVec || !w.farVec) return null;
  return (
    <VectorStrips
      caption={`${w.stripScope}, one cell each. Orange is positive, blue is negative; brighter is bigger. Read down the columns: the closest panel's cells match the anchor's colour more often than the furthest one's do, and the count says how many of the ${w.stripN} match.${fixedNote(w, "that high")}`}
      rows={[
        { label: truncate(anchorPanel.title, 28), note: "anchor", color: "var(--color-ink, #e8e0d8)", values: w.anchorVec.slice(0, w.stripN) },
        { label: truncate(closest.panel.title, 28), note: `closest · ${w.closeMatches}/${w.stripN} match`, color: "var(--color-accent, #e97d62)", values: w.closeVec.slice(0, w.stripN) },
        { label: truncate(furthest.panel.title, 28), note: `furthest · ${w.farMatches}/${w.stripN} match`, color: "rgba(255,255,255,0.45)", values: w.farVec.slice(0, w.stripN) },
      ]}
    />
  );
}

function DotProduct({ w }: { w: Worked }) {
  return (
    <>
      <CodeBlock>
{`similarity  =  a[1]×b[1]  +  a[2]×b[2]  +  …  +  a[${w.dim}]×b[${w.dim}]

            =  ${w.products[0]}
             + ${w.products[1]}
             + ${w.products[2]}
             + …  (${w.dim - 3} more)

            ≈  ${fmt(w.closeSim)}      ← similarity score`}
      </CodeBlock>
      {w.strips && w.anchorVec && w.closeVec && w.farVec && (
        <VectorStrips
          caption={`The multiplications as cells (${w.stripScope.toLowerCase()}). Orange where the two numbers share a sign, blue where they don't. The similarity is the total of all ${w.dim}.${w.fixed.length ? " The bright cell in both rows is the model's fixed dimension again: it adds about the same to both totals, so it can't tell the two apart." : ""}`}
          rows={[
            {
              label: "anchor × closest",
              note: `total ${fmt(w.closeSim)}`,
              color: "var(--color-accent, #e97d62)",
              values: w.anchorVec.slice(0, w.stripN).map((v, i) => v * w.closeVec![i]),
            },
            {
              label: "anchor × furthest",
              note: `total ${fmt(w.farSim)}`,
              color: "rgba(255,255,255,0.45)",
              values: w.anchorVec.slice(0, w.stripN).map((v, i) => v * w.farVec![i]),
            },
          ]}
        />
      )}
    </>
  );
}

export function Angle({ w }: { w: Worked }) {
  return (
    <>
      <AngleDiagram closeDist={w.closeDist} farDist={w.farDist} />
      <Caption className="text-center">2D projection; the real arrows live in {w.dim} dimensions</Caption>
    </>
  );
}

function DistanceSum({ w }: { w: Worked }) {
  return (
    <CodeBlock>
{`distance  =  1  −  similarity

closest neighbor:   1 − ${fmt(w.closeSim)}  =  ${fmt(w.closeDist)}
furthest neighbor:  1 − ${fmt(w.farSim)}  =  ${fmt(w.farDist)}`}
    </CodeBlock>
  );
}

function NeighbourResult({ w, anchorPanel, closest, furthest }: { w: Worked } & WorkedProps) {
  return (
    <>
      <PanelTrio
        items={[
          { src: panelImageUrl(anchorPanel.image), title: anchorPanel.title, note: "anchor", color: "var(--color-ink, #e8e0d8)" },
          { src: panelImageUrl(closest.panel.image), title: closest.panel.title, note: fmt(w.closeDist), color: "var(--color-accent, #e97d62)" },
          { src: panelImageUrl(furthest.panel.image), title: furthest.panel.title, note: fmt(w.farDist), color: "rgba(255,255,255,0.45)" },
        ]}
      />
      <div className="mt-3">
        <DistanceBar
          closeDist={w.closeDist}
          farDist={w.farDist}
          anchorLabel={truncate(anchorPanel.title, 18)}
          closeLabel={truncate(closest.panel.title, 18)}
          farLabel={truncate(furthest.panel.title, 18)}
        />
      </div>
      <p>
        The <Em>closest</Em> neighbor to <Mono>{truncate(anchorPanel.title, 20)}</Mono> is{" "}
        <Mono>{truncate(closest.panel.title, 20)}</Mono> at distance <Mono>{fmt(w.closeDist)}</Mono>. The{" "}
        <Em>furthest</Em> shown is <Mono>{truncate(furthest.panel.title, 20)}</Mono> at{" "}
        <Mono>{fmt(w.farDist)}</Mono>.
      </p>
    </>
  );
}

/**
 * The shared theory: lists of numbers as arrows, normalization, the dot
 * product as cosine, and 1 − cosine as distance. Told once, with SigLIP's
 * numbers for the reader's anchor; each model lesson recaps it and links here.
 */
export function VectorsExplanation(props: WorkedProps) {
  const { anchorPanel, closest, furthest } = props;
  const w = useWorkedNumbers("embedding-siglip", props);
  const code = EMBEDDING_CODE["embedding-siglip"];
  return (
    <>
      <Section step="arrows">
        <Layer>
          <p>
            Each neural model turns a panel into a list of numbers, its <Term id="embedding">embedding</Term>, and reads
            the list as an <Term id="vector">arrow</Term> through {w.dim}-dimensional space.
            {w.strips && " Here are SigLIP's for your panel and two others. Which row looks more like the top one?"}
          </p>
          <ValueStrips w={w} {...props} />
        </Layer>
        <Layer>
          <p>
            SigLIP, DINOv2 and the Gram model all end the same way: each panel becomes a list of numbers, its{" "}
            <Term id="embedding" first>embedding</Term>, and two panels are compared by comparing their lists. The
            examples on this page use SigLIP's {w.dim} numbers for your anchor panel.
          </p>
          <VectorPreview w={w} anchorPanel={anchorPanel} closest={closest} />
          <p>
            Read as coordinates, the {w.dim} numbers mark a point, and the <Term id="vector" first>arrow</Term> (or
            vector) from the origin to that point stands for the panel. Nobody can picture {w.dim}{" "}
            <Term id="dimension" first>dimensions</Term>, but the maths is the same as for arrows on paper. It's the
            arrow's direction that holds what the model sees in the image.
          </p>
          {w.strips && (
            <>
              <p>
                Here are the same numbers as cells. Compare the closest panel's row with the anchor's, then the
                furthest panel's.
              </p>
              <ValueStrips w={w} {...props} />
            </>
          )}
        </Layer>
      </Section>

      <Section step="normalize" code={code.direction}>
        <Layer>
          <p>Every arrow is stretched or shrunk to the same length, so only its direction counts.</p>
        </Layer>
        <Layer>
          <p>
            Before comparing, every arrow is scaled to the same length (a step called{" "}
            <Term id="normalization" first>normalization</Term>). An arrow's length partly reflects how strongly the
            network responded overall, which rises and falls with things like contrast and the amount of detail.
            Normalizing leaves only the direction: which features are present, and in what proportions.
          </p>
        </Layer>
      </Section>

      <Section step="dot" code={code.angle}>
        <Layer>
          <p>
            Multiply matching numbers and add them up: that's the <Term id="dot-product">dot product</Term>, and for
            same-length arrows it's the cosine of the angle between them. 1 means they point the same way.
          </p>
          <Angle w={w} />
        </Layer>
        <Layer>
          <p>
            Two images that look similar to the model get arrows pointing nearly the same way. To measure how aligned
            two arrows are, we compute their <Term id="dot-product" first>dot product</Term>: multiply matching
            numbers and add everything up.
          </p>
          <DotProduct w={w} />
          <p>
            Because the arrows are normalized, this dot product equals the <Em>cosine</Em> of the angle between them.
            Cosine is a function from trigonometry that takes an angle and returns a number between −1 and 1. When two
            arrows point in the same direction the angle is 0° and the cosine is <Mono>1.0</Mono>.
          </p>
          <p>
            As the arrows spread apart the angle grows and the cosine falls toward <Mono>0</Mono> (perpendicular)
            or <Mono>−1</Mono> (opposite). Hence the name <Term id="cosine" first>cosine similarity</Term>: the
            cosine turns the angle into a single score.
          </p>
          <Angle w={w} />
        </Layer>
      </Section>

      <Section step="distance" code={code.distance}>
        <Layer>
          <p>
            Distance is 1 minus that: 0 when the arrows point the same way, 1 at right angles. Only compare it with
            other distances from the
            same model.
          </p>
          <NeighbourGuess anchor={anchorPanel} closest={closest} furthest={furthest} method="SigLIP" format={(d) => fmt(d, 3)}>
            <NeighbourBar anchor={anchorPanel} closest={closest} furthest={furthest} />
          </NeighbourGuess>
          <p>
            Each model lesson runs this on its own numbers: <GuideLink to="siglip">SigLIP</GuideLink>,{" "}
            <GuideLink to="dino">DINOv2</GuideLink> and <GuideLink to="gram">the Gram model</GuideLink>.
          </p>
        </Layer>
        <Layer>
          <p>
            Sorting is easier with a <Term id="distance" first>distance</Term>, where smaller means more similar, so
            the similarity is subtracted from 1.
          </p>
          <DistanceSum w={w} />
          <p>
            A distance of <Mono>0</Mono> means two arrows point the same way: the images are identical as far as the
            model can tell. <Mono>1</Mono> means perpendicular, and <Mono>2</Mono> means they point in opposite
            directions.
          </p>
          <ModelScales />
          <NeighbourResult w={w} {...props} />
          <p>
            Each model lesson works the same steps through its own numbers:{" "}
            <GuideLink to="siglip">SigLIP</GuideLink>, <GuideLink to="dino">DINOv2</GuideLink> and{" "}
            <GuideLink to="gram">the Gram model</GuideLink>.
          </p>
        </Layer>
      </Section>
    </>
  );
}

/**
 * One model's lesson: how it prepares the image and (for the transformers)
 * what its layers do, then its own worked numbers through the steps the
 * Vectors lesson explains.
 */
export function EmbeddingExplanation({
  metric,
  closest,
  furthest,
  anchorPanel,
}: {
  metric: EmbeddingMetric;
} & WorkedProps) {
  const mode = metric;
  const info = METRIC_INFO[mode];
  const props = { anchorPanel, closest, furthest };
  const w = useWorkedNumbers(mode, props);
  const maps = useAllEmbeddings(true);
  const stats = useEmbeddingStats(maps[mode]);
  const transformer = TRANSFORMER[mode];
  const shortName = metric === "embedding-gram" ? "the Gram model" : info.name;
  const code = EMBEDDING_CODE[mode];

  return (
    <>
      <Section step="prepare" code={code.prepare}>
        <Layer>
          <p>{PREPARE_ESSENTIALS[metric]}</p>
          <PreprocessFigure metric={metric} panel={anchorPanel} />
        </Layer>
        <Layer>
          <p>{PREPARATION[mode]}</p>
          <PreprocessFigure metric={mode} panel={anchorPanel} />
        </Layer>
      </Section>

      {transformer && (
        <Section step="attention" code={code.patches}>
          <Layer>
            <p>
              Over 12 <Term id="layer">layers</Term>, every patch looks at every other and borrows from the ones that
              matter to it (<Term id="attention">attention</Term>). By the end, a patch's numbers describe the figure it
              belongs to as well as its own pixels.
            </p>
          </Layer>
          <Layer>
            <p>
              {transformer.name} is a <Term id="transformer" first>transformer</Term>: it reads the patches the way a
              language model reads words. Each patch becomes a <Term id="token" first>token</Term>, starting as{" "}
              {w.dim} numbers that describe only its own pixels and where it sits in the grid. Then come 12 rounds, called{" "}
              <Term id="layer" first>layers</Term>. In every layer, each patch compares itself with every other patch,
              weighs which ones matter to it (a step called <Term id="attention" first>attention</Term>), and folds
              some of what they hold into its own numbers.
            </p>

            <TransformerExamples model={transformer.key} modelName={transformer.name} dim={w.dim} />
          </Layer>
        </Section>
      )}

      <Section step="arrows" code={code.direction}>
        <Layer>
          <p>
            Out come {w.dim} numbers: an <Term id="vector">arrow</Term> whose direction holds what {shortName} sees,{" "}
            {ANGLE_WORDS[metric]}.
          </p>
        </Layer>
        <Layer>
          <p>
            {transformer ? (
              <>
                For every panel, the patches' final numbers are <Term id="pooling" first>pooled</Term> into one list
                of {w.dim}.
              </>
            ) : (
              `Each panel ends up as ${w.dim} numbers.`
            )}{" "}
            They define an <Term id="vector">arrow</Term> through {w.dim}-dimensional space, and its direction holds
            what {info.name} picks up from the image: {ANGLE_WORDS[mode]}.
          </p>
          <VectorPreview w={w} anchorPanel={anchorPanel} closest={closest} />
          {w.strips && (
            <>
              <p>
                Here are the same numbers as cells. Compare the closest panel's row with the anchor's, then the
                furthest panel's.
              </p>
              <ValueStrips w={w} {...props} />
            </>
          )}
          {mode === "embedding-gram" && <p>{GRAM_REDUCTION}</p>}
          <Recap to="vectors" step="normalize" label="Vectors › Normalization">
            Before comparing, every arrow is scaled to length 1 (<Term id="normalization">normalization</Term>), so only
            its direction counts.
          </Recap>
        </Layer>
      </Section>

      <Section step="angle" code={code.angle}>
        <Layer>
          <p>
            Two panels are compared by the angle between their arrows, as in <GuideLink to="vectors">Vectors</GuideLink>
            : the narrower, the more alike.
          </p>
          <Angle w={w} />
        </Layer>
        <Layer>
          <Recap to="vectors" step="dot" label="Vectors › Dot product">
            Two arrows are compared by their <Term id="dot-product">dot product</Term>: multiply matching numbers and add
            everything up. Because the arrows have length 1, the total is the cosine of the angle between them.
          </Recap>
          <p>
            Here it is for the anchor and its closest neighbour, with {info.name}'s {w.dim} numbers:
          </p>
          <DotProduct w={w} />
          <Angle w={w} />
        </Layer>
      </Section>

      <Section step="distance" code={code.distance}>
        <Layer>
          <NeighbourGuess
            anchor={anchorPanel}
            closest={closest}
            furthest={furthest}
            method={shortName}
            format={(d) => fmt(d, 3)}
            why={`It's looking at ${ANGLE_WORDS[metric]}.`}
          >
            <NeighbourBar anchor={anchorPanel} closest={closest} furthest={furthest} />
          </NeighbourGuess>
        </Layer>
        <Layer>
          <p>
            For sorting, the similarity is turned into a <Term id="distance">distance</Term>, where smaller means more
            similar, by subtracting it from 1.
          </p>
          <DistanceSum w={w} />
          <p>
            A distance of <Mono>0</Mono> means two arrows point the same way: the images are identical as far as{" "}
            {info.name} can tell. <Mono>1</Mono> means perpendicular, and <Mono>2</Mono> means they point in opposite
            directions. {distanceRange(mode, stats?.spread)}
          </p>
          <ModelScales />
          <NeighbourResult w={w} {...props} />
        </Layer>
      </Section>
    </>
  );
}

/** What the overview's comparison table says about each embedding model. */
export const EMBEDDING_FACTS: Record<EmbeddingMetric, { looksAt: string; range: string }> = {
  "embedding-siglip": { looksAt: ANGLE_WORDS["embedding-siglip"], range: DISTANCE_RANGE["embedding-siglip"] },
  "embedding-dino": { looksAt: ANGLE_WORDS["embedding-dino"], range: DISTANCE_RANGE["embedding-dino"] },
  "embedding-gram": { looksAt: ANGLE_WORDS["embedding-gram"], range: DISTANCE_RANGE["embedding-gram"] },
};
