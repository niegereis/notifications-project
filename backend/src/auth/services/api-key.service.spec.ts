import { ConfigService } from '@nestjs/config';

import { ApiKeyService } from './api-key.service.js';

function serviceWith(apiKeys: string): ApiKeyService {
  const configService = { getOrThrow: () => apiKeys } as unknown as ConfigService;

  return new ApiKeyService(configService);
}

const VALID_KEY = 'chave-de-teste-com-tamanho-ok';
const OTHER_KEY = 'outra-chave-com-tamanho-ok';

describe('ApiKeyService', () => {
  it('resolve o serviço dono da chave', () => {
    const service = serviceWith(`billing:${VALID_KEY},crm:${OTHER_KEY}`);

    expect(service.resolveClient(VALID_KEY)).toEqual({ name: 'billing' });
    expect(service.resolveClient(OTHER_KEY)).toEqual({ name: 'crm' });
  });

  it('devolve null para chave desconhecida', () => {
    const service = serviceWith(`billing:${VALID_KEY}`);

    expect(service.resolveClient('chave-que-ninguem-tem-1234')).toBeNull();
  });

  it('ignora espaços em volta das entradas', () => {
    const service = serviceWith(`  billing : ${VALID_KEY} `);

    expect(service.resolveClient(VALID_KEY)).toEqual({ name: 'billing' });
  });

  it('falha quando nenhuma chave é configurada', () => {
    expect(() => serviceWith('   ')).toThrow(/ao menos uma chave/);
  });

  it('falha quando a entrada não segue o formato servico:chave', () => {
    expect(() => serviceWith(VALID_KEY)).toThrow(/formato/);
  });

  it('falha quando a chave é curta demais', () => {
    expect(() => serviceWith('billing:curta')).toThrow(/menos de 16 caracteres/);
  });

  it('falha quando o mesmo serviço aparece duas vezes', () => {
    expect(() => serviceWith(`billing:${VALID_KEY},billing:${OTHER_KEY}`)).toThrow(
      /mais de uma vez/,
    );
  });

  it('falha quando a mesma chave serve a dois serviços', () => {
    expect(() => serviceWith(`billing:${VALID_KEY},crm:${VALID_KEY}`)).toThrow(
      /mais de um serviço/,
    );
  });
});
