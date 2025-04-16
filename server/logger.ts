/**
 * Simple logger utility for server-side logging
 * 
 * Provides a consistent interface for logging messages at different levels
 * with timestamps and optional metadata.
 */

// Define log levels
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Format the current date and time for log entries
const getTimestamp = (): string => {
  return new Date().toISOString();
};

// Format a log message with timestamp and level
const formatLogMessage = (level: LogLevel, message: string, ...meta: any[]): string => {
  const timestamp = getTimestamp();
  const metaString = meta.length > 0 ? ' ' + meta.map(m => 
    typeof m === 'object' ? JSON.stringify(m) : m
  ).join(' ') : '';
  
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}`;
};

// Log a message to the console with the specified level
const log = (level: LogLevel, message: string, ...meta: any[]): void => {
  const formattedMessage = formatLogMessage(level, message, ...meta);
  
  switch (level) {
    case 'debug':
      console.debug(formattedMessage);
      break;
    case 'info':
      console.info(formattedMessage);
      break;
    case 'warn':
      console.warn(formattedMessage);
      break;
    case 'error':
      console.error(formattedMessage);
      break;
  }
};

// Create the logger object with methods for each log level
export const logger = {
  debug: (message: string, ...meta: any[]) => log('debug', message, ...meta),
  info: (message: string, ...meta: any[]) => log('info', message, ...meta),
  warn: (message: string, ...meta: any[]) => log('warn', message, ...meta),
  error: (message: string, ...meta: any[]) => log('error', message, ...meta)
};

export default logger;