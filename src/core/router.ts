import type { IncomingMessage } from './types.ts';

export interface RouteResult {
  handled: boolean;
  reply?: string;
}

export function routeMessage(message: IncomingMessage): RouteResult {
  const text = message.text.trim().toLowerCase();

  if (!text) return { handled: false };

  if (['ping', '/ping'].includes(text)) {
    return { handled: true, reply: 'pong' };
  }

  if (['estado', '/estado', 'status'].includes(text)) {
    return {
      handled: true,
      reply: '✅ Asistente activo. Etapa 0: self-chat, persistencia y transporte seguro.',
    };
  }

  if (['ayuda', '/ayuda', 'help'].includes(text)) {
    return {
      handled: true,
      reply: [
        'Comandos disponibles en esta etapa:',
        '• ping',
        '• estado',
        '• ayuda',
        '',
        'Notas, recordatorios, gastos, calendario e IA se incorporan en las siguientes etapas.',
      ].join('\n'),
    };
  }

  return {
    handled: true,
    reply: 'Mensaje recibido y guardado. Por ahora prueba “ayuda”, “estado” o “ping”.',
  };
}
