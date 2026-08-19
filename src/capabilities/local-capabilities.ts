import type { IncomingMessage } from '../core/types.ts';
import type { ExpenseRepository } from '../database/expense-repository.ts';
import type { NoteRepository } from '../database/note-repository.ts';
import type { ReminderRepository } from '../database/reminder-repository.ts';
import { parseExpense, parseNote, parseReminder } from './parsers.ts';

export interface CapabilityResult {
  handled: boolean;
  reply?: string;
}

export class LocalCapabilities {
  private readonly notes: NoteRepository;
  private readonly reminders: ReminderRepository;
  private readonly expenses: ExpenseRepository;
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    notes: NoteRepository,
    reminders: ReminderRepository,
    expenses: ExpenseRepository,
    timeZone: string,
    now: () => Date = () => new Date(),
  ) {
    this.notes = notes;
    this.reminders = reminders;
    this.expenses = expenses;
    this.timeZone = timeZone;
    this.now = now;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const text = message.text.trim();
    if (!text) return undefined;

    const note = parseNote(text);
    if (note) {
      const id = this.notes.create(note);
      return { handled: true, reply: `📝 Nota #${id} guardada: ${note}` };
    }

    const expense = parseExpense(text);
    if (expense) {
      const id = this.expenses.create({
        ...expense,
        occurredAt: this.now().toISOString(),
      });
      const amount = (expense.amountMinor / 100).toFixed(2);
      const suffix = expense.description ? ` en ${expense.description}` : '';
      return { handled: true, reply: `💰 Gasto #${id} guardado: S/ ${amount}${suffix}` };
    }

    const reminder = parseReminder(text, this.now(), this.timeZone);
    if (reminder) {
      const id = this.reminders.create({ ...reminder, chatId: message.chatId });
      if (!reminder.dueAt) {
        return {
          handled: true,
          reply: `⏰ Recordatorio #${id} guardado sin hora. Puedes verlo con “recordatorios”.`,
        };
      }
      const localDue = new Intl.DateTimeFormat('es-PE', {
        timeZone: this.timeZone,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(reminder.dueAt));
      return { handled: true, reply: `⏰ Recordatorio #${id} creado para ${localDue}: ${reminder.body}` };
    }

    const folded = text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

    if (['notas', 'mis notas'].includes(folded)) {
      const rows = this.notes.listActive(10);
      return {
        handled: true,
        reply: rows.length
          ? ['📝 Notas recientes:', ...rows.map((row) => `• #${row.id} ${row.body}`)].join('\n')
          : '📝 No tienes notas guardadas.',
      };
    }

    if (['recordatorios', 'mis recordatorios', 'pendientes'].includes(folded)) {
      const rows = this.reminders.listPending(10);
      return {
        handled: true,
        reply: rows.length
          ? [
              '⏰ Recordatorios pendientes:',
              ...rows.map((row) => `• #${row.id} ${row.body}${row.dueAt ? ` — ${new Intl.DateTimeFormat('es-PE', { timeZone: this.timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.dueAt))}` : ' — sin hora'}`),
            ].join('\n')
          : '⏰ No tienes recordatorios pendientes.',
      };
    }

    if (['gastos', 'mis gastos'].includes(folded)) {
      const rows = this.expenses.listRecent(10);
      return {
        handled: true,
        reply: rows.length
          ? [
              '💰 Gastos recientes:',
              ...rows.map((row) => `• #${row.id} S/ ${(row.amountMinor / 100).toFixed(2)}${row.description ? ` — ${row.description}` : ''}`),
            ].join('\n')
          : '💰 No tienes gastos guardados.',
      };
    }

    return undefined;
  }
}
