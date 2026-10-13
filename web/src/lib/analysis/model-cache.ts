/**
 * Memoizes an async load until it fails. A result, including null for "no model published",
 * is kept for the worker's lifetime; a failure is reported once and then forgotten, so a
 * network error does not disable the model until the worker restarts.
 */
export function cacheUntilFailure<T>(load: () => Promise<T>): () => Promise<T | { error: string }> {
  let pending: Promise<T | { error: string }> | null = null;
  return () => {
    pending ??= load().catch((error: Error) => {
      pending = null;
      return { error: error.message };
    });
    return pending;
  };
}
