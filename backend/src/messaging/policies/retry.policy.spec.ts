import { MAX_DELIVERY_ATTEMPTS, retryDelayAfter } from './retry.policy.js';

describe('retryDelayAfter', () => {
  it('espera 1s depois da primeira falha e 5s depois da segunda', () => {
    expect(retryDelayAfter(1)).toBe(1_000);
    expect(retryDelayAfter(2)).toBe(5_000);
  });

  it('esgota na última tentativa', () => {
    expect(retryDelayAfter(MAX_DELIVERY_ATTEMPTS)).toBeNull();
  });
});
