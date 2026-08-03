import { createServer } from 'node:http'

const port = Number(process.env.SUPABASE_STUB_PORT ?? 54329)
const host = '127.0.0.1'

const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: true, mode: 'signed-out-test-only' }))
    return
  }
  if (request.url?.startsWith('/auth/v1/user')) {
    response.writeHead(401, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ message: 'Auth session missing' }))
    return
  }

  response.writeHead(404, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ message: 'Not available in the signed-out E2E stub' }))
})

server.listen(port, host)

function close() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
