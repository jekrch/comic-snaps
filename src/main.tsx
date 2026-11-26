import { StrictMode, Suspense, lazy, useState } from "react";
import type { PreviewMode } from "./components/dimensional/DimensionalPreview";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { registerSW } from "./registerSW.ts";
import { getGuideState, initGuideRoute } from "./components/guide/useGuideRoute";
import { coverAppForGuide, releaseGuideCover } from "./components/guide/appBehind";

registerSW();
// Before the first render: a Guide link strips the layers the Guide covers
// from the URL, and the app reads the URL as it mounts.
initGuideRoute();

// Landing on a Guide link: don't paint the gallery while the Guide's chunk
// loads, and start loading it now rather than once the app has rendered.
// If the chunk fails, show the gallery rather than nothing.
if (getGuideState().route) {
  coverAppForGuide();
  import("./components/guide/Guide").catch(releaseGuideCover);
}

// `?dd`: the dimensional-docs framework's preview (src/dimensional), rendering
// docs/dimensional-docs. Page and embedded modes stand alone; overlay mode
// slides over the gallery.
const ddMode = new URLSearchParams(location.search).has("dd")
  ? (new URLSearchParams(location.search).get("dd-host") as PreviewMode | null) ?? "page"
  : null;
const DimensionalPreview = ddMode ? lazy(() => import("./components/dimensional/DimensionalPreview")) : null;

function DimensionalRoot() {
  const [open, setOpen] = useState(true);
  if (!DimensionalPreview || !ddMode || !open) return null;
  return (
    <Suspense fallback={null}>
      <DimensionalPreview mode={ddMode} onExited={() => setOpen(false)} />
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {ddMode && ddMode !== "overlay" ? (
      <DimensionalRoot />
    ) : (
      <>
        <App />
        <DimensionalRoot />
      </>
    )}
  </StrictMode>
);
