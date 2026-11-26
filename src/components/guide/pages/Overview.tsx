import { useMemo } from "react";
import type { Panel } from "../../../types";
import { panelImageUrl } from "../../../utils/imageUrl";
import { formatIssue } from "../../../utils/issueFormat";
import { EMBEDDING_DIM, truncate } from "../../explainer/explainerConstants";
import { Em, Section, Wide } from "../../explainer/explainerPrimitives";
import type { MetricKey } from "../../graph/similarityConfig";
import { GuideLink } from "../GuideLink";
import { Term } from "../Term";
import { LESSONS, lessonForMetric, pageDef } from "../lessons";
import { formatDistance } from "../SpecimenBar";
import { computeSpecimen, isEmbeddingMetric, useAllEmbeddings } from "../specimen";
import { agreement, percent, rangeText, useAllStats, type MetricStats } from "../galleryStats";

/** The five methods, easiest first, as the lessons run. */
const METHODS: { metric: MetricKey; name: string }[] = [
  { metric: "color", name: "Color" },
  { metric: "phash", name: "pHash" },
  { metric: "embedding-siglip", name: "SigLIP" },
  { metric: "embedding-dino", name: "DINOv2" },
  { metric: "embedding-gram", name: "Gram" },
];

/**
 * The methods that rank different panels against each other. pHash is left
 * out: it's for catching duplicates, and its "nearest" different panel is
 * mostly chance (every unrelated pair sits near 32 bits).
 */
const RANKERS = METHODS.filter((m) => m.metric !== "phash");

/**
 * What each method looks at, what it's given and gives back, how its
 * distances run and what it's good for. Condensed from the lessons and the
 * Sort tab. `range` is the fallback while the gallery's own spread is being
 * measured (see `liveRange`).
 */
const FACTS: Record<MetricKey, { looksAt: string; input: string; output: string; range: string; goodFor: string }> = {
  color: {
    looksAt: "The dominant colors",
    input: "A thumbnail 64 pixels on its long side, in CIELAB",
    output: "Three dominant colors and a key color",
    range: "Under ~10 is the same color name; above ~50 is far apart. Black-and-white panels run smaller",
    goodFor: "Palette and mood",
  },
  phash: {
    looksAt: "The broad brightness layout",
    input: "32 × 32, grayscale",
    output: "A 64-bit hash",
    range: "Bits that differ, 0 to 64. Under ~10 is the same picture; a re-cropped copy can reach the high teens; different panels sit near 32",
    goodFor: "Catching duplicates and near-duplicates",
  },
  "embedding-siglip": {
    looksAt: "Subject, composition, mood",
    input: "A 224 × 224 square, 16-pixel patches",
    output: `${EMBEDDING_DIM["embedding-siglip"]} numbers`,
    range: "Bunched well below 1",
    goodFor: "What's depicted",
  },
  "embedding-dino": {
    looksAt: "Shapes, spatial layout, texture",
    input: "The whole panel, short side 256, 14-pixel patches",
    output: `${EMBEDDING_DIM["embedding-dino"]} numbers`,
    range: "Spread wider, up to about 1",
    goodFor: "Composition and form",
  },
  "embedding-gram": {
    looksAt: "Line quality, hatching, ink texture",
    input: "The whole panel, short side 448",
    output: `${EMBEDDING_DIM["embedding-gram"]} numbers, after PCA`,
    range: "About half of all pairs past 1",
    goodFor: "Drawing style and texture",
  },
};

/** The typical-distances cell, from the gallery's own pairs. */
function liveRange(metric: MetricKey, s: MetricStats | null | undefined): string {
  if (!s) return FACTS[metric].range;
  if (metric === "color") {
    const bw = s.bw ? `, black-and-white ${rangeText(s.bw, 0)}` : "";
    return `Most color pairs ${rangeText(s.spread, 0)}${bw}. Under ~10 is the same color name`;
  }
  if (metric === "phash") {
    return `Bits that differ, 0 to 64. Under ~10 is the same picture; different panels ${rangeText(s.spread, 0)}`;
  }
  const past = s.spread.overOne >= 0.05 ? `; ${percent(s.spread.overOne)} past 1` : "";
  return `Most pairs ${rangeText(s.spread)}${past}`;
}

/** The two ranking methods whose nearest picks agree most, and how often; null until all four are measured. */
function closestAgreement(stats: Partial<Record<MetricKey, MetricStats | null>>) {
  let best: { a: string; b: string; share: number } | null = null;
  for (let i = 0; i < RANKERS.length; i++) {
    for (let j = i + 1; j < RANKERS.length; j++) {
      const a = stats[RANKERS[i].metric];
      const b = stats[RANKERS[j].metric];
      if (!a || !b) return null;
      const share = agreement(a.nearest, b.nearest);
      if (!best || share > best.share) best = { a: RANKERS[i].name, b: RANKERS[j].name, share };
    }
  }
  return best;
}

function label(p: Panel): string {
  return p.issue !== undefined && p.issue !== null && p.issue !== "" ? `${p.title} ${formatIssue(p.issue)}` : p.title;
}

