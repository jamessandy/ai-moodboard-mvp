import { removeBackground } from '@imgly/background-removal-node'
import sharp from 'sharp'

type Cutout = { buffer: Buffer; width: number; height: number }

const MAX_IMAGE_DIMENSION = 2048
const ALPHA_TRIM_THRESHOLD = 8
const BACKGROUND_REMOVAL_CONFIG = {
  model: 'medium' as const,
  output: {
    format: 'image/png' as const,
    quality: 1,
  },
}

export async function extractForegroundLocally(sourceBuffer: Buffer): Promise<Cutout> {
  const normalizedSource = await sharp(sourceBuffer)
    .rotate()
    .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()

  const image = new Blob([new Uint8Array(normalizedSource)], { type: 'image/png' })
  const cutoutBlob = await removeBackground(image, BACKGROUND_REMOVAL_CONFIG)
  const untrimmedCutout = Buffer.from(await cutoutBlob.arrayBuffer())
  const cutoutStats = await sharp(untrimmedCutout).stats()
  const alpha = cutoutStats.channels[3]

  if (!alpha || alpha.max <= ALPHA_TRIM_THRESHOLD) {
    throw new Error('Local background removal could not identify a foreground subject.')
  }

  const { data: buffer, info } = await sharp(untrimmedCutout)
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: ALPHA_TRIM_THRESHOLD,
    })
    .png()
    .toBuffer({ resolveWithObject: true })

  return { buffer, width: info.width, height: info.height }
}
