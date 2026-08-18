import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { probeFreePort, isPortHealthy } from '../dshService'

const servers: Array<http.Server | net.Server> = []

afterEach(() => {
  for (const s of servers.splice(0)) {
    s.close()
  }
})

describe('probeFreePort（端口探测，规格 4.5）', () => {
  it('空闲端口直接返回', async () => {
    const port = await probeFreePort(41990, 5)
    expect(port).toBe(41990)
  })

  it('被占用端口自动顺延', async () => {
    const blocker = net.createServer()
    await new Promise<void>((resolve) => blocker.listen(41980, '127.0.0.1', () => resolve()))
    servers.push(blocker)
    const port = await probeFreePort(41980, 10)
    expect(port).toBeGreaterThan(41980)
  })

  it('全部占用时抛错', async () => {
    const blockers: net.Server[] = []
    for (let i = 0; i < 5; i++) {
      const s = net.createServer()
      await new Promise<void>((resolve) => s.listen(41900 + i, '127.0.0.1', () => resolve()))
      blockers.push(s)
      servers.push(s)
    }
    await expect(probeFreePort(41900, 2)).rejects.toThrow('未找到可用端口')
  })
})

describe('isPortHealthy（HTTP 探活）', () => {
  it('服务可访问返回 true', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    servers.push(server)
    const port = (server.address() as net.AddressInfo).port
    expect(await isPortHealthy(port)).toBe(true)
  })

  it('无服务监听返回 false', async () => {
    expect(await isPortHealthy(43999, 800)).toBe(false)
  })

  it('非 200 响应返回 false', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(500)
      res.end('err')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    servers.push(server)
    const port = (server.address() as net.AddressInfo).port
    expect(await isPortHealthy(port)).toBe(false)
  })
})
