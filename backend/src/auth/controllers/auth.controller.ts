import { Controller, Get } from '@nestjs/common';

// `import type` é exigido pelo TypeScript para tipos usados em assinaturas
// decoradas quando isolatedModules e emitDecoratorMetadata estão ligados.
import type { ApiClient } from '../types/api-key.types.js';
import { CurrentClient } from '../decorators/current-client.decorator.js';

@Controller('auth')
export class AuthController {
  @Get('whoami')
  whoami(@CurrentClient() client: ApiClient): { client: string } {
    return { client: client.name };
  }
}
