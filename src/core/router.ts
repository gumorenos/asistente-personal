import type { IncomingMessage } from './types.ts';

export interface RouteResult {
  handled: boolean;
  reply?: string;
}

export function routeMessage(message: IncomingMessage): RouteResult {
  const text = message.text.trim().toLowerCase();
  if (!text) return { handled: false };

  if (['ping', '/ping'].includes(text)) return { handled: true, reply: 'pong' };

  if (['estado', '/estado', 'status'].includes(text)) {
    return { handled: true, reply: '✅ Asistente activo. Stage 2: capacidades locales + IA explícita + transcripción opcional.' };
  }

  if (['ayuda', '/ayuda', 'help'].includes(text)) {
    return {
      handled: true,
      reply: [
        'Comandos disponibles:',
        '• ping / estado / ayuda',
        '• anota <texto> / notas',
        '• gasté <monto> soles en <descripción> #<categoría>',
        '• gastos hoy / semana / mes / resumen gastos mes',
        '• recuérdame <fecha/hora> <texto> / recordatorios',
        '• ia <pregunta>',
        '• audio de voz: se transcribe solo si TRANSCRIPTION_ENABLED=true',
        '',
        'La IA no recibe historial y no puede ejecutar acciones.',
        'La transcripción devuelve texto: no lo reinyecta como comando.',
        'Calendar, Observer, documentos y agentes externos siguen deshabilitados.',
      ].join('\n'),
    };
  }

  return { handled: true, reply: 'Mensaje recibido y guardado. Usa “ayuda” para ver comandos.' };
}
