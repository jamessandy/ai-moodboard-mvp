import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { extractForegroundGrabCut } from '@/lib/grabcut-server'

test('server GrabCut extracts a bounded foreground cutout locally', async () => {
  const width = 256
  const height = 256
  const pixels = Buffer.alloc(width * height * 4, 255)
  for (let y = 45; y < 210; y += 1) {
    for (let x = 80; x < 176; x += 1) {
      const index = (y * width + x) * 4
      pixels[index] = 220
      pixels[index + 1] = 20
      pixels[index + 2] = 30
    }
  }
  const source = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer()

  const result = await extractForegroundGrabCut(source)
  assert.ok(result.width > 0 && result.width < width)
  assert.ok(result.height > 0 && result.height < height)
  assert.equal((await sharp(result.buffer).metadata()).format, 'png')
})
