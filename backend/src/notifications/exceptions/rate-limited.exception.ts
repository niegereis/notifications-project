import { HttpException, HttpStatus } from '@nestjs/common';

export class RateLimitedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message:
          'Limite de envios para este destinatário foi atingido. Tente de novo em instantes.',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
