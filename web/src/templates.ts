import type { Channel, CreateNotificationInput } from './types';

export interface PanelTemplate {
  label: string;
  channel: Channel;
  eventType: string;
  recipient: string;
  payload: Record<string, unknown>;
}

export const TEMPLATES: PanelTemplate[] = [
  {
    label: 'Boas-vindas · e-mail',
    channel: 'EMAIL',
    eventType: 'user.welcome',
    recipient: 'ana@exemplo.com',
    payload: { nome: 'Ana', produto: 'Gateway' },
  },
  {
    label: 'Pedido enviado · e-mail',
    channel: 'EMAIL',
    eventType: 'order.shipped',
    recipient: 'ana@exemplo.com',
    payload: {
      nome: 'Ana',
      numeroPedido: 'PED-1234',
      prazo: 'sexta-feira',
      rastreio: 'BR123456789',
    },
  },
  {
    label: 'Redefinição de senha · e-mail',
    channel: 'EMAIL',
    eventType: 'password.reset',
    recipient: 'ana@exemplo.com',
    payload: { nome: 'Ana', codigo: '482911', minutos: '15' },
  },
  {
    label: 'Pedido enviado · SMS',
    channel: 'SMS',
    eventType: 'order.shipped',
    recipient: '+5511999999999',
    payload: { numeroPedido: 'PED-1234', rastreio: 'BR123456789' },
  },
  {
    label: 'Pedido enviado · push',
    channel: 'PUSH',
    eventType: 'order.shipped',
    recipient: 'device-token-demo-01',
    payload: { numeroPedido: 'PED-1234' },
  },
];

export function toInput(template: PanelTemplate): CreateNotificationInput {
  return {
    channel: template.channel,
    eventType: template.eventType,
    recipient: template.recipient,
    payload: template.payload,
  };
}
