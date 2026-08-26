import type { IncomingMessage } from './types.ts';

export interface RouteResult { handled: boolean; reply?: string; }

export function routeMessage(message: IncomingMessage): RouteResult {
  const text = message.text.trim().toLowerCase();
  if (!text) return { handled: false };
  if (['ping', '/ping'].includes(text)) return { handled: true, reply: 'pong' };

  if (['estado', '/estado', 'status'].includes(text)) {
    return { handled: true, reply: '✅ Asistente activo. Usa “ayuda” para ver las capacidades explícitas y “chats observados” para Observer.' };
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
        '• compromiso <fecha/hora opcional> <texto> — tracking local explícito',
        '• resumen compromisos — conteos y prioridades locales',
        '• compromisos / compromisos vencidos / compromisos hoy / compromisos semana / compromisos sin fecha',
        '• reprograma compromiso #N <nueva fecha/hora>',
        '• completa compromiso #N / cancela compromiso #N',
        '• busca compromisos <texto>',
        '• correos / correos recientes [N] — metadata Gmail, si GMAIL_READ_ENABLED=true',
        '• correos no leídos [N] — INBOX+UNREAD metadata Gmail',
        '• lee correo [no leído] N — body explícito, si GMAIL_CONTENT_READ_ENABLED=true',
        '• lee hilo [no leído] N — últimos mensajes del hilo, con límites locales',
        '• agenda hoy / agenda mañana / agenda semana — lectura, si CALENDAR_READ_ENABLED=true',
        '• disponibilidad hoy / disponibilidad mañana — lectura free/busy',
        '• propón horarios mañana para 30 minutos — sugerencias read-only, si están habilitadas',
        '• libre mañana a las 10 por 30 minutos — comprobación exacta read-only',
        '• agenda mañana a las 10 reunión por 30 minutos — propuesta de escritura',
        '• acciones',
        '• aprueba acción #N / rechaza acción #N',
        '• ejecuta acción #N — writes solo si CALENDAR_ENABLED=true',
        '• documentos / documento #N',
        '• elimina documento #N — requiere aprobación + ejecución',
        '• busca documentos <texto>',
        '• busca semántica documentos <texto> / busca híbrida documentos <texto>',
        '• pregunta documentos <pregunta>',
        '• semántica status / reindexa documento #N',
        '• observa chat <jid> como <etiqueta>',
        '• chats observados',
        '• observaciones <jid> [1-10]',
        '• deja de observar <jid>',
        '• ia <pregunta>',
        '• audio: transcripción solo si está habilitada',
        '',
        'Los compromisos se capturan explícitamente en tu self-chat; nunca se detectan automáticamente en Observer. Los avisos de vencimiento solo se envían si COMMITMENT_NOTIFICATIONS_ENABLED=true y exclusivamente al self-JID configurado.',
        'Gmail metadata y Gmail content read son opt-ins separados: Stage 7A puede quedarse en gmail.metadata; Stage 7B requiere un token gmail.readonly, pero sigue sin adjuntos, mutaciones, IA ni persistencia.',
        'Calendar read y Calendar writes tienen flags independientes; leer, comprobar o sugerir horarios nunca ejecuta una acción.',
        'Observer es opt-in, solo persiste texto allowlisted y no responde ni ejecuta acciones.',
        'La lectura/búsqueda de Observer es local, explícita y acotada por JID exacto; no usa IA.',
        'PDF/OCR, embeddings, Q&A, IA y transcripción conservan opt-ins separados.',
      ].join('\n'),
    };
  }
  return { handled: true, reply: 'Mensaje recibido y guardado. Usa “ayuda” para ver comandos.' };
}