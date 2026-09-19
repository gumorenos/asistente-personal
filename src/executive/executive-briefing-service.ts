import type { CalendarAgendaResult, CalendarReadService } from '../calendar/calendar-read-service.ts';
import { localPeriodRange } from '../capabilities/time-utils.ts';
import type { CommitmentRecord, CommitmentRepository } from '../database/commitment-repository.ts';
import type { ReminderRecord, ReminderRepository } from '../database/reminder-repository.ts';
import type { GmailMetadataMessage, GmailReadProvider } from '../gmail/types.ts';
import type { ExecutiveBriefingConfig } from './briefing-config.ts';

export type ExecutiveBriefingSourceStatus = 'disabled' | 'ok' | 'failed';
type ActionSource = 'commitment' | 'reminder';
type ActionBucket = 'overdue' | 'today';
interface ActionItem { source: ActionSource; id: number; body: string; dueAt: string; bucket: ActionBucket }
export interface ExecutiveBriefingResult { text: string; actions: { overdue: number; today: number; returned: number }; calendar: { status: ExecutiveBriefingSourceStatus; returned: number }; gmail: { status: ExecutiveBriefingSourceStatus; unreadReturned: number } }
function clean(value: string, max: number): string { const text=value.replace(/[\p{Cc}\p{Cf}]+/gu,' ').replace(/\s+/g,' ').trim(); return text.length<=max?text:`${text.slice(0,Math.max(0,max-1))}…`; }
function bounded(lines:string[],max:number):string { const out:string[]=[]; for(const line of lines){if([...out,line].join('\n').length>max){if([...out,'… salida truncada'].join('\n').length<=max)out.push('… salida truncada');break;}out.push(line);}return out.join('\n').slice(0,max); }
function time(value:string,zone:string):string{return new Intl.DateTimeFormat('es-PE',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}
function action(source:ActionSource,row:CommitmentRecord|ReminderRecord,bucket:ActionBucket):ActionItem|undefined{if(!row.dueAt)return undefined;return{source,id:row.id,body:row.body,dueAt:row.dueAt,bucket};}
function compareActions(a:ActionItem,b:ActionItem):number{return new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()||a.source.localeCompare(b.source)||a.id-b.id;}
function formatAction(item:ActionItem,zone:string):string{return `• ${time(item.dueAt,zone)} · ${item.source==='commitment'?'compromiso':'recordatorio'} #${item.id} — ${clean(item.body,180)}`;}
function formatCalendar(result:CalendarAgendaResult,zone:string,max:number):string[]{return result.events.slice(0,max).map((event)=>{const title=clean(event.title,180);if(event.startDate&&event.endDate)return `• Todo el día — ${title}`;if(event.startDateTime)return `• ${time(event.startDateTime,zone)} — ${title}`;return `• Hora desconocida — ${title}`;});}
function compareMail(a:GmailMetadataMessage,b:GmailMetadataMessage):number{return new Date(b.internalDate).getTime()-new Date(a.internalDate).getTime()||a.from.localeCompare(b.from)||a.subject.localeCompare(b.subject);}

export class ExecutiveBriefingService {
  private readonly commitments: CommitmentRepository; private readonly reminders: ReminderRepository; private readonly calendar: CalendarReadService|undefined; private readonly gmail: GmailReadProvider|undefined; private readonly config: ExecutiveBriefingConfig; private readonly timeZone:string; private readonly now:()=>Date;
  constructor(commitments:CommitmentRepository,reminders:ReminderRepository,calendar:CalendarReadService|undefined,gmail:GmailReadProvider|undefined,config:ExecutiveBriefingConfig,timeZone:string,now:()=>Date=()=>new Date()){this.commitments=commitments;this.reminders=reminders;this.calendar=calendar;this.gmail=gmail;this.config=config;this.timeZone=timeZone;this.now=now;}
  async render():Promise<ExecutiveBriefingResult>{
    const now=this.now(),nowIso=now.toISOString(),nowMs=now.getTime(),day=localPeriodRange(now,this.timeZone,'day'),fetchLimit=Math.min(100,Math.max(this.config.maxActionItems*2,10));
    const overdueCommitments=this.commitments.listOverdue(nowIso,fetchLimit).map((r)=>action('commitment',r,'overdue')).filter((r):r is ActionItem=>Boolean(r));
    const todayCommitments=this.commitments.listOpenDueBetween(new Date(nowMs+1).toISOString(),day.endIso,fetchLimit).map((r)=>action('commitment',r,'today')).filter((r):r is ActionItem=>Boolean(r));
    const reminderActions=this.reminders.listPendingDueBefore(day.endIso,fetchLimit).map((r)=>action('reminder',r,new Date(r.dueAt!).getTime()<=nowMs?'overdue':'today')).filter((r):r is ActionItem=>Boolean(r));
    const overdue=[...overdueCommitments,...reminderActions.filter((r)=>r.bucket==='overdue')].sort(compareActions),today=[...todayCommitments,...reminderActions.filter((r)=>r.bucket==='today')].sort(compareActions),selected=[...overdue,...today].slice(0,this.config.maxActionItems),selectedOverdue=selected.filter((r)=>r.bucket==='overdue'),selectedToday=selected.filter((r)=>r.bucket==='today');
    let calendarStatus:ExecutiveBriefingSourceStatus=this.calendar?'ok':'disabled',calendarResult:CalendarAgendaResult|undefined;if(this.calendar){try{calendarResult=await this.calendar.agendaRemainingToday(this.config.maxCalendarEvents);}catch{calendarStatus='failed';}}
    let gmailStatus:ExecutiveBriefingSourceStatus=this.gmail?'ok':'disabled',mail:GmailMetadataMessage[]=[];if(this.gmail){try{mail=(await this.gmail.listInbox({unreadOnly:true,limit:this.config.maxGmailMessages})).filter((r)=>r.unread).sort(compareMail).slice(0,this.config.maxGmailMessages);}catch{gmailStatus='failed';}}
    const date=new Intl.DateTimeFormat('es-PE',{timeZone:this.timeZone,dateStyle:'full'}).format(now),lines=[`☀️ Briefing ejecutivo — ${date}`,'','🎯 Primero'];
    if(selectedOverdue.length)lines.push(...selectedOverdue.map((r)=>formatAction(r,this.timeZone)));else if(selectedToday.length)lines.push(`• Nada vencido. Próximo: ${formatAction(selectedToday[0]!,this.timeZone).slice(2)}`);else lines.push('• Sin compromisos ni recordatorios con hora pendientes para hoy.');
    lines.push('','🗂️ Resto de hoy');if(!selectedToday.length)lines.push('• Sin otros compromisos o recordatorios con hora para hoy.');else lines.push(...selectedToday.map((r)=>formatAction(r,this.timeZone)));
    lines.push('','📅 Agenda restante');if(calendarStatus==='disabled')lines.push('• Calendar read deshabilitado.');else if(calendarStatus==='failed')lines.push('• Calendar no disponible en este momento.');else if(!calendarResult?.events.length)lines.push('• Sin eventos restantes hoy.');else lines.push(...formatCalendar(calendarResult,this.timeZone,this.config.maxCalendarEvents));
    lines.push('','📨 Inbox no leído');if(gmailStatus==='disabled')lines.push('• Gmail read deshabilitado.');else if(gmailStatus==='failed')lines.push('• Gmail no disponible en este momento.');else if(!mail.length)lines.push('• Sin correos no leídos entre los resultados solicitados.');else{lines.push(...mail.map((r)=>`• ${clean(r.from,100)} — ${clean(r.subject,160)}`));lines.push('• Contexto solamente: no leído no significa urgente y no se leyó el cuerpo.');}
    return{text:bounded(lines,this.config.maxReplyChars),actions:{overdue:selectedOverdue.length,today:selectedToday.length,returned:selected.length},calendar:{status:calendarStatus,returned:calendarResult?.events.slice(0,this.config.maxCalendarEvents).length??0},gmail:{status:gmailStatus,unreadReturned:mail.length}};
  }
}
