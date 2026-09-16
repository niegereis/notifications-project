import type { ArgumentsHost } from '@nestjs/common';

import { RateLimitedException } from './rate-limited.exception.js';
import { RateLimitedExceptionFilter } from './rate-limited.exception-filter.js';

describe('RateLimitedExceptionFilter', () => {
  it('devolve 429 com o header Retry-After', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const setHeader = vi.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ setHeader, status }),
      }),
    } as unknown as ArgumentsHost;

    new RateLimitedExceptionFilter().catch(new RateLimitedException(42), host);

    expect(setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Limite de envios para este destinatário foi atingido. Tente de novo em instantes.',
      retryAfterSeconds: 42,
    });
  });
});
