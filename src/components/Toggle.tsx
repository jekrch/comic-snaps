const RULE = "border-[var(--color-border,rgba(74,71,69,0.25))]";

/** One easing for the track and the knob, so they land together. */
const SWITCH_EASE = "260ms cubic-bezier(0.32, 0.72, 0, 1)";

/** A switch's visual only; the clickable element around it carries the
 *  `role="switch"` and `aria-checked`. */
export default function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative shrink-0 inline-block w-[30px] h-4 rounded-full border ${
        on ? "bg-accent border-accent" : `bg-white/[0.06] ${RULE}`
      }`}
      style={{ transition: `background-color ${SWITCH_EASE}, border-color ${SWITCH_EASE}` }}
    >
      {/* Slid with an inline transform: Tailwind 4's translate utilities set
          `translate`, which a transform transition would skip over. */}
      <span
        className={`absolute top-[2px] left-[2px] size-[10px] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.4)] ${
          on ? "bg-white" : "bg-ink-faint"
        }`}
        style={{
          transform: `translateX(${on ? 14 : 0}px)`,
          transition: `transform ${SWITCH_EASE}, background-color ${SWITCH_EASE}`,
        }}
      />
    </span>
  );
}
