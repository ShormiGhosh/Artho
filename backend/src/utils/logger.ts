type Level = 'INFO' | 'WARN' | 'ERROR';

const SECRET_KEY =
  /^(password|password_hash|pin|token|secret|authorization|jwt|nid|risk_ack|verification_token|api_key|apikey|openai_api_key|access_token|refresh_token)$/i;

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify(
    { level, ts: new Date().toISOString(), message, ...context },
    (k, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (SECRET_KEY.test(k)) return '[redacted]';
      return v;
    }
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
