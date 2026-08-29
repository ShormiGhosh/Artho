type Level = 'INFO' | 'WARN' | 'ERROR';

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify(
    { level, ts: new Date().toISOString(), message, ...context },
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
  );
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) =>
    emit('INFO', message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    emit('WARN', message, context),
  error: (message: string, err?: unknown, context?: Record<string, unknown>) =>
    emit('ERROR', message, {
      ...context,
      error: err instanceof Error ? err.message : err,
      stack: err instanceof Error ? err.stack : undefined,
    }),
};
