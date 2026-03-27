module.exports = {
  apps: [{
    name: 'collector',
    script: 'dist/index.js',
    cwd: '/root/collector-bot',
    env: {
      NODE_ENV: 'production'
    },
    max_memory_restart: '256M',
    autorestart: true,
  }]
}
