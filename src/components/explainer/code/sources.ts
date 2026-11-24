/**
 * The source files the explainer's code views quote, bundled as text.
 * Only CodeViewer imports this, and CodeViewer is loaded lazily, so the
 * text stays out of the main bundle until someone opens a code view.
 */
import computeEmbeddings from "../../../../scripts/compute-embeddings.py?raw";
import computePatchMaps from "../../../../scripts/compute-patch-maps.py?raw";
import imageMetadata from "../../../../scripts/metadata/image_metadata.py?raw";
import sorting from "../../../utils/sorting.ts?raw";
import similarityUtils from "../../../utils/similarityUtils.ts?raw";
import patchMaps from "../patchMaps.ts?raw";

export const SOURCES: Record<string, string> = {
  "scripts/compute-embeddings.py": computeEmbeddings,
  "scripts/compute-patch-maps.py": computePatchMaps,
  "scripts/metadata/image_metadata.py": imageMetadata,
  "src/utils/sorting.ts": sorting,
  "src/utils/similarityUtils.ts": similarityUtils,
  "src/components/explainer/patchMaps.ts": patchMaps,
};
