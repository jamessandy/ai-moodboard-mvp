import assert from 'node:assert/strict'
import test from 'node:test'
import { findRunpodImage } from '@/app/api/generate/route'

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
