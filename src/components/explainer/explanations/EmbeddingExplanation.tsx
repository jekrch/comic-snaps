import { useEffect, useMemo, useState } from "react";
import type { Panel } from "../../../types";
import type { NeighborInfo } from "../explainerConstants";
import { EMBEDDING_DIM, METRIC_INFO, fmt, truncate } from "../explainerConstants";
import { Section, CodeBlock, Em, Mono, DistanceBar, PanelTrio, Caption } from "../explainerPrimitives";
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
      captions or labels. It gets each panel whole and at its own shape, scaled so the short side is 256 pixels and then cut
      into a grid of 14-pixel <Term id="patch">patches</Term>, however many that takes, so a wide panel just gets a
      longer grid. (Out of the box, DINOv2 would crop to the centre square instead, which cut off a third or more of
      a typical panel.)
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

/** Gram only: where its numbers come from, since there's no single network output. */
const GRAM_REDUCTION = (
  <>
    For the Gram model those numbers aren't a network output. Four VGG-16 layers give 174,560 raw style numbers per
    panel, and <Term id="pca" first>PCA</Term>, fitted across the whole gallery, compresses them to the few directions
    where panels differ most. The fit is redone whenever a panel is added, so every panel's numbers shift a little as
    the gallery grows.
  </>
);

/** How the distances this model produces are spread out in practice. */
const DISTANCE_RANGE: Record<EmbeddingMetric, string> = {
  "embedding-siglip":
    "SigLIP's distances bunch up well below 1. Every image here is a comic panel, so even the least alike pair still has a lot in common as far as SigLIP is concerned.",
  "embedding-dino":
    "DINOv2 spreads them wider, with its least alike pairs getting close to 1.",
  "embedding-gram":
    "Gram distances regularly go past 1. PCA centres the arrows on the gallery's average style, so two panels that differ from that average in opposite ways point in roughly opposite directions.",
};

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
  return ` The bright ${cells} in the same spot on every row ${verb} ${what} for every panel in the gallery: a quirk of the model, not something these panels share. It adds the same amount to every pair's similarity, which is part of why the distances bunch up.`;
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
  const { anchorPanel, closest } = props;
  const w = useWorkedNumbers("embedding-siglip", props);
  const code = EMBEDDING_CODE["embedding-siglip"];
  return (
    <>
      <Section step="arrows">
        <p>
          SigLIP, DINOv2 and the Gram model all end the same way: each panel becomes a list of numbers, its{" "}
          <Term id="embedding" first>embedding</Term>, and two panels are compared by comparing their lists. The
          examples on this page use SigLIP's {w.dim} numbers for your anchor panel.
        </p>
        <VectorPreview w={w} anchorPanel={anchorPanel} closest={closest} />
        <p>
          These aren't just a list; they define an <Term id="vector" first>arrow</Term> (or vector) pointing from the
          origin through {w.dim}-<Term id="dimension" first>dimensional</Term> space. Each arrow's direction encodes
          what the model sees in that image, all compressed into orientation.
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
      </Section>

      <Section step="normalize" code={code.direction}>
        <p>
          Before comparing, every arrow is scaled to the same length (a step called{" "}
          <Term id="normalization" first>normalization</Term>). An arrow's length mostly reflects how strongly the
          network responded overall, which rises and falls with things like contrast and the amount of detail.
          Normalizing leaves only the direction: which features are present, and in what proportions.
        </p>
      </Section>

      <Section step="dot" code={code.angle}>
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
          or <Mono>−1</Mono> (opposite). This is why the technique is called{" "}
          <Term id="cosine" first>cosine similarity</Term>: it uses the cosine to turn an angle into a single
          similarity score.
        </p>
        <Angle w={w} />
      </Section>

      <Section step="distance" code={code.distance}>
        <p>
          A similarity score is convenient, but for sorting we want a <Term id="distance" first>distance</Term> where
          smaller = more similar. The conversion is simple: subtract the similarity from 1.
        </p>
        <DistanceSum w={w} />
        <p>
          A distance of <Mono>0</Mono> means two arrows point the same way: the images are identical as far as the
          model can tell. <Mono>1</Mono> means perpendicular, and <Mono>2</Mono> means they point in opposite
          directions.
        </p>
        <p>
          So a distance only means something next to other distances from the same model: a <Mono>0.4</Mono> from
          SigLIP and a <Mono>0.4</Mono> from DINOv2 aren't the same amount of alike.
        </p>
        <NeighbourResult w={w} {...props} />
        <p>
          Each model lesson works the same steps through its own numbers:{" "}
          <GuideLink to="siglip">SigLIP</GuideLink>, <GuideLink to="dino">DINOv2</GuideLink> and{" "}
          <GuideLink to="gram">the Gram model</GuideLink>.
        </p>
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
  const transformer = TRANSFORMER[mode];
  const code = EMBEDDING_CODE[mode];

  return (
    <>
      <Section step="prepare" code={code.prepare}>
        <p>{PREPARATION[mode]}</p>
        <PreprocessFigure metric={mode} panel={anchorPanel} />
      </Section>

      {transformer && (
        <Section step="attention" code={code.patches}>
          <p>
            {transformer.name} is a <Term id="transformer" first>transformer</Term>: it reads the patches the way a
            language model reads words. Each patch becomes a <Term id="token" first>token</Term>, starting as{" "}
            {w.dim} numbers that describe only its own pixels and where it sits in the grid. Then come 12 rounds, called{" "}
            <Term id="layer" first>layers</Term>. In every layer, each patch compares itself with every other patch,
            weighs which ones matter to it (a step called <Term id="attention" first>attention</Term>), and folds
            some of what they hold into its own numbers.
          </p>

          <TransformerExamples model={transformer.key} modelName={transformer.name} dim={w.dim} />
        </Section>
      )}

      <Section step="arrows" code={code.direction}>
        <p>
          {transformer ? (
            <>
              For every panel, the patches' final numbers are <Term id="pooling" first>pooled</Term> into one list
              of {w.dim}.
            </>
          ) : (
            `Each panel ends up as ${w.dim} numbers.`
          )}{" "}
          They define an <Term id="vector">arrow</Term> through {w.dim}-dimensional space, and its direction encodes
          what {info.name} sees in that image: {ANGLE_WORDS[mode]}, all compressed into orientation.
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
      </Section>

      <Section step="angle" code={code.angle}>
        <Recap to="vectors" step="dot" label="Vectors › Dot product">
          Two arrows are compared by their <Term id="dot-product">dot product</Term>: multiply matching numbers and add
          everything up. Because the arrows have length 1, the total is the cosine of the angle between them.
        </Recap>
        <p>
          Here it is for the anchor and its closest neighbour, with {info.name}'s {w.dim} numbers:
        </p>
        <DotProduct w={w} />
        <Angle w={w} />
      </Section>

      <Section step="distance" code={code.distance}>
        <p>
          For sorting, the similarity becomes a <Term id="distance">distance</Term> where smaller = more similar:
          subtract it from 1.
        </p>
        <DistanceSum w={w} />
        <p>
          A distance of <Mono>0</Mono> means two arrows point the same way: the images are identical as far as{" "}
          {info.name} can tell. <Mono>1</Mono> means perpendicular, and <Mono>2</Mono> means they point in opposite
          directions. {DISTANCE_RANGE[mode]}
        </p>
        <p>
          So a distance only means something next to other distances from the same model: a <Mono>0.4</Mono> from
          SigLIP and a <Mono>0.4</Mono> from DINOv2 aren't the same amount of alike.
        </p>
        <NeighbourResult w={w} {...props} />
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
