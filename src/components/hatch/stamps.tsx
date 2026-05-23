import { useEffect, useState } from "react";
import { Bird, Eye, Globe } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createRoot } from "react-dom/client";

export const WORDS = ["SNAPS"];

export const LUCIDE_ICONS: LucideIcon[] = [Bird, Globe, Eye];

export type StampDef =
  | { type: "word"; value: string }
  | { type: "icon"; value: LucideIcon };

/** Build the full pool of possible stamps for external sequencing. */
export function buildStampPool(): StampDef[] {
  const pool: StampDef[] = [];
  for (const word of WORDS) pool.push({ type: "word", value: word });
  for (const icon of LUCIDE_ICONS) pool.push({ type: "icon", value: icon });
  return pool;
}

/**
 * Render a Lucide icon offscreen, extract the raw SVG children, and return
 * them as an HTML string suitable for dangerouslySetInnerHTML inside an
 * <svg> mask.
 */
function extractLucideSvgContent(IconComponent: LucideIcon): Promise<string> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    document.body.appendChild(container);

    let cleaned = false;
    const root = createRoot(container);

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      root.unmount();
      container.parentNode?.removeChild(container);
    };

    const tryExtract = () => container.querySelector("svg")?.innerHTML ?? null;

    const observer = new MutationObserver(() => {
      const content = tryExtract();
      if (content) {
        observer.disconnect();
        cleanup();
        resolve(content);
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    root.render(<IconComponent size={24} strokeWidth={2} color="black" fill="none" />);

    setTimeout(() => {
      observer.disconnect();
      const content = tryExtract();
      cleanup();
      resolve(content ?? "");
    }, 500);
  });
}

export function useLucideExtract(IconComponent: LucideIcon | null): string | null {
  const [svgContent, setSvgContent] = useState<string | null>(null);

  useEffect(() => {
    if (!IconComponent) {
      setSvgContent(null);
      return;
    }
    let cancelled = false;
    extractLucideSvgContent(IconComponent).then((content) => {
      if (!cancelled) setSvgContent(content);
    });
    return () => { cancelled = true; };
  }, [IconComponent]);

  return svgContent;
}
