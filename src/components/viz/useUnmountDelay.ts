import { useEffect, useState } from "react";

export interface MountState {
  /** Whether to render the content at all. */
  mounted: boolean;
  /** True while it is rendered but on its way out. */
  leaving: boolean;
}

/**
 * Holds content mounted for `ms` after it closes, so an exit transition has
 * something to run on.
 *
 * The alternative — leaving the content permanently mounted and hiding it — is
 * what the auto-hiding chrome does, but this is for a panel that is closed most
 * of the time and does real work while it is open (a stats poll, a hundred-odd
 * live-bound inputs). Keeping it unmounted when hidden costs nothing; this only
 * defers the teardown long enough for the slide to finish.
 */
export function useUnmountDelay(open: boolean, ms: number): MountState {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const id = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(id);
  }, [open, ms, mounted]);

  return { mounted, leaving: mounted && !open };
}
