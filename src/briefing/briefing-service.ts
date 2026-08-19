import type { ActionRequestRepository } from '../database/action-request-repository.ts';
import type { ExpenseRepository } from '../database/expense-repository.ts';
import type { NoteRepository } from '../database/note-repository.ts';
import type { ReminderRepository } from '../database/reminder-repository.ts';
import { localPeriodRange } from '../capabilities/time-utils.ts';

export class BriefingService {
  private readonly notes: NoteRepository;
  private readonly reminders: ReminderRepository;
  private readonly expenses: ExpenseRepository;
  private readonly actions: ActionRequestRepository;
  private readonly timeZone: string;

  constructor(
    notes: NoteRepository,
    reminders: ReminderRepository,
    expenses: ExpenseRepository,
    actions: ActionRequestRepository,
    timeZone: string,
  ) {
    this.notes = notes;
    this.reminders = reminders;
    this.expenses = expenses;
    this.actions = actions;
    this.timeZone = timeZone;
  }

  render(now: Date): string {
    const notes = this.notes.listActive(5);
    const reminders = this.reminders.listPending(5);
    const month = localPeriodRange(now, this.timeZone, 'month');
    const spending = this.expenses.summarizeRange(month.startIso, month.endIso);
    const actions = this.actions.listPending(now.toISOString(), 5);
    const dateLabel = new Intl.DateTimeFormat('es-PE', {
      timeZone: this.timeZone,
      dateStyle: 'full',
    }).format(now);

    const lines = [`☀️ Briefing personal — ${dateLabel}`];

    lines.push('', '⏰ Recordatorios');
    if (reminders.length === 0) lines.push('• Sin recordatorios pendientes.');
    else {
      for (const reminder of reminders) {
        const due = reminder.dueAt ? ` — ${this.formatDate(reminder.dueAt)}` : ' — sin hora';
        lines.push(`• #${reminder.id} ${reminder.body}${due}`);
      }
    }

    lines.push('', '📝 Notas activas');
    if (notes.length === 0) lines.push('• Sin notas activas.');
    else for (const note of notes) lines.push(`• #${note.id} ${note.body}`);

    lines.push('', '💰 Gastos del mes');
    lines.push(`• S/ ${(spending.totalMinor / 100).toFixed(2)} en ${spending.count} gasto${spending.count === 1 ? '' : 's'}.`);
    for (const category of spending.byCategory.slice(0, 3)) {
      lines.push(`• ${category.category}: S/ ${(category.totalMinor / 100).toFixed(2)}`);
    }

    lines.push('', '🔐 Acciones pendientes');
    if (actions.length === 0) lines.push('• Ninguna.');
    else for (const action of actions) lines.push(`• #${action.id} ${action.summary}`);

    return lines.join('\n');
  }

  private formatDate(iso: string): string {
    return new Intl.DateTimeFormat('es-PE', {
      timeZone: this.timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  }
}
