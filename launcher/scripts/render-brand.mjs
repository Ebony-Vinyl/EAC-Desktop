import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pixels = [
  '........................',
  '........................',
  '....................XX..',
  '...................XXX..',
  '.................XXXXX..',
  '...XXXXXXXXXXX..XXXXX...',
  '..XXXXXXXXXXXXXXXXXX....',
  '.XXXXXXXXXXXXXXXXXX.....',
  'XXXXXXXX.XXXXXXXXXX.....',
  'XXXXXXXX..XXXXXXXXX.....',
  '.XXXXXXXXXXXXXXXXX......',
  '..XXXXXXXXXXXXXXX.......',
  '...XXXXXXXXXXXXX........',
  '.....XXXXXXXXX..........',
  '........................',
  '........................',
]
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, crc])
}
const size = 256
const raw = Buffer.alloc((size * 4 + 1) * size)
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const gx = Math.floor((x - 8) / 10)
    const gy = Math.floor((y - 48) / 10)
    const active = pixels[gy]?.[gx] === 'X'
    const highlight = active && gy < 8
    const color = active ? (highlight ? [142, 239, 240, 255] : [57, 184, 204, 255]) : [0, 0, 0, 0]
    const index = y * (size * 4 + 1) + 1 + x * 4
    raw.set(color, index)
  }
}
const header = Buffer.alloc(13)
header.writeUInt32BE(size, 0)
header.writeUInt32BE(size, 4)
header[8] = 8
header[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
])
await mkdir(join(root, 'public'), { recursive: true })
await mkdir(join(root, 'src-tauri/icons'), { recursive: true })
await writeFile(join(root, 'public/eac-pixel.png'), png)
await writeFile(join(root, 'src-tauri/icons/icon.png'), png)
const icoHeader = Buffer.from([0, 0, 1, 0, 1, 0])
const entry = Buffer.alloc(16)
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(22, 12)
await writeFile(join(root, 'src-tauri/icons/icon.ico'), Buffer.concat([icoHeader, entry, png]))
console.log('Rendered original EAC pixel artwork and application icons.')
