import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { ExpenseRepository } from '../database/expense-repository.ts';
import type { NoteRepository } from '../database/note-repository.ts';
import type { ReminderRepository } from '../database/reminder-repository.ts';
import {
  foldText,
  parseExpense,
  parseExpenseCategoryAction,
  parseNote,
  parseNoteStatusAction,
  parseReminder,
  parseReminderStatusAction,
} from './parsers.ts';
import { localPeriodRange, type ExpensePeriod } from './time-utils.ts';
import type { Capability, CapabilityResult } from './types.ts';

const MAX_COMMAND_LENGTH = 2_000;
const AI_PREFIX = /^(?:\/?ia|\/?ai)(?:\s|$)/i;

export class LocalCapabilities implements Capability {
  readonly name = 'local';

  private readonly notes: NoteRepository;
  private readonly reminders: ReminderRepository;
  private readonly expenses: ExpenseRepository;
  private readonly audit: AuditRepository;
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    notes: NoteRepository,
    reminders: ReminderRepository,
    expenses: ExpenseRepository,
    audit: AuditRepository,
    timeZone: string,
    now: () => Date = () => new Date(),
  ) {
    this.notes = notes;
    this.reminders = reminders;
    this.expenses = expenses;
    this.audit = audit;
    this.timeZone = timeZone;
    this.now = now;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const text = message.text.trim();
    if (!text) return undefined;
    if (text.length > MAX_COMMAND_LENGTH) {
      // Stage 2 capabilities own their limits. Do not let the Stage 1 local bound
      // intercept an explicit AI request before AiCapability can validate it.
      if (AI_PREFIX.test(text)) return undefined;
      return { handled: true, reply: '⚠️ El comando es demasiado largo y no fue guardado.' };
    }

    const noteAction = parseNoteStatusAction(text);
    if (noteAction) {
      const changed = this.notes.setStatus(noteAction.id, noteAction.status);
      if (changed) {
        this.audit.record({ eventType: `note.${noteAction.status}`, entityType: 'note', entityId: String(noteAction.id) });
      }
      return {
        handled: true,
        reply: changed
          ? `📝 Nota #${noteAction.id} ${noteAction.status === 'completed' ? 'completada' : 'archivada'}.`
          : `No encontré una nota activa #${noteAction.id}.`,
      };
    }

    const reminderAction = parseReminderStatusAction(text);
    if (reminderAction) {
      const changed = this.reminders.setStatus(reminderAction.id, reminderAction.status);
      if (changed) {
        this.audit.record({ eventType: `reminder.${reminderAction.status}`, entityType: 'reminder', entityId: String(reminderAction.id) });
      }
      return {
        handled: true,
        reply: changed
          ? `⏰ Recordatorio #${reminderAction.id} ${reminderAction.status === 'completed' ? 'completado' : 'cancelado'}.`
          : `No encontré un recordatorio pendiente #${reminderAction.id}.`,
      };
    }

    const categoryAction = parseExpenseCategoryAction(text);
    if (categoryAction) {
      const changed = this.expenses.setCategory(categoryAction.id, categoryAction.category);
      if (changed) {
        this.audit.record({
          eventType: 'expense.categorized',
          entityType: 'expense',
          entityId: String(categoryAction.id),
          metadata: { category: categoryAction.category },
        });
      }
      return {
        handled: true,
        reply: changed
          ? `💰 Gasto #${categoryAction.id} categorizado como ${categoryAction.category}.`
          : `No encontré el gasto #${categoryAction.id}.`,
      };
    }

    const note = parseNote(text);
    if (note) {
      const id = this.notes.create(note);
      this.audit.record({ eventType: 'note.created', entityType: 'note', entityId: String(id) });
      return { handled: true, reply: `📝 Nota #${id} guardada: ${note}` };
    }

    const expense = parseExpense(text);
    if (expense) {
      const id = this.expenses.create({ ...expense, occurredAt: this.now().toISOString() });
      this.audit.record({
        eventType: 'expense.created',
        entityType: 'expense',
        entityId: String(id),
        metadata: { amountMinor: expense.amountMinor, currency: expense.currency, category: expense.category },
      });
      const amount = (expense.amountMinor / 100).toFixed(2);
      const suffix = expense.description ? ` en ${expense.description}` : '';
      const category = expense.category ? ` [${expense.category}]` : '';
      return { handled: true, reply: `💰 Gasto #${id} guardado: S/ ${amount}${suffix}${category}` };
    }

    const reminder = parseReminder(text, this.now(), this.timeZone);
    if (reminder) {
      if (reminder.invalidSchedule) {
        return { handled: true, reply: '⚠️ No pude interpretar una fecha/hora futura válida. No guardé el recordatorio.' };
      }
      const id = this.reminders.create({ ...reminder, chatId: message.chatId });
      this.audit.record({
        eventType: 'reminder.created',
        entityType: 'reminder',
        entityId: String(id),
        metadata: { dueAt: reminder.dueAt ?? null },
      });
      if (!reminder.dueAt) {
        return { handled: true, reply: `⏰ Recordatorio #${id} guardado sin hora. Puedes verlo con “recordatorios”.` };
      }
      return { handled: true, reply: `⏰ Recordatorio #${id} creado para ${this.formatDate(reminder.dueAt)}: ${reminder.body}` };
    }

    const folded = foldText(text);

    if (['notas', 'mis notas'].includes(folded)) {
      const rows = this.notes.listActive(10);
      return {
        handled: true,
        reply: rows.length
          ? ['📝 Notas activas:', ...rows.map((row) => `• #${row.id} ${row.body}`)].join('\n')
          : '📝 No tienes notas activas.',
      };
    }

    if (['recordatorios', 'mis recordatorios', 'pendientes'].includes(folded)) {
      const rows = this.reminders.listPending(10);
      return {
        handled: true,
        reply: rows.length
          ? [
              '⏰ Recordatorios pendientes:',
              ...rows.map((row) => `• #${row.id} ${row.body}${row.dueAt ? ` — ${this.formatDate(row.dueAt)}` : ' — sin hora'}`),
            ].join('\n')
          : '⏰ No tienes recordatorios pendientes.',
      };
    }

    const expensePeriod = this.parseExpensePeriod(folded, false);
    if (folded === 'gastos' || folded === 'mis gastos' || expensePeriod) {
      const rows = expensePeriod
        ? this.expenses.listRange(...this.rangeArgs(expensePeriod), 20)
        : this.expenses.listRecent(10);
      return {
        handled: true,
        reply: rows.length
          ? [
              expensePeriod ? `💰 Gastos de ${this.periodLabel(expensePeriod)}:` : '💰 Gastos recientes:',
              ...rows.map((row) => `• #${row.id} S/ ${(row.amountMinor / 100).toFixed(2)}${row.description ? ` — ${row.description}` : ''}${row.category ? ` [${row.category}]` : ''}`),
            ].join('\n')
          : `💰 No tienes gastos ${expensePeriod ? `en ${this.periodLabel(expensePeriod)}` : 'guardados'}.`,
      };
    }

    const summaryPeriod = this.parseExpensePeriod(folded, true);
    if (summaryPeriod) {
      const [startIso, endIso] = this.rangeArgs(summaryPeriod);
      const summary = this.expenses.summarizeRange(startIso, endIso);
      const categoryLines = summary.byCategory.map(
        (item) => `• ${item.category}: S/ ${(item.totalMinor / 100).toFixed(2)} (${item.count})`,
      );
      return {
        handled: true,
        reply: [
          `📊 Resumen de gastos — ${this.periodLabel(summaryPeriod)}`,
          `Total: S/ ${(summary.totalMinor / 100).toFixed(2)} en ${summary.count} gasto${summary.count === 1 ? '' : 's'}.`,
          ...(categoryLines.length ? ['Por categoría:', ...categoryLines] : []),
        ].join('\n'),
      };
    }

    return undefined;
  }

  private formatDate(iso: string): string {
    return new Intl.DateTimeFormat('es-PE', {
      timeZone: this.timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  private parseExpensePeriod(folded: string, summary: boolean): ExpensePeriod | undefined {
    const prefix = summary ? /^(?:resumen\s+(?:de\s+)?gastos)(?:\s+(.+))?$/ : /^(?:gastos|mis\s+gastos)\s+(.+)$/;
    const match = folded.match(prefix);
    if (!match) return undefined;
    const period = (match[1] ?? 'mes').trim();
    if (['hoy', 'dia', 'del dia'].includes(period)) return 'day';
    if (['semana', 'esta semana', 'de la semana'].includes(period)) return 'week';
    if (['mes', 'este mes', 'del mes'].includes(period)) return 'month';
    return undefined;
  }

  private rangeArgs(period: ExpensePeriod): [string, string] {
    const range = localPeriodRange(this.now(), this.timeZone, period);
    return [range.startIso, range.endIso];
  }

  private periodLabel(period: ExpensePeriod): string {
    if (period === 'day') return 'hoy';
    if (period === 'week') return 'esta semana';
    return 'este mes';
  }
}
