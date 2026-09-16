import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiClient } from '../types/api-key.types.js';

const MIN_KEY_LENGTH = 16;

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  private readonly clientsByKeyHash: ReadonlyMap<string, ApiClient>;

  constructor(configService: ConfigService) {
    this.clientsByKeyHash = ApiKeyService.parse(configService.getOrThrow<string>('API_KEYS'));
    this.logger.log(`${this.clientsByKeyHash.size} API key(s) carregada(s)`);
  }

  resolveClient(apiKey: string): ApiClient | null {
    return this.clientsByKeyHash.get(ApiKeyService.hash(apiKey)) ?? null;
  }

  private static hash(apiKey: string): string {
    return createHash('sha256').update(apiKey, 'utf8').digest('hex');
  }

  private static parse(raw: string): ReadonlyMap<string, ApiClient> {
    const clientsByKeyHash = new Map<string, ApiClient>();
    const names = new Set<string>();

    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (entries.length === 0) {
      throw new Error('API_KEYS está vazio: defina ao menos uma chave no formato `servico:chave`.');
    }

    for (const entry of entries) {
      const separatorIndex = entry.indexOf(':');

      if (separatorIndex <= 0) {
        throw new Error(`API_KEYS: entrada "${entry}" não segue o formato \`servico:chave\`.`);
      }

      const name = entry.slice(0, separatorIndex).trim();
      const key = entry.slice(separatorIndex + 1).trim();

      if (key.length < MIN_KEY_LENGTH) {
        throw new Error(
          `API_KEYS: a chave do serviço "${name}" tem menos de ${MIN_KEY_LENGTH} caracteres. ` +
            'Gere uma com `openssl rand -hex 32`.',
        );
      }

      if (names.has(name)) {
        throw new Error(`API_KEYS: o serviço "${name}" aparece mais de uma vez.`);
      }

      const keyHash = ApiKeyService.hash(key);

      if (clientsByKeyHash.has(keyHash)) {
        throw new Error(`API_KEYS: a mesma chave está atribuída a mais de um serviço.`);
      }

      names.add(name);
      clientsByKeyHash.set(keyHash, { name });
    }

    return clientsByKeyHash;
  }
}
