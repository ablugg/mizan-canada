/**
 * Cross-encoder reranker using bge-reranker-base via transformers.js (ONNX).
 *
 * Scores query-passage pairs jointly, providing a calibratable relevance
 * signal that separates relevant from irrelevant passages far more cleanly
 * than cosine distance on a homogeneous legal corpus.
 *
 * The model is loaded lazily on first use and cached for the process lifetime.
 */

let _tokenizer: Awaited<ReturnType<typeof import("@huggingface/transformers")["AutoTokenizer"]["from_pretrained"]>> | null = null;
let _model: Awaited<ReturnType<typeof import("@huggingface/transformers")["AutoModelForSequenceClassification"]["from_pretrained"]>> | null = null;
let _loading: Promise<void> | null = null;

const MODEL_ID = "BAAI/bge-reranker-base";

async function ensureLoaded() {
  if (_tokenizer && _model) return;
  if (_loading) { await _loading; return; }

  _loading = (async () => {
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@huggingface/transformers");
    const t0 = Date.now();
    _tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    _model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID);
    console.log(`[reranker] ${MODEL_ID} loaded in ${Date.now() - t0}ms`);
  })();

  await _loading;
}

export interface RerankResult {
  index: number;
  score: number;
}

/**
 * Score and rank passages against a query using a cross-encoder.
 * Returns results sorted by score descending (most relevant first).
 */
export async function rerank(
  query: string,
  passages: string[],
): Promise<RerankResult[]> {
  if (passages.length === 0) return [];

  await ensureLoaded();
  const tokenizer = _tokenizer!;
  const model = _model!;

  const t0 = Date.now();
  const results: RerankResult[] = [];

  for (let i = 0; i < passages.length; i++) {
    const inputs = await tokenizer(query, {
      text_pair: passages[i],
      padding: true,
      truncation: true,
    });
    const output = await model(inputs);
    // Raw logit score — higher means more relevant.
    // bge-reranker-base: relevant passages typically score > -5, irrelevant < -7.
    const score = (output as { logits: { data: Float32Array } }).logits.data[0];
    results.push({ index: i, score });
  }

  console.log(`[reranker] Scored ${passages.length} passages in ${Date.now() - t0}ms`);

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Returns the best (highest) reranker score from a set of results.
 * Used for abstention decisions.
 */
export function bestScore(results: RerankResult[]): number {
  if (results.length === 0) return -Infinity;
  return results[0].score; // already sorted descending
}
