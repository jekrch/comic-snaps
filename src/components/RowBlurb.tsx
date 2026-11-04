interface Props {
  /** The record's description, as stored — paragraphs and all. */
  text: string;
  /** How many lines of it the rail has room for. */
  lines: 2 | 3 | 4;
  /** Opens the full record in the viewer's drawer. */
  onMore: () => void;
  /** What the record is, for the button's accessible name. */
  label: string;
  /** Placement within the rail: a gap above it in the wide column, none as
   *  the narrow band's right-hand column. */
  className?: string;
}

const CLAMP = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4" } as const;

/**
 * The opening of a series' or a person's description, in the rail, with the
 * rest one click away in the drawer that already sets it in full.
 *
 * The paragraphs are run together: a clamp of two or three lines is a taste of
 * the text, and a paragraph break inside it spends one of those lines on
 * nothing.
 *
 * The clamp is a fixed count rather than whatever room is left: the wide rail
 * is a fixed 220px and the narrow band a fixed 96px, and their other lines are
 * each one line tall, so the count that fits is known per layout — and a blurb
 * shrunk to fit a measured gap would end mid-line, cut by the rail rather than
 * ellipsed by the clamp.
 */
export default function RowBlurb({ text, lines, onMore, label, className = "mt-1" }: Props) {
  const blurb = text.replace(/\s+/g, " ").trim();
  if (!blurb) return null;

  return (
    <div className={`flex min-h-0 shrink-0 flex-col items-start gap-0.5 ${className}`}>
      <p className={`${CLAMP[lines]} text-[11px] leading-snug text-white/45`}>{blurb}</p>
      <button
        type="button"
        onClick={onMore}
        className="text-[10px] uppercase tracking-wider text-white/25 hover:text-accent transition-colors cursor-pointer"
        aria-label={`Read more about ${label}`}
      >
        read more
      </button>
    </div>
  );
}
