import { createServer, type Server } from 'node:http';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MetricsService } from './metrics.service.js';

const DEFAULT_PORT = 9464;

@Injectable()
export class MetricsHttpServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsHttpServer.name);
  private server: Server | null = null;

  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const port = this.config.get<number>('METRICS_PORT') ?? DEFAULT_PORT;

    this.server = createServer((request, response) => {
      const path = request.url?.split('?')[0];

      if (path !== '/metrics' && path !== '/metrics/') {
        response.writeHead(404).end();
        return;
      }

      void this.metrics.render().then(
        (body) => {
          response.writeHead(200, { 'Content-Type': this.metrics.contentType() }).end(body);
        },
        () => {
          response.writeHead(500).end();
        },
      );
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, '0.0.0.0', () => resolve());
    });

    this.logger.log(`Métricas do worker em http://0.0.0.0:${port}/metrics`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
