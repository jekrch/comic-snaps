import { useEffect, useRef, useState, useCallback } from "react";
import { Bird } from "lucide-react";

export default function BirdIcon() {
  const birdRef = useRef<SVGSVGElement>(null);
  const birdMaskedRef = useRef<SVGSVGElement>(null);
  const [introComplete, setIntroComplete] = useState(false);
  const introCompleteRef = useRef(false);
  const [atTop, setAtTop] = useState(true);

  const triggerPeck = useCallback(() => {
    if (!introCompleteRef.current) return;
    for (const bird of [birdRef.current, birdMaskedRef.current]) {
      if (!bird) continue;
      bird.classList.remove("bird-peck-scroll");
      void (bird as unknown as HTMLElement).offsetWidth;
      bird.classList.add("bird-peck-scroll");
    }
  }, []);

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
      setAtTop(window.scrollY <= 0);
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
        <Bird
          ref={birdRef}
          size={70}
          strokeWidth={1.5}
          className="ml-6 stroke-[#8d422f] bird-base"
        />
      </div>
      {/* Masked bird — fades in after intro, always visible once intro is done */}
      <div
        className={`h-7 flex items-end overflow-hidden absolute inset-0 transition-opacity duration-700 ease-in ${introComplete ? 'opacity-100' : 'opacity-0'}`}
        style={{
          maskImage: `repeating-linear-gradient(to bottom,
            black 0px, black 10px, transparent 4px, transparent 3px),
            linear-gradient(to bottom, black 40%, transparent 90%)`,
          WebkitMaskImage: `repeating-linear-gradient(to bottom,
            black 0px, black 10px, transparent 2px, transparent 3px),
            linear-gradient(to bottom, black 40%, transparent 90%)`,
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
        }}
      >
        <Bird
          ref={birdMaskedRef}
          size={70}
          strokeWidth={1.5}
          className="ml-6 stroke-[#8d422f] bird-base"
          aria-hidden
        />
      </div>
    </div>
  );
}
