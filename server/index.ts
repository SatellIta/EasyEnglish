import './env'

import { existsSync, readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { ZodError } from 'zod'
import chatRoutes from './routes/chat'
import entriesRoutes from './routes/entries'
import importRoutes from './routes/import'
import libraryRoutes from './routes/library'
import reviewRoutes from './routes/review'
import scenesRoutes from './routes/scenes'
import settingsRoutes from './routes/settings'
import summaryRoutes from './routes/summary'

const app = new Hono()

app.use('*', logger())
app.use('/api/*', cors())

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    name: 'EasyEnglish',
    time: new Date().toISOString(),
  }),
)

app.route('/', entriesRoutes)
app.route('/', reviewRoutes)
app.route('/', chatRoutes)
app.route('/', summaryRoutes)
app.route('/', settingsRoutes)
app.route('/', scenesRoutes)
app.route('/', libraryRoutes)
app.route('/', importRoutes)

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: '请求参数不合法', details: err.issues }, 400)
  }
  console.error('[EasyEnglish]', err)
  return c.json({ error: err instanceof Error ? err.message : '服务器内部错误' }, 500)
})

const isProduction = process.env.NODE_ENV === 'production'
const distIndex =
  isProduction && existsSync('./dist/index.html')
    ? readFileSync('./dist/index.html', 'utf8')
    : null

if (isProduction) {
  app.use('*', serveStatic({ root: './dist' }))
}

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: '接口不存在' }, 404)
  if (distIndex && c.req.method === 'GET') return c.html(distIndex)
  return c.text('EasyEnglish API is running. Start the Vite dev server for the UI.', 404)
})

const port = Number(process.env.PORT || 3001)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`EasyEnglish server listening on http://localhost:${info.port}`)
})
