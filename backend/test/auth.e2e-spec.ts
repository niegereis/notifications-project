import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { API_KEY_HEADER } from '../src/auth/types/api-key.types.js';
import { TEST_API_KEY, TEST_CLIENT_NAME } from './setup-env.js';

describe('Auth por API key (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('recusa rota protegida sem API key', async () => {
    await request(server).get('/auth/whoami').expect(401);
  });

  it('recusa API key desconhecida', async () => {
    await request(server)
      .get('/auth/whoami')
      .set(API_KEY_HEADER, 'chave-que-ninguem-tem-1234567890')
      .expect(401);
  });

  it('aceita API key válida e identifica o serviço chamador', async () => {
    const response = await request(server)
      .get('/auth/whoami')
      .set(API_KEY_HEADER, TEST_API_KEY)
      .expect(200);

    expect(response.body).toEqual({ client: TEST_CLIENT_NAME });
  });

  it('mantém o health público', async () => {
    await request(server).get('/health').expect(200);
    await request(server).get('/health/ready').expect(200);
  });
});
