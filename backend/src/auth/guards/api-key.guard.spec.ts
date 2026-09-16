import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeyService } from '../services/api-key.service.js';
import { ApiClient } from '../types/api-key.types.js';

const KNOWN_KEY = 'chave-conhecida-com-tamanho-ok';

interface FakeRequest {
  header: (name: string) => string | undefined;
  apiClient?: ApiClient;
}

function contextWith(request: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function guardWith(isPublic: boolean): { guard: ApiKeyGuard } {
  const apiKeyService = {
    resolveClient: (key: string) => (key === KNOWN_KEY ? { name: 'billing' } : null),
  } as ApiKeyService;

  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;

  return { guard: new ApiKeyGuard(apiKeyService, reflector) };
}

describe('ApiKeyGuard', () => {
  it('libera rota pública sem exigir chave', () => {
    const { guard } = guardWith(true);

    expect(guard.canActivate(contextWith({ header: () => undefined }))).toBe(true);
  });

  it('recusa request sem o header', () => {
    const { guard } = guardWith(false);

    expect(() => guard.canActivate(contextWith({ header: () => undefined }))).toThrow(
      UnauthorizedException,
    );
  });

  it('recusa chave desconhecida', () => {
    const { guard } = guardWith(false);

    expect(() =>
      guard.canActivate(contextWith({ header: () => 'chave-errada-1234567890' })),
    ).toThrow(UnauthorizedException);
  });

  it('aceita chave válida e anexa o cliente à request', () => {
    const { guard } = guardWith(false);
    const request: FakeRequest = { header: () => KNOWN_KEY };

    expect(guard.canActivate(contextWith(request))).toBe(true);
    expect(request.apiClient).toEqual({ name: 'billing' });
  });
});
