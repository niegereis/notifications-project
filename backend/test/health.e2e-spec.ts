import type { Server } from 'node:http';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';

describe('Health (e2e)', () => {
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

  it('GET /health devolve 200 e status ok', async () => {
    const response = await request(server).get('/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      info: { app: { status: 'up' } },
    });
  });

  it('GET /health/ready devolve 200', async () => {
    await request(server).get('/health/ready').expect(200);
  });

  it('GET /metrics devolve o formato Prometheus sem API key', async () => {
    const response = await request(server).get('/metrics').expect(200);

    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain('notifications_accepted_total');
    expect(response.text).toContain('notifications_sent_total');
  });
});
