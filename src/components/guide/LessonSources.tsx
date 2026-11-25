import type { PageId } from "./lessons";
import { SOURCE_GROUPS, sourcesFor, type Source } from "./sources";

/**
 * The end-of-lesson reading list, in two groups: beginner-friendly
 * explainers first, then the papers and references. Each source is cited,
 * linked, and followed by a line on what it's good for. Pages without
 * sources (the overview, the glossary) render nothing.
 *
 * The section is marked `data-progress-end`, so the reading progress stops
 * at its top: the sources aren't counted as part of the lesson's length.
 * Each group carries a `data-step`, so the scroll spy and the rail treat it
 * as a place in the page, after the lesson's own steps.
 */
export function LessonSources({ page }: { page: PageId }) {
  const sources = sourcesFor(page);
  if (!sources) return null;
  return (
    <section className="guide-sources" aria-labelledby="guide-sources-title" data-progress-end="">
      <h2 id="guide-sources-title" className="guide-sources-title">
        Sources
      </h2>
      {SOURCE_GROUPS.map((g) => {
        const list = sources[g.key];
        if (list.length === 0) return null;
        return (
          <div key={g.id} id={g.id} data-step={g.id} className="guide-sources-group">
            <h3 className="guide-sources-group-title">{g.title}</h3>
            <ol className="guide-sources-list">
              {list.map((s) => (
                <SourceItem key={s.url} source={s} />
              ))}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

function SourceItem({ source: s }: { source: Source }) {
  return (
    <li>
      <p className="guide-source-ref">
        {s.cite}.{" "}
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="guide-link">
          {s.title}
        </a>
        . <span className="guide-source-venue">{s.venue}</span>.
      </p>
      <p className="guide-source-note">{s.note}</p>
    </li>
  );
}
