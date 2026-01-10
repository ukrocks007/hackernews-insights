module.exports = {
  apps: [
    {
      name: "hn-insights-server",
      script: "npm",
      args: "start",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1024M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
