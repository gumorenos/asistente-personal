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
      reply: '✅ Asistente activo. Stage 2A: capacidades locales deterministas + IA opcional y explícita.',
    };
  }

  if (['ayuda', '/ayuda', 'help'].includes(text)) {
    return {
      handled: true,
      reply: [
        'Comandos disponibles:',
        '• ping',
        '• estado',
        '• ayuda',
        '• anota <texto>',
        '• notas',
        '• gasté <monto> soles en <descripción> #<categoría>',
        '• gastos / gastos hoy / gastos semana / gastos mes',
        '• resumen gastos mes',
        '• recuérdame <fecha/hora> <texto>',
        '• recordatorios',
        '• ia <pregunta>',
        '',
        'La IA solo se invoca con “ia”/“ai”, no recibe tu historial y no puede ejecutar acciones.',
        'Calendar, audio, Observer, documentos y agentes externos siguen deshabilitados.',
      ].join('\n'),
    };
  }

  return {
    handled: true,
    reply: 'Mensaje recibido y guardado. Usa “ayuda” para ver comandos; la IA solo se invoca con “ia <pregunta>”.',
  };
}
