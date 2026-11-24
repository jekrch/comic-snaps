import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { registerSW } from "./registerSW.ts";
import { initGuideRoute } from "./components/guide/useGuideRoute";

registerSW();
// Before the first render: a Guide link strips the layers the Guide covers
// from the URL, and the app reads the URL as it mounts.
initGuideRoute();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
