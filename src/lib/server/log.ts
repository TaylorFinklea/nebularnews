type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

const MAX_ERROR_STACK_LINES = 6;

export const summarizeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, MAX_ERROR_STACK_LINES).join('\n') ?? null
    };
  }
  return {
    name: 'NonError',
    message: String(error),
    stack: null
  };
};

const write = (level: LogLevel, payload: LogPayload) => {
  const body = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...payload
  });
  if (level === 'error') {
    console.error(body);
    return;
  }
  if (level === 'warn') {
    console.warn(body);
    return;
  }
  console.info(body);
};

export const logInfo = (event: string, payload: LogPayload = {}) => write('info', { event, ...payload });
export const logWarn = (event: string, payload: LogPayload = {}) => write('warn', { event, ...payload });
export const logError = (event: string, payload: LogPayload = {}) => write('error', { event, ...payload });
