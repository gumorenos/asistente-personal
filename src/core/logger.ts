export interface LogContext {
  [key: string]: unknown;
}

function write(level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: LogContext): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ?? {}),
  };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context),
  debug: (message: string, context?: LogContext) => write('debug', message, context),
};
