import assert from 'node:assert/strict'
import test from 'node:test'
import { selectBoardSnapshot } from '@/lib/board'

function snapshot(shapeIds: string[]) {
  return {
    store: Object.fromEntries([
      ['document:document', { typeName: 'document' }],
      ['page:page', { typeName: 'page' }],
      ...shapeIds.map((id) => [`shape:${id}`, { typeName: 'shape' }]),
    ]),
    schema: {},
  }
}

test('preserves current canvas shapes when the remote board snapshot is empty', () => {
  const current = snapshot(['element:1', 'swatch:1'])
  const selection = selectBoardSnapshot({ store: {}, schema: {} }, current)

  assert.equal(selection.snapshot, current)
  assert.equal(selection.preserveCurrent, true)
  assert.equal(selection.localShapeCount, 2)
})

test('uses the remote snapshot when it contains shapes', () => {
  const remote = snapshot(['image-ref:1'])
  const selection = selectBoardSnapshot(remote, snapshot(['element:1', 'swatch:1']))

  assert.equal(selection.snapshot, remote)
  assert.equal(selection.preserveCurrent, false)
  assert.equal(selection.remoteShapeCount, 1)
})
