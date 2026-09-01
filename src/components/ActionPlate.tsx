import type { ReactNode } from "react";

/**
 * The frame the two actions on the narrowed set share.
 *
 * They used to be two more rows of list type with a lucide glyph in front —
 * indistinguishable from the facet headers above them, and reading as more
 * filtering rather than as the two things you can *do* with what you've
 * narrowed to. A plate is the site's own unit: a ruled panel with a caption box
 * in the corner, sitting in a gutter beside its neighbour exactly as the wall's
 * cards do.
 *
 * The second frame under the first is a misregistration — a colour impression
 * landing a hair off its key line. It is the whole reason the plates read as
 * printed rather than as CSS boxes, and it widens on hover, which is the only
 * "lift" they need.
 *
 * The art is the caller's, and it carries the meaning: each plate draws what it
 * does rather than labelling it with a symbol that has to be learned.
 */

interface ActionPlateProps {
  /** Caption-box text. Kept to a couple of words — it is 9px type. */
  label: string;
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  /** The drawing, laid into the frame above the caption. */
  children: ReactNode;
}

export default function ActionPlate({
  label,
  ariaLabel,
  onClick,
  disabled,
  children,
}: ActionPlateProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title=""
      className="action-plate"
    >
      <span className="action-plate-ghost" aria-hidden="true" />
      <span className="action-plate-frame">
        <span className="action-plate-art">{children}</span>
        <span className="action-plate-caption font-display">{label}</span>
      </span>
    </button>
  );
}
