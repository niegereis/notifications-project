import 'dotenv/config';

import { NotificationChannel } from '../common/enums/notification-channel.enum.js';
import { Template } from '../templates/entities/template.entity.js';
import dataSource from './data-source.js';

const templates = [
  {
    eventType: 'user.welcome',
    channel: NotificationChannel.EMAIL,
    subject: 'Bem-vindo(a), {{nome}}!',
    body: 'Olá {{nome}},\n\nSua conta em {{produto}} está pronta para uso.\n\nAté breve!',
  },
  {
    eventType: 'order.shipped',
    channel: NotificationChannel.EMAIL,
    subject: 'Seu pedido {{numeroPedido}} saiu para entrega',
    body:
      'Olá {{nome}},\n\nO pedido {{numeroPedido}} saiu para entrega e chega até {{prazo}}.\n\n' +
      'Acompanhe pelo código de rastreio {{rastreio}}.',
  },
  {
    eventType: 'password.reset',
    channel: NotificationChannel.EMAIL,
    subject: 'Redefinição de senha',
    body:
      'Olá {{nome}},\n\nUse o código {{codigo}} para redefinir sua senha. ' +
      'Ele expira em {{minutos}} minutos.\n\nSe não foi você, ignore este e-mail.',
  },
  {
    eventType: 'order.shipped',
    channel: NotificationChannel.SMS,
    subject: null,
    body: 'Seu pedido {{numeroPedido}} saiu para entrega. Rastreio: {{rastreio}}.',
  },
  {
    eventType: 'order.shipped',
    channel: NotificationChannel.PUSH,
    subject: null,
    body: 'Pedido {{numeroPedido}} a caminho!',
  },
];

async function seed(): Promise<void> {
  await dataSource.initialize();

  try {
    await dataSource
      .getRepository(Template)
      .upsert(templates, { conflictPaths: ['eventType', 'channel'] });

    console.log(`${templates.length} template(s) disponíveis.`);
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
