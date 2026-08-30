import { useEffect, useRef, useState, useCallback, useImperativeHandle } from "react";
import type { Ref } from "react";
import { Bird } from "lucide-react";
import { useAtTop } from "../hooks/useAtTop";

/**
 * How the header's ink stops at the bottom of the bar once the page is
 * scrolled: solid through the top of the box, gone by the time it reaches the
 * edge. The thought balloon wears the same fade, so the two dissolve together.
 */
export const HEADER_FADE_MASK = "linear-gradient(to bottom, black 40%, transparent 90%)";

export interface BirdHandle {
  /** Peck once, if the intro has finished. */
  peck: () => void;
}

interface BirdIconProps {
  ref?: Ref<BirdHandle>;
  /** Fires once the intro hop has landed. The thought balloon waits on this. */
  onIntroComplete?: () => void;
}

/** Hovering the thought balloon off to its right is a reason to peck too. */
export default function BirdIcon({ ref, onIntroComplete }: BirdIconProps) {
  const birdRef = useRef<SVGSVGElement>(null);
  const birdMaskedRef = useRef<SVGSVGElement>(null);
  const [introComplete, setIntroComplete] = useState(false);
  const introCompleteRef = useRef(false);
  const atTop = useAtTop();

  // Held in a ref so the effect below keeps its `[triggerPeck]` deps — taking
  // the callback as a dependency would re-run it and replay the intro hop.
  const onIntroCompleteRef = useRef(onIntroComplete);
  onIntroCompleteRef.current = onIntroComplete;

  const triggerPeck = useCallback(() => {
    if (!introCompleteRef.current) return;
    for (const bird of [birdRef.current, birdMaskedRef.current]) {
      if (!bird) continue;
      bird.classList.remove("bird-peck-scroll");
      void (bird as unknown as HTMLElement).offsetWidth;
      bird.classList.add("bird-peck-scroll");
    }
  }, []);

  useImperativeHandle(ref, () => ({ peck: triggerPeck }), [triggerPeck]);

  useEffect(() => {
    const el = birdRef.current;
    const elMasked = birdMaskedRef.current;
    if (!el) return;

    // Intro hop — bird drops in front of title, hops over to final spot
    el.classList.add("bird-hop-intro");
    const onIntroEnd = () => {
      el.classList.remove("bird-hop-intro");
      introCompleteRef.current = true;
      setIntroComplete(true);
      onIntroCompleteRef.current?.();
    };
    el.addEventListener("animationend", onIntroEnd, { once: true });

    // Clean up peck class when animation naturally ends
    const onPeckEnd = (e: AnimationEvent) => {
      if (e.animationName === "peck") {
        (e.currentTarget as Element).classList.remove("bird-peck-scroll");
      }
    };
    el.addEventListener("animationend", onPeckEnd);
    elMasked?.addEventListener("animationend", onPeckEnd);

    // Scroll-triggered pecking
    let lastScrollY = window.scrollY;

    const onScroll = () => {
      if (!introCompleteRef.current) return;
      if (Math.abs(window.scrollY - lastScrollY) < 10) return;
      lastScrollY = window.scrollY;
      triggerPeck();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      el.removeEventListener("animationend", onPeckEnd);
      elMasked?.removeEventListener("animationend", onPeckEnd);
    };
  }, [triggerPeck]);

  return (
    <div className="relative cursor-pointer" onMouseEnter={triggerPeck} onClick={triggerPeck}>
      {/* Unmasked bird — visible during intro and when scrolled to top */}
      <div
        className={`h-7 flex items-end overflow-visible transition-opacity duration-300 ease-in ${introComplete && !atTop ? 'opacity-0' : 'opacity-100'}`}
      >
        {/* The 70px glyph overflows this 28px-tall header row, so its empty box
            was swallowing clicks aimed at the filter control underneath. The
            peck target is the wrapper div, which stays inside the header. */}
        <Bird
          ref={birdRef}
          size={70}
          strokeWidth={1.5}
          className="ml-6 stroke-[#8d422f] bird-base"
          style={{ pointerEvents: "none" }}
        />
      </div>
      {/* Masked bird — fades in after intro, always visible once intro is done */}
      <div
        className={`h-7 flex items-end overflow-hidden absolute inset-0 transition-opacity duration-700 ease-in ${introComplete ? 'opacity-100' : 'opacity-0'}`}
        style={{
          maskImage: `repeating-linear-gradient(to bottom,
            black 0px, black 10px, transparent 4px, transparent 3px),
            ${HEADER_FADE_MASK}`,
          WebkitMaskImage: `repeating-linear-gradient(to bottom,
            black 0px, black 10px, transparent 2px, transparent 3px),
            ${HEADER_FADE_MASK}`,
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
        }}
      >
        <Bird
          ref={birdMaskedRef}
          size={70}
          strokeWidth={1.5}
          className="ml-6 stroke-[#8d422f] bird-base"
          style={{ pointerEvents: "none" }}
          aria-hidden
        />
      </div>
    </div>
  );
}
