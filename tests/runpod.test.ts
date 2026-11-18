import assert from 'node:assert/strict'
import test from 'node:test'
import { describeRunpodShape, findRunpodImage } from '@/app/api/generate/route'

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
