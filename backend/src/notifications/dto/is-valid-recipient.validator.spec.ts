import { validate } from 'class-validator';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { IsValidRecipient } from './is-valid-recipient.validator.js';

class Sample {
  channel!: NotificationChannel;

  @IsValidRecipient()
  recipient!: string;
}

async function errorsOf(channel: NotificationChannel, recipient: string): Promise<string[]> {
  const sample = Object.assign(new Sample(), { channel, recipient });
  const errors = await validate(sample);

  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('IsValidRecipient', () => {
  it('aceita e-mail no canal EMAIL', async () => {
    await expect(errorsOf(NotificationChannel.EMAIL, 'ana@exemplo.com')).resolves.toEqual([]);
  });

  it('recusa e-mail inválido no canal EMAIL', async () => {
    await expect(errorsOf(NotificationChannel.EMAIL, 'ana')).resolves.toEqual([
      'recipient deve ser um e-mail válido para o canal email.',
    ]);
  });

  it('aceita telefone E.164 no canal SMS', async () => {
    await expect(errorsOf(NotificationChannel.SMS, '+5511999999999')).resolves.toEqual([]);
  });

  it('recusa telefone sem o mais no canal SMS', async () => {
    await expect(errorsOf(NotificationChannel.SMS, '11999999999')).resolves.toEqual([
      'recipient deve ser um telefone no formato E.164 (ex.: +5511999999999) para o canal sms.',
    ]);
  });

  it('aceita device token longo no canal PUSH', async () => {
    await expect(errorsOf(NotificationChannel.PUSH, 'a'.repeat(16))).resolves.toEqual([]);
  });

  it('recusa device token curto no canal PUSH', async () => {
    await expect(errorsOf(NotificationChannel.PUSH, 'curto')).resolves.toEqual([
      'recipient deve ser um device token com pelo menos 16 caracteres para o canal push.',
    ]);
  });
});
