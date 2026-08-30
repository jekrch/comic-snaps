import { Rows3, LayoutGrid } from "lucide-react";

/**
 * Two readings of the same filtered set: the wall, one card per panel, and the
 * shelf, one row per series (docs/series-view-plan.md §5.1).
 */
export type GalleryView = "wall" | "series";

interface Props {
  view: GalleryView;
  onViewChange: (view: GalleryView) => void;
}

/**
 * The way across, tucked into the bottom of the filter list beside the
 * visualizer launch.
 *
 * One control naming where it goes, not a pair of pills naming where you are:
 * the view is already obvious from the page, and a segmented toggle parked
 * permanently over the wall claimed more of it than a second reading of the
 * same set deserves. It sits with the other action on the narrowed set, since
 * that is what it is — both views take the filters with them.
 */
export default function ViewControl({ view, onViewChange }: Props) {
  const goingToSeries = view === "wall";
  const Icon = goingToSeries ? Rows3 : LayoutGrid;

  return (
    <button
      onClick={() => onViewChange(goingToSeries ? "series" : "wall")}
      className="
        w-full flex items-center gap-1.5
        px-3 py-2
        font-display text-[10px] tracking-wider uppercase
        text-white/60 hover:text-accent
        transition-colors duration-100
        cursor-pointer
      "
    >
      <Icon size={12} className="text-accent shrink-0" />
      {goingToSeries ? "BY SERIES" : "BY PANEL"}
    </button>
  );
}
