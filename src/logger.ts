// Centralized logger for the project
// Usage: import logger from './logger'; logger.info('message');

class Logger {
  private getTimestamp() {
    return new Date().toLocaleString(); // Human-readable timestamp
  }

  info(message: string) {
    console.log(`[INFO] [${this.getTimestamp()}] ${message}`);
  }

  warn(message: string) {
    console.warn(`[WARN] [${this.getTimestamp()}] ${message}`);
  }

  error(message: string) {
    console.error(`[ERROR] [${this.getTimestamp()}] ${message}`);
  }
}

const logger = new Logger();
export default logger;
