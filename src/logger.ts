// Centralized logger for the project
// Usage: import logger from './logger'; logger.info('message');

class Logger {
  private getTimestamp() {
    return new Date().toLocaleString(); // Human-readable timestamp
  }

  info(message: string, ...data: any[]) {
    console.log(`[INFO] [${this.getTimestamp()}] ${message}`, ...data);
  }

  warn(message: string, ...data: any[]) {
    console.warn(`[WARN] [${this.getTimestamp()}] ${message}`, ...data);
  }

  error(message: string, ...data: any[]) {
    console.error(`[ERROR] [${this.getTimestamp()}] ${message}`, ...data);
  }
}

const logger = new Logger();
export default logger;
