import { useMemo } from "react";
import type { Panel } from "../../../types";
import { panelImageUrl } from "../../../utils/imageUrl";
import { formatIssue } from "../../../utils/issueFormat";
import { EMBEDDING_DIM, truncate } from "../../explainer/explainerConstants";
import { Section, Wide } from "../../explainer/explainerPrimitives";
import type { MetricKey } from "../../graph/similarityConfig";
import { GuideLink } from "../GuideLink";
import { Term } from "../Term";
import { LESSONS, lessonForMetric, pageDef } from "../lessons";
import { formatDistance } from "../SpecimenBar";
import { computeSpecimen, isEmbeddingMetric, useAllEmbeddings } from "../specimen";

/** The five methods, easiest first, as the lessons run. */
const METHODS: { metric: MetricKey; name: string }[] = [
  { metric: "color", name: "Color" },
  { metric: "phash", name: "pHash" },
  { metric: "embedding-siglip", name: "SigLIP" },
  { metric: "embedding-dino", name: "DINOv2" },
  { metric: "embedding-gram", name: "Gram" },
];

/**
 * What each method looks at, what it's given and gives back, how its
 * distances run and what it's good for. Condensed from the lessons and the
 * Sort tab.
 */
const FACTS: Record<MetricKey, { looksAt: string; input: string; output: string; range: string; goodFor: string }> = {
  color: {
    looksAt: "The dominant colors",
    input: "A thumbnail 64 pixels on its long side, in CIELAB",
    output: "Three dominant colors and a key color",
    range: "Under ~10 is the same color name; above ~50 is far apart",
    goodFor: "Palette and mood",
  },
  phash: {
    looksAt: "The broad brightness layout",
    input: "32 × 32, grayscale",
    output: "A 64-bit hash",
    range: "Bits that differ, 0 to 64; under ~10 is a near-duplicate",
    goodFor: "Near-duplicates",
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
    range: "Regularly past 1",
    goodFor: "Drawing style and texture",
  },
};

function label(p: Panel): string {
  return p.issue !== undefined && p.issue !== null && p.issue !== "" ? `${p.title} ${formatIssue(p.issue)}` : p.title;
}

export function Overview({ anchor, pool }: { anchor: Panel | null; pool: Panel[] }) {
  const maps = useAllEmbeddings(true);

  const picks = useMemo(
    () =>
      METHODS.map(({ metric, name }) => {
        const map = isEmbeddingMetric(metric) ? maps[metric] : null;
        const loading = isEmbeddingMetric(metric) && !map;
        const s = anchor && !loading ? computeSpecimen(anchor, pool, metric, map) : null;
        return { metric, name, loading, nearest: s?.closest ?? null };
      }),
    [anchor, pool, maps]
  );

  return (
    <>
      <Section step="alike">
        <p>
          Every sort on this site answers the same question: which panels are most like this one? The answer depends
          on what's doing the looking. Each of five methods turns a panel into something it can measure (a few
          colors, a fingerprint of its brightness, a long list of numbers from a{" "}
          <Term id="neural-network" first>neural network</Term>) and calls two panels
          alike when those measurements are close.
        </p>
        <p>
          Here's the <Term id="anchor" first>anchor panel</Term>, and the one panel each method picks as its nearest
          neighbour:
        </p>
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
        <p>
          They rarely agree. Each lesson follows one method from the image to the distance, worked through on this
          same anchor panel (all but pHash, which follows one panel before and after restoration instead). Shuffle
          it, or pick your own, from the worked example.
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
                      <td>{f.range}</td>
                      <td>{f.goodFor}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Wide>
      </Section>

      <Section step="start">
        <p>
          The lessons run from the simplest method to the deepest. The three neural-network lessons share one idea,
          comparing lists of numbers as arrows, which has a short lesson of its own.
        </p>
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
      </Section>
    </>
  );
}
