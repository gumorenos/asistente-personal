import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutiveBriefingCapability } from '../src/capabilities/executive-briefing-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { CommitmentRepository } from '../src/database/commitment-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ReminderRepository } from '../src/database/reminder-repository.ts';
import { loadExecutiveBriefingConfig, type ExecutiveBriefingConfig } from '../src/executive/briefing-config.ts';
import { ExecutiveBriefingService } from '../src/executive/executive-briefing-service.ts';

const now = new Date('2026-09-19T15:00:00.000Z');
function config(overrides: Partial<ExecutiveBriefingConfig> = {}): ExecutiveBriefingConfig { return { enabled: true, maxActionItems: 5, maxCalendarEvents: 5, maxGmailMessages: 3, maxReplyChars: 3500, ...overrides }; }
function message(text: string): IncomingMessage { return { id: `8c-${text}`, chatId: '51999999999@s.whatsapp.net', timestamp: Math.floor(now.getTime()/1000), text, kind: 'text', fromMe: true, isGroup: false }; }

test('Stage 8C defaults disabled and validates bounds', () => {
  const c = loadExecutiveBriefingConfig({}); assert.equal(c.enabled, false); assert.equal(c.maxActionItems, 5); assert.equal(c.maxCalendarEvents, 5); assert.equal(c.maxGmailMessages, 3); assert.equal(c.maxReplyChars, 3500);
  assert.throws(() => loadExecutiveBriefingConfig({ EXECUTIVE_BRIEFING_MAX_ACTION_ITEMS: '0' }), /MAX_ACTION_ITEMS/);
  assert.throws(() => loadExecutiveBriefingConfig({ EXECUTIVE_BRIEFING_MAX_REPLY_CHARS: '999' }), /MAX_REPLY_CHARS/);
});

test('Stage 8C commands are explicit, punctuation tolerant, deterministic and ephemeral', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db); const reminders = new ReminderRepository(db); const audit = new AuditRepository(db);
    commitments.create({ body: 'Enviar informe', dueAt: '2026-09-19T14:00:00.000Z' });
    reminders.create({ body: 'Pagar recibo', dueAt: '2026-09-19T17:00:00.000Z', chatId: '51999999999@s.whatsapp.net' });
    const service = new ExecutiveBriefingService(commitments, reminders, undefined, undefined, config(), 'America/Lima', () => now);
    const capability = new ExecutiveBriefingCapability(service, audit, config());
    assert.equal(await capability.handle(message('hola')), undefined);
    for (const command of ['qué tengo hoy', '¿Qué tengo hoy?', 'dame mi briefing', 'briefing ejecutivo']) {
      const result = await capability.handle(message(command)); assert.equal(result?.replyPersistence, 'ephemeral'); assert.match(result?.reply ?? '', /Briefing ejecutivo/); assert.match(result?.reply ?? '', /Enviar informe/); assert.match(result?.reply ?? '', /Pagar recibo/);
    }
    const auditText = JSON.stringify(audit.listRecent(20)); assert.doesNotMatch(auditText, /Enviar informe|Pagar recibo/); assert.match(auditText, /executive\.briefing\.rendered/);
  } finally { db.close(); }
});

test('disabled Stage 8C owns only its commands without rendering', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db); let renders = 0;
    const service = { async render() { renders += 1; throw new Error('must not run'); } } as unknown as ExecutiveBriefingService;
    const capability = new ExecutiveBriefingCapability(service, audit, { ...config(), enabled: false });
    assert.equal(await capability.handle(message('prioridades hoy')), undefined);
    const result = await capability.handle(message('¿Qué tengo hoy?')); assert.match(result?.reply ?? '', /deshabilitado/); assert.equal(result?.replyPersistence, 'ephemeral'); assert.equal(renders, 0);
  } finally { db.close(); }
});

test('briefing is bounded and does not create actions or use AI', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db); const reminders = new ReminderRepository(db);
    for (let i=0;i<10;i+=1) commitments.create({ body: `item-${i}-${'x'.repeat(300)}`, dueAt: `2026-09-19T${String(5+i).padStart(2,'0')}:00:00.000Z` });
    const result = await new ExecutiveBriefingService(commitments, reminders, undefined, undefined, config({ maxActionItems: 3, maxReplyChars: 1000 }), 'America/Lima', () => now).render();
    assert.equal(result.actions.returned, 3); assert.ok(result.text.length <= 1000); assert.match(result.text, /Calendar read deshabilitado/); assert.match(result.text, /Gmail read deshabilitado/);
  } finally { db.close(); }
});
