/**
 * 生成应用图标：build/icon.ico（256×256 PNG 内嵌 ICO）+ build/icon.png + resources/icon.png。
 * 纯 Node 实现（zlib + 自绘像素 + 2× 超采样抗锯齿），无第三方依赖。
 *
 * 设计：深蓝→品牌蓝纵向渐变圆角方块 + 「智能体工作台」标记——
 * 三个节点（主节点 + 两个从节点）以连线构成协作网络，底部一条终端光标横线，
 * 呼应 dsh 的「工具型 AI 工作台」定位。
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 256
const SS = 2 // 超采样倍数（渲染 512 → 缩小 256）
const R = SIZE * SS

// ---------- 高分辨率绘制（R×R） ----------
const px = new Float64Array(R * R * 4)

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= R || y >= R) return
  const i = (y * R + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}

/** 覆盖式混合（alpha 合成，新像素在上）。 */
function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= R || y >= R || a <= 0) return
  const i = (y * R + x) * 4
  const sa = a / 255
  const da = px[i + 3] / 255
  const outA = sa + da * (1 - sa)
  if (outA <= 0) return
  px[i] = (r * sa + px[i] * da * (1 - sa)) / outA
  px[i + 1] = (g * sa + px[i + 1] * da * (1 - sa)) / outA
  px[i + 2] = (b * sa + px[i + 2] * da * (1 - sa)) / outA
  px[i + 3] = outA * 255
}

function fillCircleAA(cx, cy, radius, r, g, b, a = 255) {
  const x0 = Math.floor(cx - radius - 1)
  const x1 = Math.ceil(cx + radius + 1)
  const y0 = Math.floor(cy - radius - 1)
  const y1 = Math.ceil(cy + radius + 1)
  const r2 = radius * radius
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d2 = dx * dx + dy * dy
      if (d2 <= r2) {
        // 1 像素内边缘做线性 AA
        const edge = Math.min(1, (radius + 0.5 - Math.sqrt(d2)))
        blend(x, y, r, g, b, (a * Math.max(0, Math.min(1, edge)) + 0.5) | 0)
      }
    }
  }
}

/** 用「圆盘采样」画带 AA 的粗线。 */
function drawLineAA(x1, y1, x2, y2, thickness, r, g, b, a = 255) {
  const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    fillCircleAA(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, thickness / 2, r, g, b, a)
  }
}

/** 圆角矩形（带 AA）：返回该像素是否在圆角矩形内（含边缘透明度 0..1）。 */
function roundedRectAlpha(x, y, x0, y0, x1, y1, rad) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return 0
  const cx = x < x0 + rad ? x0 + rad : x > x1 - rad ? x1 - rad : x
  const cy = y < y0 + rad ? y0 + rad : y > y1 - rad ? y1 - rad : y
  const dx = x + 0.5 - cx
  const dy = y + 0.5 - cy
  const d2 = dx * dx + dy * dy
  const rr = rad * rad
  if (d2 <= rr) return 1
  // 圆角外的 1px 过渡带
  if (d2 <= (rad + 1) * (rad + 1)) return 1 - (Math.sqrt(d2) - rad)
  return 0
}

// 背景：圆角方块，深蓝 → 品牌蓝纵向渐变 + 左上柔和高光
const M = 8 * SS // 外边距
const X0 = M, Y0 = M, X1 = R - M, Y1 = R - M, RAD = 52 * SS
for (let y = 0; y < R; y++) {
  for (let x = 0; x < R; x++) {
    const alpha = roundedRectAlpha(x, y, X0, Y0, X1, Y1, RAD)
    if (alpha <= 0) continue
    const t = y / R
    // #1E2A78 → #2E46C8 → #3B82F6
    let r, g, b
    if (t < 0.55) {
      const k = t / 0.55
      r = 30 + (46 - 30) * k
      g = 42 + (70 - 42) * k
      b = 120 + (200 - 120) * k
    } else {
      const k = (t - 0.55) / 0.45
      r = 46 + (59 - 46) * k
      g = 70 + (130 - 70) * k
      b = 200 + (246 - 200) * k
    }
    blend(x, y, r, g, b, alpha * 255)
  }
}

