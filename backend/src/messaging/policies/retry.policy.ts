export const MAX_DELIVERY_ATTEMPTS = 3;
export const RETRY_DELAYS_MS = [1_000, 5_000] as const;

export function retryDelayAfter(attemptNumber: number): number | null {
  return RETRY_DELAYS_MS[attemptNumber - 1] ?? null;
}
