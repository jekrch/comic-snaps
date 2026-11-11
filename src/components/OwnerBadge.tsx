import { useState } from "react";
import type { OwnerBadge as Badge } from "../utils/owners";

export const resolveAsset = (url: string) => (/^https?:\/\//.test(url) ? url : `${import.meta.env.BASE_URL}${url}`);

/**
 * A company's mark on its own ground: light for the usual dark-on-clear logo,
 * dark for the white marks some companies only publish. A person's portrait
 * is a photograph rather than a mark, so it is cropped to a disc instead
 * (sized by `portraitClassName`). Renders nothing if the image fails, so a
 * dead link leaves the name standing alone.
 */
export function OwnerLogo({
  logo,
  className,
  portraitClassName,
}: {
  logo: Badge["logo"];
  className: string;
  portraitClassName: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) return null;
  if (logo.portrait) {
    return (
      <img
        src={resolveAsset(logo.url)}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        draggable={false}
        className={`shrink-0 block rounded-full object-cover object-[50%_22%] bg-white/10 ring-1 ring-white/15 ${portraitClassName}`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`shrink-0 inline-flex items-center justify-center rounded-[2px] ${
        logo.onDark ? "bg-black/70 ring-1 ring-inset ring-white/10" : "bg-white/90"
      } ${className}`}
    >
      <img
        src={resolveAsset(logo.url)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="block h-full w-auto max-w-full object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

/** The chips share one look, so the age chip sits beside the owner's as a set. */
export const CHIP =
  "inline-flex items-center gap-1.5 max-w-full rounded-sm bg-black/65 backdrop-blur-sm leading-none text-white/85 shadow-[0_1px_2px_rgba(0,0,0,0.4)]";

/** The age chip's size. The owner badge runs a size up, since its name is the
 *  one that has to be read. */
export const CHIP_SMALL = "h-5 pr-1.5 text-[10px]";

/**
 * The owner badge on a wall card: the top company's mark and name, and for a
 * house that people own outright, their status. A button: it opens the chain.
 */
export default function OwnerBadge({ badge, onOpen }: { badge: Badge; onOpen: () => void }) {
  const title = badge.status ? `${badge.name} · ${badge.status}` : `Owned by ${badge.name}`;
  return (
    <button
      type="button"
      // The card opens the viewer (mouse) or selects itself (touch) on
      // pointerup; this tap is the badge's alone.
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={`${CHIP} h-6 pr-2 text-[12px] ${badge.logo ? "pl-1" : "pl-2"} pointer-events-auto cursor-pointer hover:bg-black/85 hover:text-white transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40`}
      title={`${title} — show the ownership chain`}
      aria-label={`${title}. Show the ownership chain`}
    >
      <OwnerLogo logo={badge.logo} className="h-[18px] max-w-16 px-1 py-[2px]" portraitClassName="size-[18px]" />
      <span className="min-w-0 truncate">{badge.name}</span>
      {badge.status && <span className="min-w-0 shrink-[2] truncate text-white/45">· {badge.status.toLowerCase()}</span>}
    </button>
  );
}
