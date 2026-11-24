import { useGuide } from "./guideContext";
import type { PageId } from "./lessons";
import { getGuideState, guideUrl } from "./useGuideRoute";

/**
 * A link to another place in the Guide. A real href (so it can be opened in
 * a new tab or copied) that moves within the open Guide on a plain click.
 */
export function GuideLink({
  to,
  step,
  children,
  className = "guide-link",
}: {
  to: PageId;
  step?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { goTo } = useGuide();
  const route = getGuideState().route;
  const href =
    typeof window === "undefined"
      ? "#"
      : guideUrl(window.location.pathname, window.location.search, {
          page: to,
          step: step ?? null,
          anchor: route?.anchor ?? null,
        });
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        goTo(to, step);
      }}
    >
      {children}
    </a>
  );
}

/** A short reminder of theory taught elsewhere, with the way back to it. */
export function Recap({ to, step, label, children }: { to: PageId; step?: string; label: string; children: React.ReactNode }) {
  return (
    <p className="guide-recap">
      {children}{" "}
      <GuideLink to={to} step={step}>
        {label} →
      </GuideLink>
    </p>
  );
}
