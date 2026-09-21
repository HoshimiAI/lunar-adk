export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: (attempt: number) => number;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: (attempt) => 2 ** attempt * 250,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < policy.maxAttempts - 1) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, policy.backoffMs(attempt));
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted", "AbortError"));
          }, { once: true });
        });
      }
    }
  }
  throw lastError;
}
