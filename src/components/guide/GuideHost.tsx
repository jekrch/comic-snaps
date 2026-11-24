import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { Panel } from "../../types";
import type { MetricKey } from "../graph/similarityConfig";
import { notifyGuideExited, useGuideRoute } from "./useGuideRoute";

// The Guide and every lesson in it load only when it's first opened.
const Guide = lazy(() => import("./Guide"));

/**
 * Where the Guide lives in the app: mounted while its route is open, and
 * for as long as it takes to leave after that. Everything that opens the
 * Guide does it through `openGuide`, so nothing has to thread props here.
 */
export default function GuideHost({
  panels,
  onSortBy,
}: {
  panels: Panel[];
  onSortBy?: (metric: MetricKey) => void;
}) {
  const state = useGuideRoute();
  const [mounted, setMounted] = useState(state.route !== null);

  useEffect(() => {
    if (state.route) setMounted(true);
  }, [state.route]);

  const onExited = useCallback(() => {
    setMounted(false);
    // After the unmount has handed the page back.
    window.setTimeout(notifyGuideExited, 0);
  }, []);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <Guide panels={panels} state={state} onExited={onExited} onSortBy={onSortBy} />
    </Suspense>
  );
}
