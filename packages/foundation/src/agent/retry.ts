export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: (attempt: number) => number;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: (attempt) => 2 ** attempt * 250,
};

export async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy = defaultRetryPolicy): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < policy.maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, policy.backoffMs(attempt)));
      }
    }
  }
  throw lastError;
}
