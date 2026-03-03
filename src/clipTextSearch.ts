/**
 * clipTextSearch.ts
 *
 * Browser-side SigLIP text encoding via Transformers.js.
 *
 * SigLIP base (patch16-224) has no separate projection heads — the text
 * and vision backbone pooler outputs are the shared embedding space.
 * SiglipTextModel.pooler_output matches get_image_features() directly.
 *
 * SigLIP uses sigmoid loss rather than softmax contrastive loss, so
 * cross-modal cosine similarities are much lower than CLIP. Typical
 * meaningful matches score 0.02–0.10 rather than 0.15–0.35.
 *
 * Install:  npm install @huggingface/transformers
 */

import { AutoTokenizer, SiglipTextModel, env } from "@huggingface/transformers";

env.allowLocalModels = false;

const MODEL_ID = "Xenova/siglip-base-patch16-224";

let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
let textModel: Awaited<ReturnType<typeof SiglipTextModel.from_pretrained>> | null = null;
let loadingPromise: Promise<void> | null = null;

export async function initTextEncoder(
  onProgress?: (progress: { status: string; progress?: number; file?: string }) => void,
): Promise<void> {
  if (tokenizer && textModel) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
      progress_callback: onProgress,
    });
    textModel = await SiglipTextModel.from_pretrained(MODEL_ID, {
      dtype: "q8",
      progress_callback: onProgress,
    });
  })();

  return loadingPromise;
}

export function isTextEncoderReady(): boolean {
  return tokenizer !== null && textModel !== null;
}

export async function encodeText(query: string): Promise<Float32Array> {
  if (!tokenizer || !textModel) {
    throw new Error("Text encoder not initialized. Call initTextEncoder() first.");
  }

  const inputs = await tokenizer(query, {
    padding: "max_length",
    truncation: true,
  });

  const { pooler_output } = await textModel(inputs);
  const raw = pooler_output.data as Float32Array;

  // L2-normalize
  const vec = new Float32Array(raw.length);
  let norm = 0;
  for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < raw.length; i++) vec[i] = raw[i] / norm;
  }
  return vec;
}

function cosineSimilarity(a: Float32Array, b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

export interface TextSearchResult {
  panelId: string;
  score: number;
}

/**
 * Rank all panels by similarity to a text query.
 * Returns results sorted most-similar-first (descending by cosine score).
 */
export function rankPanelsByTextQuery(
  queryEmbedding: Float32Array,
  imageEmbeddings: Record<string, number[]>,
  threshold = 0.01,
  topK?: number,
): TextSearchResult[] {
  const results: TextSearchResult[] = [];

  for (const [panelId, imgEmb] of Object.entries(imageEmbeddings)) {
    const score = cosineSimilarity(queryEmbedding, imgEmb);
    if (score >= threshold) {
      results.push({ panelId, score });
    }
  }

  results.sort((a, b) => b.score - a.score);

  if (topK !== undefined && topK > 0) {
    return results.slice(0, topK);
  }
  return results;
}