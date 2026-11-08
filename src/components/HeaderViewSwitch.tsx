import { useState } from "react";
import type { CSSProperties } from "react";
import { VIEW_BLOCKS } from "./ViewControl";
import type { GalleryView } from "./ViewControl";

const VIEWS: GalleryView[] = ["wall", "series", "artists"];

const LABEL: Record<GalleryView, string> = {
  wall: "by panel",
  series: "by series",
  artists: "by artist",
};

interface Props {
  view: GalleryView;
  onViewChange: (view: GalleryView) => void;
}

/**
 * The header's way across: the three readings as block miniatures beside the
 * bird, inked in its rust. They're the filter plates' own drawings at glyph size,
 * so each one looks like the page it opens. The current one is at full rust and
 * the other two are a lighter rust. App mounts this once the bird's intro hop
 * has landed, and the three icons hop out to the right one at a time, on the
 * bird's beat (see `view-switch-hop` in index.css).
 *
 * Hovering names the view in a readout placed off to the right, absolutely, so
 * it never moves the header. Touch screens don't get it (`hover: hover` in
 * index.css), since there it would only flash on tap and crowd the menu button.
 */
export default function HeaderViewSwitch({ view, onViewChange }: Props) {
  const [hovered, setHovered] = useState<GalleryView | null>(null);

  return (
    <div
      className="view-switch"
      role="group"
      aria-label="View"
      onPointerLeave={() => setHovered(null)}
      onBlur={() => setHovered(null)}
    >
      {VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          className="view-switch-btn"
          aria-label={`Show ${LABEL[v]}`}
          aria-pressed={v === view}
          onClick={() => onViewChange(v)}
          onPointerEnter={() => setHovered(v)}
          onFocus={() => setHovered(v)}
        >
          <span
            className="view-switch-mini"
            aria-hidden="true"
            style={{ "--i": VIEWS.indexOf(v) } as CSSProperties}
          >
            {VIEW_BLOCKS[v].map((b, i) => (
              <i
                key={i}
                className={b.face ? "is-face" : undefined}
                style={
                  {
                    left: `${b.x}%`,
                    top: `${b.y}%`,
                    width: `${b.w}%`,
                    height: `${b.h}%`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
        </button>
      ))}
      <span className={`view-switch-readout${hovered ? " is-shown" : ""}`} aria-hidden="true">
        {hovered ? LABEL[hovered] : ""}
      </span>
    </div>
  );
}
