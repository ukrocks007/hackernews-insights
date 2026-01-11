// Centralized logger for the project
// Usage: import logger from './logger'; logger.info('message');

// Disable stdout buffering for pm2 compatibility
// This ensures logs appear immediately in pm2 monit/logs
if (process.stdout && typeof process.stdout.setEncoding === "function") {
  process.stdout.setEncoding("utf8");
}
if (process.stderr && typeof process.stderr.setEncoding === "function") {
  process.stderr.setEncoding("utf8");
}

class Logger {
  private getTimestamp() {
    return new Date().toISOString(); // ISO timestamp for better consistency
  }

  private formatData(data: any[]): string {
    if (data.length === 0) return "";

    return data
      .map((item) => {
        if (item === null) return "null";
        if (item === undefined) return "undefined";
        if (item instanceof Error) {
          return `${item.name}: ${item.message}\n${item.stack || ""}`;
        }
        if (typeof item === "object") {
          try {
            return JSON.stringify(item, null, 2);
          } catch (e) {
            return String(item);
          }
        }
        return String(item);
      })
      .join(" ");
  }

  private write(
    stream: NodeJS.WriteStream,
    level: string,
    message: string,
    ...data: any[]
  ) {
    const timestamp = this.getTimestamp();
    const formattedMessage = `[${level}] [${timestamp}] ${message}`;
    const formattedData = this.formatData(data);

    if (formattedData) {
      stream.write(formattedMessage + " " + formattedData + "\n");
    } else {
      stream.write(formattedMessage + "\n");
    }
  }

  info(message: string, ...data: any[]) {
    this.write(process.stdout, "INFO", message, ...data);
  }

  warn(message: string, ...data: any[]) {
    this.write(process.stderr, "WARN", message, ...data);
  }

  error(message: string, ...data: any[]) {
    this.write(process.stderr, "ERROR", message, ...data);
  }
}

const logger = new Logger();
export default logger;
