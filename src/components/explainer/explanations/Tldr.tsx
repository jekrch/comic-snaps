import { useState } from "react";
import type { Panel } from "../../../types";
import type { NeighborInfo } from "../explainerConstants";
import { METRIC_INFO, fmt, truncate } from "../explainerConstants";
import { DistanceBar, Section } from "../explainerPrimitives";
import { Term } from "../../guide/Term";
import { GuideLink } from "../../guide/GuideLink";
import { CielabPlane } from "../CielabPlane";
import { RgbVsLab } from "../RgbVsLab";
import { PreprocessFigure } from "../PreprocessFigure";
import { BitsGuess, NeighbourGuess } from "../Guess";
import { bitDistance } from "../phashExamples";
import { isChromatic } from "../../../utils/sorting";
import { DistanceRanges, ExampleFigure, HammingFigure, PairFigure, usePhashExamples } from "../PhashFigures";
import {
  ANGLE_WORDS,
  Angle,
  ValueStrips,
  useWorkedNumbers,
  type EmbeddingMetric,
  type WorkedProps,
} from "./EmbeddingExplanation";

/**
 * The lessons' essentials, which is where each lesson opens. Each keeps its
 * full lesson's steps (so the rail, step links and "In depth" line up) but says
 * each in a sentence or two, keeps the one or two figures that carry the
 * idea, and ends on a guess the reader makes before seeing the numbers.
 * Terms are references only: their definitions open on tap, and the full
 * lesson stays their home.
 */

function Bar({ anchor, closest, furthest, maxVal }: { anchor: Panel; closest: NeighborInfo; furthest: NeighborInfo; maxVal?: number }) {
  return (
    <DistanceBar
      closeDist={closest.distance}
      farDist={furthest.distance}
      anchorLabel={truncate(anchor.title, 18)}
      closeLabel={truncate(closest.panel.title, 18)}
      farLabel={truncate(furthest.panel.title, 18)}
      maxVal={maxVal}
    />
  );
}

export function ColorTldr({
  anchorPanel,
  closest,
  furthest,
  all,
  pool,
}: WorkedProps & { all?: NeighborInfo[]; pool?: Panel[] }) {
  const chromatic = isChromatic(anchorPanel);
  const hasColors = !!(anchorPanel.dominantColors?.[0] && closest.panel.dominantColors?.[0] && furthest.panel.dominantColors?.[0]);
  return (
    <>
      <Section step="rgb">
        <p>
          Equal gaps in red-green-blue numbers don't look equally different, so the gallery measures color in{" "}
          <Term id="cielab">CIELAB</Term>, a space built so that they do. Compare the two bars:
        </p>
        <RgbVsLab pool={pool} />
      </Section>

      <Section step="channels">
        <p>
          CIELAB gives every color three numbers: lightness, a green–red axis and a blue–yellow axis. A panel's main
          colors become points in that space.
        </p>
      </Section>

      <Section step="split">
        <p>
          Black-and-white panels are set aside first, so a faint paper tint can't drop a gray panel in among the
          reds. Color panels only ever neighbour color panels.
        </p>
      </Section>

      <Section step="hue">
        <p>
          The color panels are then lined up around the wheel by the <Term id="hue-angle">hue angle</Term> of their{" "}
          <Term id="key-color">key color</Term>, the hue their colored pixels peak at, so neighbouring hues sit
          together. Black-and-white panels follow, lightest first. Point at a dot to see whose it is.
        </p>
        {hasColors && <CielabPlane key={anchorPanel.id} stage="hue" anchor={anchorPanel} closest={closest} furthest={furthest} all={all} />}
      </Section>

      <Section step="distance">
        <p>
          Neighbours use a different number: how far apart two panels' palettes sit in CIELAB, with paper whites and
          ink blacks discounted so the art's own colors decide.
        </p>
      </Section>

      <Section step="result">
        <NeighbourGuess
          anchor={anchorPanel}
          closest={closest}
          furthest={furthest}
          method="the color measure"
          format={(d) => d.toFixed(1)}
          why={
            chromatic
              ? "Under about 10, the colors would get the same name; past 50 is far apart."
              : "Black-and-white palettes differ mostly in lightness, so their distances run small. Compare them with each other, not with color panels'."
          }
        >
          <Bar
            anchor={anchorPanel}
            closest={closest}
            furthest={furthest}
            maxVal={chromatic ? Math.max(furthest.distance * 1.2, 80) : furthest.distance * 1.2}
          />
        </NeighbourGuess>
      </Section>
    </>
  );
}

