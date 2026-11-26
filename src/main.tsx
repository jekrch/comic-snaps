import { StrictMode } from "react";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
