import assert from 'node:assert/strict'
import test from 'node:test'
import { CREDIT_PACKS } from '../lib/credits/packs'
import { quoteFalAction } from '../lib/credits/pricing'

test('default credit prices apply the five-times fal markup', () => {
  assert.deepEqual(quoteFalAction('generate_image'), { falUsd: 0.15, credits: 75 })
  assert.deepEqual(quoteFalAction('generate_image', 2), { falUsd: 0.3, credits: 150 })
  assert.deepEqual(quoteFalAction('orbit_scene'), { falUsd: 0.02, credits: 10 })
  assert.deepEqual(quoteFalAction('extract_subject'), { falUsd: 0.005, credits: 3 })
})

test('credit packs preserve 100 credits per dollar', () => {
  for (const pack of Object.values(CREDIT_PACKS)) {
    assert.equal(pack.credits, pack.amountCents)
  }
})
