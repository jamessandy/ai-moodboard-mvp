import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCanvasDocument, selectBoardSnapshot } from '@/lib/board'

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

function imageSnapshot(withAsset: boolean) {
  const shapeId = 'shape:image-ref:1'
  const assetId = 'asset:image:1'
  return {
    store: {
      'document:document': { typeName: 'document' },
      'page:page': { typeName: 'page' },
      [shapeId]: {
        typeName: 'shape',
        type: 'image-ref',
        props: { assetId },
      },
      ...(withAsset
        ? {
            [assetId]: {
              typeName: 'asset',
              id: assetId,
              props: { src: 'https://example.com/image.png' },
            },
          }
        : {}),
    },
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

test('preserves current canvas shapes when a remote image shape has no usable asset', () => {
  const current = snapshot(['element:1', 'swatch:1'])
  const remote = imageSnapshot(false)
  const selection = selectBoardSnapshot(remote, current)

  assert.equal(selection.snapshot, current)
  assert.equal(selection.preserveCurrent, true)
  assert.equal(selection.remoteIncomplete, true)
})

test('uses the remote snapshot when it contains shapes', () => {
  const remote = imageSnapshot(true)
  const selection = selectBoardSnapshot(remote, snapshot([]))

  assert.equal(selection.snapshot, remote)
  assert.equal(selection.preserveCurrent, false)
  assert.equal(selection.remoteShapeCount, 1)
  assert.equal(selection.remoteIncomplete, false)
})

test('preserves the mounted canvas over an equally sized remote refresh', () => {
  const current = snapshot(['element:1', 'swatch:1'])
  const remote = snapshot(['element:2', 'swatch:2'])
  const selection = selectBoardSnapshot(remote, current)

  assert.equal(selection.snapshot, current)
  assert.equal(selection.preserveCurrent, true)
})

test('normalizes legacy records and resolves image assets into native nodes', () => {
  const document = normalizeCanvasDocument(imageSnapshot(true))
  assert.equal(document.version, 1)
  assert.equal(document.nodes.length, 1)
  assert.equal(document.nodes[0].type, 'image-ref')
  assert.equal(document.nodes[0].props.url, 'https://example.com/image.png')
  assert.ok(document.nodes[0].w >= 24)
  assert.ok(document.nodes[0].h >= 24)
})

test('normalizes legacy note records and accepts native board documents', () => {
  const legacy = snapshot(['note:1'])
  legacy.store['shape:note:1'] = {
    typeName: 'shape',
    id: 'shape:note:1',
    type: 'note',
    x: 12,
    y: 34,
    props: { text: 'Legacy note', w: 240, h: 120 },
  }
  const converted = normalizeCanvasDocument(legacy)
  assert.equal(converted.nodes[0].type, 'moodboard-note')
  assert.equal(converted.nodes[0].props.text, 'Legacy note')

  const native = {
    version: 3,
    sources: [],
    canvas: { version: 1, nodes: [{ ...converted.nodes[0], id: 'shape:native' }] },
  }
  assert.equal(normalizeCanvasDocument(native).nodes[0].id, 'shape:native')
})
