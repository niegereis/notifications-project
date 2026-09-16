import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TemplateRenderer } from './services/template-renderer.js';
import { Template } from './entities/template.entity.js';
import { TemplatesService } from './services/templates.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Template])],
  providers: [TemplateRenderer, TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
