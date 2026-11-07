import './env'

import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { ZodError } from 'zod'
import ankiImportRoutes, { cleanupOldImportSessions } from './routes/anki-import'
import chatRoutes from './routes/chat'
import entriesRoutes from './routes/entries'
import errorsRoutes from './routes/errors'
import examplesRoutes from './routes/examples'
import exportRoutes from './routes/export'
import importRoutes from './routes/import'
import learnRoutes from './routes/learn'
import libraryRoutes from './routes/library'
import personasRoutes from './routes/personas'
import reviewRoutes from './routes/review'
import scenesRoutes from './routes/scenes'
import settingsRoutes from './routes/settings'
import summaryRoutes from './routes/summary'
import tagsRoutes from './routes/tags'
import { MEDIA_DIR } from './lib/import/media-store'

const app = new Hono()

app.use('*', logger())
app.use('/api/*', cors())
app.use(
  '/api/import/anki/*',
  bodyLimit({
    maxSize: 200 * 1024 * 1024,
    onError: (c) => c.json({ error: '文件过大，最大支持 200MB' }, 413),
  }),
)

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}
const MEDIA_NAME_PATTERN = /^[a-f0-9]{16}\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i

app.get('/api/media/:name', (c) => {
  const name = c.req.param('name')
  if (!MEDIA_NAME_PATTERN.test(name)) return c.json({ error: '图片不存在' }, 404)
  const filePath = join(MEDIA_DIR, name)
  if (!existsSync(filePath)) return c.json({ error: '图片不存在' }, 404)
  const contentType = MEDIA_CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
  return c.body(readFileSync(filePath), 200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
})

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
app.route('/', errorsRoutes)
app.route('/', examplesRoutes)
app.route('/', exportRoutes)
app.route('/', personasRoutes)
app.route('/', ankiImportRoutes)
app.route('/', learnRoutes)
app.route('/', tagsRoutes)

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

cleanupOldImportSessions()

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`EasyEnglish server listening on http://localhost:${info.port}`)
})
