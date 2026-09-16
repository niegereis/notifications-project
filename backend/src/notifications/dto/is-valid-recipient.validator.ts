import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_E164 = /^\+[1-9]\d{7,14}$/;
const MIN_DEVICE_TOKEN_LENGTH = 16;

@ValidatorConstraint({ name: 'isValidRecipient' })
class IsValidRecipientConstraint implements ValidatorConstraintInterface {
  validate(recipient: unknown, args: ValidationArguments): boolean {
    if (typeof recipient !== 'string') {
      return false;
    }

    switch ((args.object as { channel?: NotificationChannel }).channel) {
      case NotificationChannel.EMAIL:
        return EMAIL.test(recipient);
      case NotificationChannel.SMS:
        return PHONE_E164.test(recipient);
      case NotificationChannel.PUSH:
        return recipient.length >= MIN_DEVICE_TOKEN_LENGTH;
      default:
        return true;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    switch ((args.object as { channel?: NotificationChannel }).channel) {
      case NotificationChannel.EMAIL:
        return 'recipient deve ser um e-mail válido para o canal email.';
      case NotificationChannel.SMS:
        return 'recipient deve ser um telefone no formato E.164 (ex.: +5511999999999) para o canal sms.';
      case NotificationChannel.PUSH:
        return `recipient deve ser um device token com pelo menos ${MIN_DEVICE_TOKEN_LENGTH} caracteres para o canal push.`;
      default:
        return 'recipient inválido.';
    }
  }
}

export function IsValidRecipient(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: IsValidRecipientConstraint,
    });
  };
}
