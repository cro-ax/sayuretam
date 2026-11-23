// PM2: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'sayur-etam',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1, // WAJIB 1 — sesi WA tidak boleh jalan dobel
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      watch: false,
      time: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