interface OverviewProps {
  anchor: Panel | null;
  pool: Panel[];
}

interface Pick {
  metric: MetricKey;
  name: string;
  loading: boolean;
  nearest: { panel: Panel; distance: number } | null;
}

/**
 * What both versions of the page read: the gallery's live stats, the pair
 * of ranking methods that agree most, and each method's nearest pick for
 * the anchor. Called at the top of each version, so switching a step
 * between them redoes none of it.
 */
function useOverview(anchor: Panel | null, pool: Panel[]) {
  const maps = useAllEmbeddings(true);
  const stats = useAllStats(pool, maps);
  const agree = closestAgreement(stats);
  const picks = useMemo(
    (): Pick[] =>
      RANKERS.map(({ metric, name }) => {
        const map = isEmbeddingMetric(metric) ? maps[metric] : null;
        const loading = isEmbeddingMetric(metric) && !map;
        const s = anchor && !loading ? computeSpecimen(anchor, pool, metric, map) : null;
        return { metric, name, loading, nearest: s?.closest ?? null };
      }),
    [anchor, pool, maps]
  );
  return { stats, agree, picks };
}

/** The anchor, then each ranking method's nearest panel, each linking to its lesson. */
function CompareRow({ anchor, picks }: { anchor: Panel | null; picks: Pick[] }) {
  return (
    <Wide>
      <div className="guide-compare" role="list">
        {anchor && (
          <figure className="guide-compare-card is-anchor" role="listitem">
            <span className="guide-label">Anchor</span>
            <img src={panelImageUrl(anchor.image)} alt="" decoding="async" draggable={false} />
            <figcaption className="guide-caption">{truncate(label(anchor), 34)}</figcaption>
          </figure>
        )}
        {picks.map((p) => (
          <div key={p.metric} role="listitem" className="contents">
          <GuideLink to={lessonForMetric(p.metric)} className="guide-compare-card">
            <span className="guide-label">{p.name}</span>
            {p.nearest ? (
              <>
                <img src={panelImageUrl(p.nearest.panel.image)} alt="" decoding="async" draggable={false} />
                <span className="guide-caption block">{truncate(label(p.nearest.panel), 34)}</span>
                <span className="guide-caption block guide-compare-dist">
                  {formatDistance(p.metric, p.nearest.distance)}
                </span>
              </>
            ) : (
              <span className="guide-caption block guide-compare-empty">
                {p.loading || !anchor ? "Loading…" : "No neighbour for this panel"}
              </span>
            )}
          </GuideLink>
          </div>
        ))}
      </div>
    </Wide>
  );
}

/** One card per lesson, in reading order. */
function LessonCards() {
  return (
    <div className="guide-cards">
      {LESSONS.map((l) => (
        <GuideLink key={l.id} to={l.id} className="guide-card">
          <span className="guide-eyebrow">{l.family}</span>
          <span className="guide-card-title">{l.title}</span>
          <span className="guide-caption block">
            ~{l.minutes} min
            {l.buildsOn.length > 0 && ` · builds on ${l.buildsOn.map((b) => pageDef(b).label).join(", ")}`}
          </span>
        </GuideLink>
      ))}
    </div>
  );
}

