import type { IncomingMessage } from './types.ts';

export interface RouteResult { handled: boolean; reply?: string; }

export function routeMessage(message: IncomingMessage): RouteResult {
  const text = message.text.trim().toLowerCase();
  if (!text) return { handled: false };
  if (['ping', '/ping'].includes(text)) return { handled: true, reply: 'pong' };

  if (['estado', '/estado', 'status'].includes(text)) {
    return { handled: true, reply: '✅ Asistente activo. Calendar writes requieren aprobación + ejecución explícita y están deshabilitados por defecto.' };
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
        '• agenda mañana a las 10 reunión por 30 minutos',
        '• acciones',
        '• aprueba acción #N / rechaza acción #N',
        '• ejecuta acción #N — solo si CALENDAR_ENABLED=true',
        '• ia <pregunta>',
        '• audio: transcripción solo si está habilitada',
        '',
        'Crear una propuesta y aprobarla NO ejecuta Calendar.',
        'Un write requiere además “ejecuta acción #N” y Calendar habilitado.',
        'Observer, documentos y agentes externos siguen deshabilitados.',
      ].join('\n'),
    };
  }
  return { handled: true, reply: 'Mensaje recibido y guardado. Usa “ayuda” para ver comandos.' };
}