export function PhashTldr() {
  const data = usePhashExamples();
  const [index, setIndex] = useState(0);
  const figure = (render: Parameters<typeof ExampleFigure>[0]["children"]) => (
    <ExampleFigure data={data} index={index} onPick={setIndex}>
      {render}
    </ExampleFigure>
  );
  const example = data?.examples[Math.min(index, data.examples.length - 1)];
  const pair = example ? bitDistance(example.before.bits, example.after.bits) : null;

  return (
    <>
      <Section step="pair">
        <p>
          A <Term id="phash">perceptual hash</Term> is a fingerprint of how a picture looks at a glance. The gallery
          uses it for one job: catching duplicates and near-duplicates. To test it, here's one panel photographed
          and then restored. Anyone would call these the same picture, and the steps
          below check whether pHash does too.
        </p>
        {figure((e) => (
          <PairFigure example={e} />
        ))}
      </Section>

      <Section step="luma">
        <p>
          First it throws away color, keeping only each pixel's <Term id="luminance">brightness</Term>.
        </p>
      </Section>

      <Section step="shrink">
        <p>Then it shrinks the picture to a 32 × 32 square, so fine detail can't matter.</p>
      </Section>

      <Section step="patterns">
        <p>
          It describes that square as a mix of 64 broad light-and-dark patterns (a <Term id="dct">DCT</Term>): where
          the big masses of light and dark sit.
        </p>
      </Section>

      <Section step="bits">
        <p>Each pattern becomes one bit of the fingerprint: 1 if its number is above the median of all 64, 0 if not.</p>
      </Section>

      <Section step="count">
        <p>
          Two fingerprints are compared by counting the bits that differ, the <Term id="hamming">Hamming distance</Term>.
        </p>
        {figure((e) => (
          <BitsGuess example={e}>
            <HammingFigure example={e} />
          </BitsGuess>
        ))}
      </Section>

      <Section step="result">
        <p>
          To judge whether {pair !== null ? `${pair} bits is` : "that's"} a lot, here's this pair beside every
          restoration in the gallery and beside panels that have nothing to do with each other.
        </p>
        {figure((e, d) => (
          <DistanceRanges stats={d.stats} example={e} />
        ))}
        <p>
          Relighting barely moves the hash, but a new crop can move it as far as a different panel would. Any two
          unrelated panels land near 32, so only a low count means anything: it flags the same picture, and says
          little about panels that differ.
        </p>
      </Section>
    </>
  );
}

export function VectorsTldr(props: WorkedProps) {
  const { anchorPanel, closest, furthest } = props;
  const w = useWorkedNumbers("embedding-siglip", props);
  return (
    <>
      <Section step="arrows">
        <p>
          Each neural model turns a panel into a list of numbers, its <Term id="embedding">embedding</Term>, and reads
          the list as an <Term id="vector">arrow</Term> through {w.dim}-dimensional space.
          {w.strips && " Here are SigLIP's for your panel and two others. Which row looks more like the top one?"}
        </p>
        <ValueStrips w={w} {...props} />
      </Section>

      <Section step="normalize">
        <p>Every arrow is stretched or shrunk to the same length, so only its direction counts.</p>
      </Section>

      <Section step="dot">
        <p>
          Multiply matching numbers and add them up: that's the <Term id="dot-product">dot product</Term>, and for
          same-length arrows it's the cosine of the angle between them. 1 means they point the same way.
        </p>
        <Angle w={w} />
      </Section>

      <Section step="distance">
        <p>
          Distance is 1 minus that: 0 when the arrows point the same way, 1 at right angles. Only compare it with
          other distances from the
          same model.
        </p>
        <NeighbourGuess anchor={anchorPanel} closest={closest} furthest={furthest} method="SigLIP" format={(d) => fmt(d, 3)}>
          <Bar anchor={anchorPanel} closest={closest} furthest={furthest} />
        </NeighbourGuess>
        <p>
          Each model lesson runs this on its own numbers: <GuideLink to="siglip">SigLIP</GuideLink>,{" "}
          <GuideLink to="dino">DINOv2</GuideLink> and <GuideLink to="gram">the Gram model</GuideLink>.
        </p>
      </Section>
    </>
  );
}

/** How each model prepares a panel, in a sentence. */
const PREPARE: Record<EmbeddingMetric, React.ReactNode> = {
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

export function EmbeddingTldr({ metric, ...props }: { metric: EmbeddingMetric } & WorkedProps) {
  const { anchorPanel, closest, furthest } = props;
  const w = useWorkedNumbers(metric, props);
  const name = METRIC_INFO[metric].name;
  const short = metric === "embedding-gram" ? "the Gram model" : name;
  const transformer = metric !== "embedding-gram";
  return (
    <>
      <Section step="prepare">
        <p>{PREPARE[metric]}</p>
        <PreprocessFigure metric={metric} panel={anchorPanel} />
      </Section>

      {transformer && (
        <Section step="attention">
          <p>
            Over 12 <Term id="layer">layers</Term>, every patch looks at every other and borrows from the ones that
            matter to it (<Term id="attention">attention</Term>). By the end, a patch's numbers describe the figure it
            belongs to as well as its own pixels.
          </p>
        </Section>
      )}

      <Section step="arrows">
        <p>
          Out come {w.dim} numbers: an <Term id="vector">arrow</Term> whose direction holds what {short} sees,{" "}
          {ANGLE_WORDS[metric]}.
        </p>
      </Section>

      <Section step="angle">
        <p>
          Two panels are compared by the angle between their arrows, as in <GuideLink to="vectors">Vectors</GuideLink>
          : the narrower, the more alike.
        </p>
        <Angle w={w} />
      </Section>

      <Section step="distance">
        <NeighbourGuess
          anchor={anchorPanel}
          closest={closest}
          furthest={furthest}
          method={short}
          format={(d) => fmt(d, 3)}
          why={`It's looking at ${ANGLE_WORDS[metric]}.`}
        >
          <Bar anchor={anchorPanel} closest={closest} furthest={furthest} />
        </NeighbourGuess>
      </Section>
    </>
  );
}
