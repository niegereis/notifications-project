import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { fingerprintOf } from './request-fingerprint.js';

describe('fingerprintOf', () => {
  it('é estável mesmo com chaves do payload em ordem diferente', () => {
    const left = fingerprintOf({
      channel: NotificationChannel.EMAIL,
      eventType: 'user.welcome',
      recipient: 'ana@exemplo.com',
      payload: { nome: 'Ana', produto: 'Gateway' },
    });
    const right = fingerprintOf({
      channel: NotificationChannel.EMAIL,
      eventType: 'user.welcome',
      recipient: 'ana@exemplo.com',
      payload: { produto: 'Gateway', nome: 'Ana' },
    });

    expect(left).toBe(right);
  });

  it('muda quando o destinatário muda', () => {
    const left = fingerprintOf({
      channel: NotificationChannel.EMAIL,
      eventType: 'user.welcome',
      recipient: 'ana@exemplo.com',
    });
    const right = fingerprintOf({
      channel: NotificationChannel.EMAIL,
      eventType: 'user.welcome',
      recipient: 'bruno@exemplo.com',
    });

    expect(left).not.toBe(right);
  });

  it('muda quando o callbackUrl muda', () => {
    const left = fingerprintOf({
      channel: NotificationChannel.EMAIL,
      eventType: 'user.welcome',
      recipient: 'ana@exemplo.com',
      callbackUrl: 'https://a.exemplo/hooks',
    });
    const right = fingerprintOf({
      channel: NotificationChannel.EMAIL,
      eventType: 'user.welcome',
      recipient: 'ana@exemplo.com',
      callbackUrl: 'https://b.exemplo/hooks',
    });

    expect(left).not.toBe(right);
  });
});
