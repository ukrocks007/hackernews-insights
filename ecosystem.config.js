module.exports = {
  apps: [
    {
      name: "hn-insights-server",
      script: "./start-with-deploy.sh",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1024M",

      // Interpreter for shell script
      interpreter: "bash",

      // Logging configuration - critical for pm2 monit
      error_file: "./logs/error.log",
      out_file: "./logs/output.log",
      log_file: "./logs/combined.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 3000,
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: "10s",

      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
