import { useEffect, useState } from "react";

let viewerOpen = false;
const listeners = new Set<() => void>();

export function setHatchViewerOpen(open: boolean): void {
  if (viewerOpen === open) return;
  viewerOpen = open;
  listeners.forEach((l) => l());
}

export function useHatchViewerOpen(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return viewerOpen;
}
