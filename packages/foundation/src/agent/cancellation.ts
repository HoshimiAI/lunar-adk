export function createCancellation() {
  const controller = new AbortController();
  return { signal: controller.signal, cancel: () => controller.abort() };
}