export function Overview({ anchor, pool }: OverviewProps) {
  const { stats, agree, picks } = useOverview(anchor, pool);

  return (
    <>
      <Section step="alike">
        <p>
          Sorting comic panels turned out to be fun in its own right, but I mostly built these sorts as an excuse
          to learn how color science, image hashing and neural networks each look at a picture. This guide is what
          I picked up along the way.
        </p>
        <p>
          Every method on this site answers the same question: which panels are most like this one? Here's the{" "}
          <Term id="anchor" first>anchor panel</Term>, and the one panel each method picks as its nearest neighbour:
        </p>
        <CompareRow anchor={anchor} picks={picks} />
        <p>
          They rarely agree
          {agree
            ? `. Across the whole gallery, the two that agree most often, ${agree.a} and ${agree.b}, pick the same nearest panel for only ${percent(agree.share)} of panels.`
            : "."}
        </p>
        <p>
          That's because each method measures something different. It turns a panel into a few colors or a long
          list of numbers from a <Term id="neural-network" first>neural network</Term>, and calls two panels alike
          when those measurements are close.
        </p>
        <p>
          Each lesson follows one method from the image to the distance, worked through on this same anchor panel.
          Use <strong>Shuffle</strong> or <strong>Pick</strong> beside the anchor's name to change it.
        </p>
        <p>
          pHash is a special case, which is why it isn't in the row above. It doesn't ask which panel is most like
          this one, only whether two images are the same picture: a panel posted twice, or a photo beside its
          restoration. Its lesson follows one such pair instead of the anchor.
        </p>
      </Section>

      <Section step="methods">
        <Wide>
          <div className="guide-table-wrap">
            <table className="guide-table">
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Looks at</th>
                  <th scope="col">Is given</th>
                  <th scope="col">Gives back</th>
                  <th scope="col">Typical distances</th>
                  <th scope="col">Good for</th>
                </tr>
              </thead>
              <tbody>
                {METHODS.map(({ metric, name }) => {
                  const f = FACTS[metric];
                  return (
                    <tr key={metric}>
                      <th scope="row">
                        <GuideLink to={lessonForMetric(metric)}>{name}</GuideLink>
                      </th>
                      <td>{f.looksAt}</td>
                      <td>{f.input}</td>
                      <td>{f.output}</td>
                      <td>{liveRange(metric, stats[metric])}</td>
                      <td>{f.goodFor}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Wide>
        <p className="guide-caption">
          “Most pairs” is the middle 90% of every pair of panels in the gallery, measured as you read.
        </p>
      </Section>

      <Section step="order">
        <p>
          A distance compares two panels. The Sort tab needs one order for all of them, and gets it in one of two
          ways.
        </p>
        <p>
          SigLIP, DINOv2 and Gram string the panels into a{" "}
          <Term id="chain" first>nearest-neighbour chain</Term>. The chain starts at one panel, steps to whichever
          panel not yet placed is closest to it, and repeats from there. Panels side by side in the grid are close
          by that method. The chain never looks back, though: its early stretch follows the best matches, and the
          far end collects the panels left over, which are often only loosely related.
        </p>
        <p>
          Color doesn't sort by its distance. It lines panels up around the color wheel, then puts the
          black-and-white panels after them; the <GuideLink to="color" step="hue">Color lesson</GuideLink> shows
          how. Its distance, like the models', picks the neighbours in the{" "}
          <Term id="similarity-graph">similarity graph</Term>.
        </p>
        <p>
          pHash is offered as a sort too, built the same way as the chain, but only its first links mean much. Two
          copies of one picture land side by side; past that, the order is close to chance.
        </p>
      </Section>

      <Section step="start">
        <p>
          The lessons go from the simplest method to the most involved. The three neural-network lessons all rely
          on one idea, comparing lists of numbers as arrows, so that idea gets a short lesson of its own.
        </p>
        <p>
          The Guide uses a method I'm working on that I call <Em>dimensional documentation</Em>: the same material
          written at more than one depth, so you choose how far down to go, one step at a time. Each lesson opens
          at its <strong>Essentials</strong>, and you can switch a single step to <strong>In depth</strong> or the
          whole lesson. Underlined terms open their definitions when tapped, and a step's <strong>code</strong>{" "}
          button shows the lines that do the work. Shuffling the anchor reruns every example on a different panel.
          Each lesson ends with sources if you want to go further.
        </p>
        <LessonCards />
      </Section>
    </>
  );
}

/**
 * The overview's essentials, where the page opens. It keeps the full page's
 * steps, so the rail and each step's "In depth" line up, and the figures
 * that carry it (the five picks, the table, the lesson cards); the prose
 * comes down to a sentence or two a step. Terms are references only: the
 * full page stays their home.
 */
export function OverviewEssentials({ anchor, pool }: OverviewProps) {
  const { agree, picks } = useOverview(anchor, pool);

  return (
    <>
      <Section step="alike">
        <p>
          Every method on this site answers one question: which panels are most like this one? Here's the{" "}
          <Term id="anchor">anchor panel</Term> and the panel each method picks as its nearest neighbour:
        </p>
        <CompareRow anchor={anchor} picks={picks} />
        <p>
          They rarely agree
          {agree
            ? `: even the two closest, ${agree.a} and ${agree.b}, pick the same panel for only ${percent(agree.share)} of the gallery.`
            : "."}{" "}
          Each method measures something different, and calls two panels alike when those measurements are close.
          pHash isn't in the row because it only checks whether two images are the same picture.
        </p>
      </Section>

      <Section step="methods">
        <Wide>
          <div className="guide-table-wrap">
            <table className="guide-table">
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Looks at</th>
                  <th scope="col">Good for</th>
                </tr>
              </thead>
              <tbody>
                {METHODS.map(({ metric, name }) => (
                  <tr key={metric}>
                    <th scope="row">
                      <GuideLink to={lessonForMetric(metric)}>{name}</GuideLink>
                    </th>
                    <td>{FACTS[metric].looksAt}</td>
                    <td>{FACTS[metric].goodFor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Wide>
      </Section>

      <Section step="order">
        <p>
          To sort the gallery, SigLIP, DINOv2 and Gram build a <Term id="chain">nearest-neighbour chain</Term>: start
          at one panel, step to the closest panel not yet placed, and repeat. Color lines panels up around the color
          wheel instead, with the black-and-white panels last.
        </p>
      </Section>

      <Section step="start">
        <p>
          The lessons run from the simplest method to the most involved, and the three neural-network lessons share
          a short one on Vectors. Each opens at its essentials, like this page. Switch a step, or the whole lesson,
          to <strong>In depth</strong> to go further.
        </p>
        <LessonCards />
      </Section>
    </>
  );
}
