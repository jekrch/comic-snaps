import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

/**
 * A tooltip on an info icon, portalled to the body: the panels and modals it
 * sits in are scroll containers, and anything positioned inside one gets
 * clipped at its edge. Opens on hover for a mouse and on tap for a finger,
 * which has no hover to give — and closes on the next thing that happens
 * anywhere, so a tapped-open one cannot be left sitting on the screen.
 */
export default function VizHint({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const open = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    // Flipped to the left of the icon only if there is no room to its right,
    // which on a panel pinned to the left edge is essentially never.
    const left = rect.right + 8;
    setAt({
      left: Math.min(left, window.innerWidth - 248),
      // Anchored below its own top, then lifted off the bottom edge if the row
      // is near it.
      top: Math.min(rect.top - 4, window.innerHeight - 120),
    });
  };
  const close = () => setAt(null);

  // A tapped-open hint has nothing to close it on a phone — there is no pointer
  // to leave, and the icon is a 10px target to have to find again. So anything
  // that happens elsewhere dismisses it. Scrolling counts: the popup is fixed to
  // the viewport and would otherwise drift off its own icon.
  useEffect(() => {
    if (!at) return;
    const dismiss = (e: Event) => {
      // The icon's own press is its click's to handle, which toggles.
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("scroll", dismiss, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", dismiss);
    };
  }, [at]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="viz-hint-icon shrink-0 flex items-center"
        aria-label={`What ${label} does`}
        onPointerEnter={(e) => e.pointerType === "mouse" && open()}
        onPointerLeave={(e) => e.pointerType === "mouse" && close()}
        onFocus={open}
        onBlur={close}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (at) close();
          else open();
        }}
      >
        <Info size={10} />
      </button>
      {at &&
        createPortal(
          <div
            className="viz-hint-pop"
            style={{ left: at.left, top: Math.max(8, at.top) }}
            role="tooltip"
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}
