import express from 'express'
import { webhookRouter } from './webhook.js'
import { healthRouter } from './routes.js'

export function createApp(): express.Express {
  const app = express()

  app.use(healthRouter)
  app.use(webhookRouter)

  return app
}
