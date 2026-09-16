import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ApiKeyService } from '../services/api-key.service.js';
import { API_CLIENT_REQUEST_KEY, API_KEY_HEADER, type ApiClient } from '../types/api-key.types.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.header(API_KEY_HEADER);

    if (!apiKey) {
      throw new UnauthorizedException(`Header ${API_KEY_HEADER} é obrigatório.`);
    }

    const client = this.apiKeyService.resolveClient(apiKey);

    if (!client) {
      throw new UnauthorizedException('API key inválida.');
    }

    (request as Request & { [API_CLIENT_REQUEST_KEY]?: ApiClient })[API_CLIENT_REQUEST_KEY] =
      client;

    return true;
  }
}
