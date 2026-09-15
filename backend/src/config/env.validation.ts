import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  METRICS_PORT?: number;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  REDIS_URL: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  IDEMPOTENCY_TTL_SECONDS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  RATE_LIMIT_MAX?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  RATE_LIMIT_WINDOW_SECONDS?: number;

  @IsUrl({ protocols: ['amqp', 'amqps'], require_tld: false })
  RABBITMQ_URL: string;

  @IsString()
  @IsNotEmpty()
  API_KEYS: string;

  @IsString()
  @IsNotEmpty()
  SMTP_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsString()
  @IsNotEmpty()
  MAIL_FROM: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  TWILIO_ACCOUNT_SID?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  TWILIO_AUTH_TOKEN?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  TWILIO_FROM?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  FCM_PROJECT_ID?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  FCM_CLIENT_EMAIL?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  FCM_PRIVATE_KEY?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MinLength(16)
  WEBHOOK_SECRET?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    excludeExtraneousValues: false,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('\n  ');

    throw new Error(`Configuração inválida. Corrija as variáveis de ambiente:\n  ${details}`);
  }

  return validated;
}

function blankToUndefined({ value }: { value: unknown }): unknown {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}
