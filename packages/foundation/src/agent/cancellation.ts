export function createCancellation() {
  const controller = new AbortController();
  return { signal: controller.signal, cancel: () => controller.abort() };
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}
