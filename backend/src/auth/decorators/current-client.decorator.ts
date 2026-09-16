import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

import { API_CLIENT_REQUEST_KEY, type ApiClient } from '../types/api-key.types.js';

export const CurrentClient = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApiClient => {
    const request = context.switchToHttp().getRequest<Request & { apiClient?: ApiClient }>();
    const client = request[API_CLIENT_REQUEST_KEY];

    if (!client) {
      throw new Error(
        'Nenhum cliente autenticado na request: @CurrentClient exige uma rota protegida pelo ApiKeyGuard.',
      );
    }

    return client;
  },
);
