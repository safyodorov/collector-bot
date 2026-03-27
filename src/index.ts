import { bot } from './bot.js'

console.log('Collector Bot starting...')

bot.start({
  onStart: () => console.log('Collector Bot is running'),
})

// Graceful shutdown
process.on('SIGINT', () => { bot.stop(); process.exit(0) })
process.on('SIGTERM', () => { bot.stop(); process.exit(0) })
