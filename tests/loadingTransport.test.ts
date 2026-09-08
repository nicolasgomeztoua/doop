import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Socket } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { ServerMessage } from '../shared/types'
import { Client, startServer, type Server } from './harness'

const PORT = 4998
const bundle = 'window.appLoaded = true;\n'.repeat(5000)
const html = '<article><h1>Large canvas</h1><p>Editable content</p></article>'.repeat(3000)
let server: Server
let owner: Client
let canvasId: string
let frameId: string

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'doop-loading-'))
  mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true })
  writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html><script src="/assets/app.js"></script>')
  writeFileSync(path.join(dir, 'dist', 'assets', 'app.js'), bundle)
  server = await startServer(
    PORT,
    {
      NODE_ENV: 'production',
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: 'test-loading-transport-secret-with-enough-entropy',
    },
    dir,
  )
  owner = await new Client(server).signUp('loading@test.dev', 'Loading')
  canvasId = (await (await owner.post('/api/canvases', { name: 'Large canvas' })).json()).id
  frameId = (await (await owner.post(`/api/canvases/${canvasId}/frames`, { name: 'Large frame', html })).json()).id
}, 70_000)

afterAll(() => server?.stop())

describe('first-load transport', () => {
  it('compresses production bundles and still serves clients requesting identity encoding', async () => {
    // node:http retains the wire bytes; fetch transparently decompresses them.
    const { get } = await import('node:http')
    const compressed = await new Promise<{ encoding?: string; vary?: string; body: Buffer }>((resolve, reject) => {
      get(`${server.base}/assets/app.js`, { headers: { 'Accept-Encoding': 'gzip' } }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () =>
          resolve({
            encoding: response.headers['content-encoding'],
            vary: response.headers.vary,
            body: Buffer.concat(chunks),
          }),
        )
      }).on('error', reject)
    })
    expect(compressed.encoding).toBe('gzip')
    expect(compressed.vary).toContain('Accept-Encoding')
    expect(gunzipSync(compressed.body).toString()).toBe(bundle)
    expect(compressed.body.length).toBeLessThan(bundle.length / 10)
    const plain = await fetch(`${server.base}/assets/app.js`, { headers: { 'Accept-Encoding': 'identity' } })
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect(await plain.text()).toBe(bundle)
    expect((await owner.get('/api/canvases')).headers.get('content-encoding')).toBeNull()
  })

  it.each([true, false])('delivers complete snapshots and live edits with compression=%s', async (compress) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`, {
      headers: { Cookie: owner.header() },
      perMessageDeflate: compress,
    })
    let transport: Socket
    let before = 0
    ws.on('upgrade', (response) => {
      transport = response.socket
      before = transport.bytesRead
    })
    const init = message(ws, 'init')
    ws.on('open', () =>
      ws.send(
        JSON.stringify({ type: 'join', canvasId, clientId: `loading-${compress}`, name: 'Loading', kind: 'user' }),
      ),
    )
    try {
      const snapshot = await init
      const frame = snapshot.canvas.frames.find((frame) => frame.id === frameId)
      expect(frame?.html).toBe(html)
      if (compress) {
        expect(ws.extensions).toContain('permessage-deflate')
        expect(transport!.bytesRead - before).toBeLessThan(html.length / 3)
      } else expect(ws.extensions).toBe('')
      const update = message(ws, 'frame:updated')
      const name = `Renamed ${compress}`
      expect((await owner.patch(`/api/frames/${frameId}`, { name })).status).toBe(200)
      expect((await update).frame).toMatchObject({ id: frameId, name, html })
    } finally {
      ws.close()
    }
  })
})

function message<T extends ServerMessage['type']>(
  ws: WebSocket,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error(`Timed out waiting for ${type}`))
    }, 5000)
    ws.on('error', reject)
    ws.on('message', function receive(data) {
      const parsed = JSON.parse(String(data))
      if (parsed.type !== type) return
      clearTimeout(timer)
      ws.off('message', receive)
      ws.off('error', reject)
      resolve(parsed)
    })
  })
}
