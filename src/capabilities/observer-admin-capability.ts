import { createHash } from 'node:crypto';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import { normalizeObservedJid, type ObservedChatRepository } from '../database/observed-chat-repository.ts';
import type { Capability, CapabilityResult } from './types.ts';

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function auditEntity(jid: string): string {
  return createHash('sha256').update(jid).digest('hex').slice(0, 16);
}

export class ObserverAdminCapability implements Capability {
  readonly name = 'observer-admin';

  private readonly chats: ObservedChatRepository;
  private readonly audit: AuditRepository;
  private readonly observerEnabled: boolean;

  constructor(chats: ObservedChatRepository, audit: AuditRepository, observerEnabled = false) {
    this.chats = chats;
    this.audit = audit;
    this.observerEnabled = observerEnabled;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const text = message.text.trim();
    const normalized = fold(text);

    if (['chats observados', 'observer chats', 'observados'].includes(normalized)) {
      const rows = this.chats.listEnabled();
      const state = this.observerEnabled
        ? 'Observer read-only está ACTIVO: solo estos chats pueden persistir texto.'
        : 'Observer está DESHABILITADO: esta allowlist no captura nada todavía.';
      return {
        handled: true,
        reply: rows.length
          ? [
              '👁️ Chats autorizados:',
              ...rows.map((row) => `• ${row.label ? `${row.label} — ` : ''}${row.jid} — retención ${row.retentionDays} días`),
              '',
              state,
            ].join('\n')
          : `👁️ No hay chats autorizados. ${state}`,
      };
    }

    const add = text.match(/^observa\s+chat\s+([^\s]+)(?:\s+como\s+(.+))?$/i);
    if (add?.[1]) {
      try {
        const row = this.chats.enable(add[1], add[2], 7);
        this.audit.record({
          eventType: 'observer.chat.allowed',
          entityType: 'observed_chat',
          entityId: auditEntity(row.jid),
          metadata: { retentionDays: row.retentionDays },
        });
        return {
          handled: true,
          reply: this.observerEnabled
            ? `👁️ ${row.jid} quedó autorizado${row.label ? ` como “${row.label}”` : ''}. Desde ahora Observer puede persistir únicamente texto de ese chat por 7 días; no responderá ni ejecutará acciones.`
            : `👁️ ${row.jid} quedó en la allowlist${row.label ? ` como “${row.label}”` : ''}. Observer sigue deshabilitado, así que no se captura nada.`,
        };
      } catch {
        return { handled: true, reply: '⚠️ JID o etiqueta inválidos. No cambié la allowlist.' };
      }
    }

    const remove = text.match(/^deja\s+de\s+observar\s+([^\s]+)$/i);
    if (remove?.[1]) {
      try {
        const jid = normalizeObservedJid(remove[1]);
        const changed = this.chats.disable(jid);
        if (changed) {
          this.audit.record({ eventType: 'observer.chat.disabled', entityType: 'observed_chat', entityId: auditEntity(jid) });
        }
        return {
          handled: true,
          reply: changed
            ? `👁️ ${jid} retirado de la allowlist. No se persistirán mensajes nuevos de ese chat.`
            : `No encontré ${jid} habilitado en la allowlist.`,
        };
      } catch {
        return { handled: true, reply: '⚠️ JID inválido. No cambié la allowlist.' };
      }
    }

    return undefined;
  }
}
