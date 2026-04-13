import SmeeClient from 'smee-client'

const SMEE_URL = process.env.SMEE_URL
const PORT = process.env.PORT ?? '3847'
const TARGET = `http://localhost:${PORT}/webhook`

if (!SMEE_URL) {
  console.error('Error: SMEE_URL environment variable is required.')
  console.error('Create a channel at https://smee.io/new and set SMEE_URL in .env')
  process.exit(1)
}

const smee = new SmeeClient({
  source: SMEE_URL,
  target: TARGET,
  logger: console,
})

const events = smee.start()

console.log(`Smee proxy started: ${SMEE_URL} → ${TARGET}`)
console.log('Press Ctrl+C to stop')

process.on('SIGINT', () => {
  events.close()
  process.exit(0)
})
