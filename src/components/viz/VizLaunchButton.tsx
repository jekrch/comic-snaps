import { Blend } from "lucide-react";

interface VizLaunchButtonProps {
  onLaunch: () => void;
  disabled?: boolean;
}

/**
 * Sits at the foot of the filter list, so a run always starts from the wall
 * exactly as the reader has narrowed it. The overlapping-circles mark is the
 * compositing model itself — superimposed panels, blended.
 */
export default function VizLaunchButton({ onLaunch, disabled }: VizLaunchButtonProps) {
  return (
    <button
      onClick={onLaunch}
      disabled={disabled}
      title=""
      className="
        w-full flex items-center gap-1.5
        px-3 py-2
        font-display text-[10px] tracking-wider uppercase
        text-white/60 hover:text-accent
        transition-colors duration-100
        disabled:opacity-30 disabled:hover:text-white/60 disabled:cursor-default
        cursor-pointer
      "
    >
      <Blend size={12} className="text-accent" />
      VISUALIZE
    </button>
  );
}
