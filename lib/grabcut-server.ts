import sharp from 'sharp'

type CvMat = {
  data: Uint8Array
  delete: () => void
}

type OpenCv = {
  Mat: new () => CvMat
  Rect: new (x: number, y: number, width: number, height: number) => unknown
  CV_8UC1: number
  CV_8UC4: number
  COLOR_RGBA2RGB: number
  GC_FGD: number
  GC_PR_FGD: number
  GC_INIT_WITH_RECT: number
  matFromArray: (rows: number, columns: number, type: number, data: Uint8Array) => CvMat
  cvtColor: (source: CvMat, destination: CvMat, conversion: number) => void
  grabCut: (
    image: CvMat,
    mask: CvMat,
    rectangle: unknown,
    backgroundModel: CvMat,
    foregroundModel: CvMat,
    iterations: number,
    mode: number
  ) => void
}

type OpenCvPackage = { default: OpenCv | Promise<OpenCv> }
type Cutout = { buffer: Buffer; width: number; height: number }

const MAX_IMAGE_DIMENSION = 1024
let openCvPromise: Promise<OpenCv> | null = null

async function getOpenCv() {
  if (!openCvPromise) {
    openCvPromise = import('@techstark/opencv-js')
      .then(async (opencvPackage) => {
        const runtime = (opencvPackage as unknown as OpenCvPackage).default
        const cv = await runtime
        if (!cv?.Mat || !cv.matFromArray || !cv.grabCut) {
          throw new Error('The local OpenCV runtime did not initialize.')
        }
        return cv
      })
      .catch((error: unknown) => {
        openCvPromise = null
        throw error
      })
  }
  return openCvPromise
}

export async function extractForegroundGrabCut(sourceBuffer: Buffer): Promise<Cutout> {
  const { data, info } = await sharp(sourceBuffer)
    .rotate()
    .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info
  if (width < 2 || height < 2 || info.channels !== 4) {
    throw new Error('Could not decode the source image for local extraction.')
  }

  const cv = await getOpenCv()
  const source = cv.matFromArray(height, width, cv.CV_8UC4, new Uint8Array(data))
  const rgb = new cv.Mat()
  const mask = cv.matFromArray(height, width, cv.CV_8UC1, new Uint8Array(width * height))
  const backgroundModel = new cv.Mat()
  const foregroundModel = new cv.Mat()

  try {
    cv.cvtColor(source, rgb, cv.COLOR_RGBA2RGB)
    const insetX = Math.min(Math.max(1, Math.round(width * 0.04)), Math.floor((width - 1) / 2))
    const insetY = Math.min(Math.max(1, Math.round(height * 0.04)), Math.floor((height - 1) / 2))
    cv.grabCut(
      rgb,
      mask,
      new cv.Rect(insetX, insetY, width - insetX * 2, height - insetY * 2),
      backgroundModel,
      foregroundModel,
      5,
      cv.GC_INIT_WITH_RECT
    )

    let left = width
    let top = height
    let right = -1
    let bottom = -1
    const pixels = Buffer.from(data)
    for (let index = 0; index < width * height; index += 1) {
      const foreground = mask.data[index] === cv.GC_FGD || mask.data[index] === cv.GC_PR_FGD
      pixels[index * 4 + 3] = foreground ? 255 : 0
      if (!foreground) continue
      const x = index % width
      const y = Math.floor(index / width)
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }

    if (right < left || bottom < top) {
      throw new Error('GrabCut could not identify a foreground subject.')
    }

    const box = { left, top, width: right - left + 1, height: bottom - top + 1 }
    const { data: buffer, info: outputInfo } = await sharp(pixels, {
      raw: { width, height, channels: 4 },
    })
      .extract(box)
      .png()
      .toBuffer({ resolveWithObject: true })
    return { buffer, width: outputInfo.width, height: outputInfo.height }
  } finally {
    source.delete()
    rgb.delete()
    mask.delete()
    backgroundModel.delete()
    foregroundModel.delete()
  }
}
