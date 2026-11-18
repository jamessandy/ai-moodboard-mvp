import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import {
  buildRunpodReferenceSheet,
  describeRunpodShape,
  findRunpodImage,
  prepareRunpodGenerationInput,
  runpodReferenceCapabilityError,
  runpodReferencePrompt,
} from '@/app/api/generate/route'

test('finds the FLUX.2 worker base64 image output', () => {
  const image = Buffer.alloc(300, 42).toString('base64')
  assert.deepEqual(findRunpodImage({ image, seed: 42 }), { value: image, contentType: undefined })
})

test('finds data URLs returned in the Runpod message field', () => {
  const image = `data:image/png;base64,${Buffer.alloc(300, 42).toString('base64')}`
  assert.deepEqual(findRunpodImage({ message: image, status: 'success' }), {
    value: image,
    contentType: undefined,
  })
})

test('finds URL outputs nested in an images collection', () => {
  assert.deepEqual(
    findRunpodImage({ images: [{ url: 'https://image.runpod.ai/generated.png', type: 'image/png' }] }),
    { value: 'https://image.runpod.ai/generated.png', contentType: 'image/png' }
  )
})

test('ignores non-image Runpod status messages', () => {
  assert.equal(findRunpodImage({ message: 'generation completed', status: 'success' }), null)
})

test('finds an image inside a JSON-encoded worker response', () => {
  const image = Buffer.alloc(300, 42).toString('base64')
  const output = JSON.stringify({ payload: { image_base64: image } })
  assert.deepEqual(findRunpodImage(output), { value: image, contentType: undefined })
})

test('finds an image under an endpoint-specific response wrapper', () => {
  const image = Buffer.alloc(300, 42).toString('base64')
  assert.deepEqual(findRunpodImage({ payload: { generated: { image } } }), {
    value: image,
    contentType: undefined,
  })
})

test('converts a JSON byte array image to base64', () => {
  const bytes = Array.from(Buffer.alloc(300, 42))
  assert.deepEqual(findRunpodImage({ data: bytes, mimeType: 'image/png' }), {
    value: Buffer.from(bytes).toString('base64'),
    contentType: 'image/png',
  })
})

test('describes output structure without exposing its string contents', () => {
  const secretImage = Buffer.alloc(300, 42).toString('base64')
  const description = describeRunpodShape({ payload: { image: secretImage }, seed: 42 })
  assert.equal(description, 'object{payload:object{image:string(400)},seed:number}')
  assert.equal(description.includes(secretImage), false)
})

test('turns a text-only endpoint schema failure into an actionable reference-worker error', () => {
  assert.equal(
    runpodReferenceCapabilityError('INVALID_INPUT: image: Extra inputs are not permitted'),
    "This Runpod endpoint only supports text-to-image generation and cannot receive moodboard references. Deploy the project's runpod-worker image-edit endpoint, then set RUNPOD_ENDPOINT_ID to its endpoint ID."
  )
  assert.equal(runpodReferenceCapabilityError('CUDA out of memory'), null)
})

test('builds a square reference sheet for multiple FLUX.2 inputs', async () => {
  const redPortrait = await sharp({
    create: { width: 160, height: 320, channels: 3, background: '#ff0000' },
  }).png().toBuffer()
  const blueLandscape = await sharp({
    create: { width: 320, height: 160, channels: 3, background: '#0000ff' },
  }).png().toBuffer()

  const sheet = await buildRunpodReferenceSheet([redPortrait, blueLandscape])
  const metadata = await sharp(sheet).metadata()

  assert.equal(metadata.format, 'jpeg')
  assert.equal(metadata.width, 1024)
  assert.equal(metadata.height, 1024)
})

test('maps prompt element numbers to ordered reference-sheet panels', () => {
  const prompt = runpodReferencePrompt(3)
  assert.match(prompt, /Element 1 is the top-left panel/)
  assert.match(prompt, /Element 2 is the top-right panel/)
  assert.match(prompt, /Element 3 is the bottom-center panel/)
  assert.match(prompt, /never a collage/)
})

test('includes original references and a compatible visual sheet in the Runpod input', async () => {
  const red = await sharp({
    create: { width: 64, height: 96, channels: 3, background: '#ff0000' },
  }).png().toBuffer()
  const blue = await sharp({
    create: { width: 96, height: 64, channels: 3, background: '#0000ff' },
  }).png().toBuffer()
  const urls = [
    `data:image/png;base64,${red.toString('base64')}`,
    `data:image/png;base64,${blue.toString('base64')}`,
  ]

  const input = await prepareRunpodGenerationInput({
    prompt: 'Use Element 1 for pose and Element 2 for outfit.',
    image_urls: urls,
    model: 'runpod/flux-2-klein',
  })

  assert.deepEqual(input.images, urls)
  assert.deepEqual(input.image_urls, urls)
  assert.notEqual(input.image, urls[0])
  assert.match(input.prompt, /Use the attached visual references/)
  const metadata = await sharp(Buffer.from(input.image, 'base64')).metadata()
  assert.equal(metadata.width, 1024)
  assert.equal(metadata.height, 1024)
})
