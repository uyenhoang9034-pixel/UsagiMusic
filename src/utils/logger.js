export const logger = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
export const startupLog = (...args) => console.log(...args);
export const shutdownLog = (...args) => console.log(...args);
