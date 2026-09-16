import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ApiKeyGuard } from './guards/api-key.guard.js';
import { ApiKeyService } from './services/api-key.service.js';
import { AuthController } from './controllers/auth.controller.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [ApiKeyService, { provide: APP_GUARD, useClass: ApiKeyGuard }],
  exports: [ApiKeyService],
})
export class AuthModule {}
