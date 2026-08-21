import type { IncomingMessage } from './types.ts';

export interface RouteResult { handled: boolean; reply?: string; }

export function routeMessage(message: IncomingMessage): RouteResult {
  const text = message.text.trim().toLowerCase();
  if (!text) return { handled: false };
  if (['ping', '/ping'].includes(text)) return { handled: true, reply: 'pong' };

  if (['estado', '/estado', 'status'].includes(text)) {
    return { handled: true, reply: '✅ Asistente activo. Usa “chats observados” para comprobar el estado y la allowlist de Observer.' };
  }

  if (['ayuda', '/ayuda', 'help'].includes(text)) {
    return {
      handled: true,
      reply: [
        'Comandos disponibles:',
        '• ping / estado / ayuda',
        '• briefing',
        '• anota <texto> / notas',
        '• gasté <monto> soles en <descripción> #<categoría>',
        '• gastos hoy / semana / mes / resumen gastos mes',
        '• recuérdame <fecha/hora> <texto> / recordatorios',
        '• agenda mañana a las 10 reunión por 30 minutos',
        '• acciones',
        '• aprueba acción #N / rechaza acción #N',
        '• ejecuta acción #N — solo si CALENDAR_ENABLED=true',
        '• observa chat <jid> como <etiqueta>',
        '• chats observados',
        '• observaciones <jid> [1-10]',
        '• deja de observar <jid>',
        '• ia <pregunta>',
        '• audio: transcripción solo si está habilitada',
        '',
        'Observer es opt-in con OBSERVER_ENABLED=true y solo persiste texto de chats allowlisted; no responde ni ejecuta acciones.',
        'La lectura de observaciones es local, explícita y acotada por JID exacto; no usa IA.',
        'El briefing automático y Calendar writes permanecen opt-in.',
        'Documentos y agentes externos siguen deshabilitados.',
      ].join('\n'),
    };
  }
  return { handled: true, reply: 'Mensaje recibido y guardado. Usa “ayuda” para ver comandos.' };
}