// 左上高光（径向渐弱）：白色圆斑低透明度
const HL_CX = X0 + 90 * SS
const HL_CY = Y0 + 70 * SS
const HL_R = 150 * SS
for (let y = Math.floor(HL_CY - HL_R); y <= HL_CY + HL_R; y++) {
  for (let x = Math.floor(HL_CX - HL_R); x <= HL_CX + HL_R; x++) {
    if (x < X0 || x > X1 || y < Y0 || y > Y1) continue
    const d = Math.sqrt((x - HL_CX) ** 2 + (y - HL_CY) ** 2)
    if (d > HL_R) continue
    const k = 1 - d / HL_R
    const a = Math.round(36 * k * k)
    if (a > 0) blend(x, y, 255, 255, 255, a)
  }
}

// 前景：白色「智能体网络」——三个节点 + 连线 + 终端光标
const WHITE = [255, 255, 255]
const CX = R / 2
const TOP_Y = 96 * SS
const BOT_Y = 186 * SS
const LEFT_X = CX - 78 * SS
const RIGHT_X = CX + 78 * SS

// 连线（粗 10px，半透明白，先画线后画点形成节点压线效果）
drawLineAA(LEFT_X, BOT_Y, RIGHT_X, BOT_Y, 11 * SS, ...WHITE, 150)
drawLineAA(LEFT_X, BOT_Y, CX, TOP_Y, 11 * SS, ...WHITE, 150)
drawLineAA(RIGHT_X, BOT_Y, CX, TOP_Y, 11 * SS, ...WHITE, 150)

// 两个从节点（白底 + 品牌蓝内点）
fillCircleAA(LEFT_X, BOT_Y, 24 * SS, ...WHITE)
fillCircleAA(LEFT_X, BOT_Y, 10 * SS, 46, 70, 200)
fillCircleAA(RIGHT_X, BOT_Y, 24 * SS, ...WHITE)
fillCircleAA(RIGHT_X, BOT_Y, 10 * SS, 46, 70, 200)

// 主节点（顶部，白色大圆 + 深蓝内点，视觉重心）
fillCircleAA(CX, TOP_Y, 33 * SS, ...WHITE)
fillCircleAA(CX, TOP_Y, 13 * SS, 30, 42, 120)

// 底部终端光标横线（呼应「工作台/终端」）
drawLineAA(CX - 60 * SS, 226 * SS, CX + 60 * SS, 226 * SS, 12 * SS, ...WHITE)

// ---------- 2× 降采样 ----------
const out = new Uint8Array(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * R + (x * SS + dx)) * 4
        const sa = px[i + 3] / 255
        r += px[i] * sa
        g += px[i + 1] * sa
        b += px[i + 2] * sa
        a += px[i + 3]
      }
    }
    const n = SS * SS
    const o = (y * SIZE + x) * 4
    const outA = a / n
    if (outA <= 0) continue
    const inv = 255 / outA
    out[o] = Math.round((r / n) * inv)
    out[o + 1] = Math.round((g / n) * inv)
    out[o + 2] = Math.round((b / n) * inv)
    out[o + 3] = Math.round(outA)
  }
}

// ---------- PNG 编码 ----------
function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng() {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0
    out.subarray(y * SIZE * 4, (y + 1) * SIZE * 4).forEach((v, i) => {
      raw[y * (SIZE * 4 + 1) + 1 + i] = v
    })
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function encodeIco(png) {
  const header = Buffer.alloc(6 + 16)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // count
  header[6] = 0 // width 256 -> 0
  header[7] = 0 // height 256 -> 0
  header[8] = 0 // palette
  header[9] = 0 // reserved
  header.writeUInt16LE(1, 10) // planes
  header.writeUInt16LE(32, 12) // bpp
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18) // offset
  return Buffer.concat([header, png])
}

const png = encodePng()
const ico = encodeIco(png)

const buildDir = path.join(projectRoot, 'build')
const resourcesDir = path.join(projectRoot, 'resources')
fs.mkdirSync(buildDir, { recursive: true })
fs.mkdirSync(resourcesDir, { recursive: true })
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico)
fs.writeFileSync(path.join(buildDir, 'icon.png'), png)
fs.writeFileSync(path.join(resourcesDir, 'icon.png'), png)
console.log('图标已生成：build/icon.ico（256×256）、build/icon.png、resources/icon.png')
