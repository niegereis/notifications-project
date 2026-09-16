import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { parseNotificationMessage } from './notification.message.js';

describe('parseNotificationMessage', () => {
  it('lê o id e o canal de uma mensagem válida', () => {
    const content = Buffer.from(
      JSON.stringify({ notificationId: 'abc', channel: NotificationChannel.EMAIL }),
    );

    expect(parseNotificationMessage(content)).toEqual({
      notificationId: 'abc',
      channel: NotificationChannel.EMAIL,
    });
  });

  it('descarta JSON que não é o contrato da fila', () => {
    expect(parseNotificationMessage(Buffer.from('{'))).toBeNull();
    expect(parseNotificationMessage(Buffer.from('[]'))).toBeNull();
    expect(parseNotificationMessage(Buffer.from(JSON.stringify({ channel: 'EMAIL' })))).toBeNull();
  });
});
