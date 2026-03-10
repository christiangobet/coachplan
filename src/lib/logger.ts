import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // In production, emit JSON for log aggregators (Datadog, Logtail, etc.)
  // In development, Next.js will pretty-print via console transport
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : {
        transport: {
          target: 'pino/file',
          options: { destination: 1 } // stdout
        }
      })
});
