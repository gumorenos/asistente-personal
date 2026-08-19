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
      reply: '✅ Asistente activo. Etapa 1: self-chat, notas, gastos y recordatorios locales.',
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
        '• anota <texto>',
        '• notas',
        '• gasté <monto> soles en <descripción>',
        '• gastos',
        '• recuérdame mañana a las <hora> <texto>',
        '• recordatorios',
        '',
        'Calendar, audio, IA y Observer siguen deshabilitados.',
      ].join('\n'),
    };
  }

  return {
    handled: true,
    reply: 'Mensaje recibido y guardado. Por ahora prueba “ayuda”, “estado” o “ping”.',
  };
}
