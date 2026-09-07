import { BookOpen, Youtube, ExternalLink } from "lucide-react";
import type { Reference } from "../types";

function refIcon(ref: Reference) {
  const url = ref.url.toLowerCase();
  if (url.includes("wikipedia.org") || url.includes("wiki")) return <BookOpen size={12} />;
  if (url.includes("youtube.com") || url.includes("youtu.be")) return <Youtube size={12} />;
  return <ExternalLink size={12} />;
}

/**
 * The references on a series or a person: accent text links, not pills.
 *
 * A reference that names one article rather than a whole database entry gets a
 * line to itself, and that line is the link — "The Comics Journal" in the row
 * says where the link goes but not which interview it is, and the titles run
 * long enough (past 100 characters) that putting them in the row would swallow
 * every other link in it. The source stays on the line, dimmed, as its label.
 */
export default function ReferenceLinks({
  references,
  className = "",
}: {
  references: Reference[];
  className?: string;
}) {
  if (references.length === 0) return null;
  const entries = references.filter((ref) => !ref.title);
  const articles = references.filter((ref) => ref.title);
  return (
    <div className={className}>
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entries.map((ref) => (
            <a
              key={ref.url}
              href={ref.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-accent hover:text-accent-dim transition-colors"
            >
              {refIcon(ref)}
              {ref.name}
            </a>
          ))}
        </div>
      )}
      {articles.length > 0 && (
        <div className={entries.length > 0 ? "mt-1.5 space-y-1" : "space-y-1"}>
          {articles.map((ref) => (
            <a
              key={ref.url}
              href={ref.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-1 text-[10px] text-accent hover:text-accent-dim transition-colors"
            >
              <span className="shrink-0 mt-px">{refIcon(ref)}</span>
              <span className="leading-snug">
                <span className="opacity-60">{ref.name} — </span>
                {ref.title}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
