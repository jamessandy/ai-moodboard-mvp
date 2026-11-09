'use client'

const MAX_GRABCUT_DIMENSION = 900
const IMAGE_LOAD_TIMEOUT_MS = 15_000
const OPEN_CV_LOAD_TIMEOUT_MS = 30_000
const OPEN_CV_URL = 'https://docs.opencv.org/4.x/opencv.js'

type CvMat = { data: Uint8Array; delete: () => void }
type OpenCv = {
  Mat: new () => CvMat
  Rect: new (x: number, y: number, width: number, height: number) => unknown
  COLOR_RGBA2RGB: number
  GC_FGD: number
  GC_PR_FGD: number
  GC_INIT_WITH_RECT: number
  imread: (canvas: HTMLCanvasElement) => CvMat
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
  onRuntimeInitialized?: () => void
}

declare global {
  interface Window {
    cv?: OpenCv | Promise<OpenCv>
  }
}

let openCvPromise: Promise<OpenCv> | null = null

async function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const timeout = window.setTimeout(() => {
      image.onload = null
      image.onerror = null
      reject(new Error('Loading the source image timed out.'))
    }, IMAGE_LOAD_TIMEOUT_MS)
    const clearImageTimeout = () => window.clearTimeout(timeout)
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      clearImageTimeout()
      resolve(image)
    }
    image.onerror = () => {
      clearImageTimeout()
      reject(new Error('Could not load this image for local extraction.'))
    }
    image.src = url
  })
}

async function getOpenCv() {
  if (openCvPromise) return openCvPromise
  openCvPromise = new Promise<OpenCv>((resolve, reject) => {
    let settled = false
    let timeout: number | undefined
    const finishWithError = (error: Error) => {
      if (settled) return
      settled = true
      if (timeout !== undefined) window.clearTimeout(timeout)
      reject(error)
    }
    const finishWithCv = (cv: OpenCv) => {
      if (settled) return
      settled = true
      if (timeout !== undefined) window.clearTimeout(timeout)
      resolve(cv)
    }
    const ready = async () => {
      try {
        const cv = await window.cv
        if (!cv) throw new Error('OpenCV did not initialize.')
        if (cv.Mat) {
          finishWithCv(cv)
          return
        }

        const onRuntimeInitialized = cv.onRuntimeInitialized
        cv.onRuntimeInitialized = () => {
          onRuntimeInitialized?.()
          if (cv.Mat) finishWithCv(cv)
          else finishWithError(new Error('OpenCV did not initialize.'))
        }
        if (cv.Mat) finishWithCv(cv)
      } catch (error) {
        finishWithError(error instanceof Error ? error : new Error('OpenCV did not initialize.'))
      }
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${OPEN_CV_URL}"]`)
    timeout = window.setTimeout(
      () => finishWithError(new Error('OpenCV initialization timed out. Try extracting the subject again.')),
      OPEN_CV_LOAD_TIMEOUT_MS
    )
    if (window.cv) {
      void ready()
      return
    }
    if (existing) {
      existing.addEventListener('load', () => void ready(), { once: true })
      existing.addEventListener('error', () => finishWithError(new Error('Could not load OpenCV.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = OPEN_CV_URL
    script.async = true
    script.addEventListener('load', () => void ready(), { once: true })
    script.addEventListener('error', () => finishWithError(new Error('Could not load OpenCV.')), { once: true })
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    openCvPromise = null
    throw error
  })
  return openCvPromise
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the extracted image.'))), 'image/png')
  })
}

export async function extractForegroundWithGrabCut(url: string) {
  const [cv, image] = await Promise.all([getOpenCv(), loadImage(url)])
  const scale = Math.min(1, MAX_GRABCUT_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(2, Math.round(image.naturalWidth * scale))
  const height = Math.max(2, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas extraction is unavailable in this browser.')
  context.drawImage(image, 0, 0, width, height)

  const source = cv.imread(canvas)
  const rgb = new cv.Mat()
  const mask = new cv.Mat()
  const backgroundModel = new cv.Mat()
  const foregroundModel = new cv.Mat()

  try {
    cv.cvtColor(source, rgb, cv.COLOR_RGBA2RGB)
    const insetX = Math.max(1, Math.round(width * 0.04))
    const insetY = Math.max(1, Math.round(height * 0.04))
    const rectangle = new cv.Rect(insetX, insetY, width - insetX * 2, height - insetY * 2)
    cv.grabCut(rgb, mask, rectangle, backgroundModel, foregroundModel, 5, cv.GC_INIT_WITH_RECT)

    const pixels = context.getImageData(0, 0, width, height)
    let left = width
    let top = height
    let right = -1
    let bottom = -1
    for (let index = 0; index < width * height; index += 1) {
      const foreground = mask.data[index] === cv.GC_FGD || mask.data[index] === cv.GC_PR_FGD
      pixels.data[index * 4 + 3] = foreground ? 255 : 0
      if (!foreground) continue
      const x = index % width
      const y = Math.floor(index / width)
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
    if (right < left || bottom < top) throw new Error('GrabCut could not identify a foreground subject.')
    context.putImageData(pixels, 0, 0)

    const output = document.createElement('canvas')
    output.width = right - left + 1
    output.height = bottom - top + 1
    output.getContext('2d')?.drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height)
    return { blob: await canvasToBlob(output), width: output.width, height: output.height }
  } finally {
    source.delete()
    rgb.delete()
    mask.delete()
    backgroundModel.delete()
    foregroundModel.delete()
  }
}
