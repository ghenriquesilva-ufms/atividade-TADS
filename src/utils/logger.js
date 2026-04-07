import pino from "pino";
import pinoHttp from "pino-http";

export function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL ?? "info"
  });
}

export function createHttpLogger(logger) {
  return pinoHttp({ logger });
}
