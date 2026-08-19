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
      reply: '✅ Asistente activo. Stage 1: self-chat seguro, notas, gastos y recordatorios locales.',
    };
  }

  if (['ayuda', '/ayuda', 'help'].includes(text)) {
    return {
      handled: true,
      reply: [
        'Comandos Stage 1:',
        '• anota <texto> / notas',
        '• completa nota #<id> / archiva nota #<id>',
        '• gasté <monto> en <descripción> #<categoría>',
        '• categoriza gasto #<id> como <categoría>',
        '• gastos [hoy|semana|mes]',
        '• resumen gastos [hoy|semana|mes]',
        '• recuérdame en 30 minutos <texto>',
        '• recuérdame mañana a las 10 <texto>',
        '• recuérdame viernes a las 16 <texto>',
        '• recordatorios',
        '• completa recordatorio #<id> / cancela recordatorio #<id>',
        '• ping / estado / ayuda',
        '',
        'IA, Calendar, audio, Observer y agentes externos siguen deshabilitados.',
      ].join('\n'),
    };
  }

  return {
    handled: true,
    reply: 'Mensaje recibido y guardado. Escribe “ayuda” para ver los comandos disponibles.',
  };
}
