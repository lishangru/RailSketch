import test from 'node:test'
import assert from 'node:assert/strict'
import type { RailDocument } from '../src/types'
import { createDocument, isTrack, migrateDocument } from '../src/editor/model/Document'
import { createDemoDocument } from '../src/editor/model/DemoDocument'
import { validateTopology } from '../src/editor/topology/Topology'
import {
  MAX_COORDINATE,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_CROSSINGS,
  MAX_DOCUMENT_ELEMENTS,
  MAX_DOCUMENT_LAYERS,
  MAX_DOCUMENT_LINKS,
  MAX_DOCUMENT_NODES,
  MAX_DOCUMENT_POINTS,
  MAX_POLYLINE_POINTS,
  MAX_TEXT_LENGTH,
  MAX_TOTAL_TEXT_LENGTH,
  parseDocument,
  serializeDocument,
} from '../src/editor/serialization/serializer'

const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
const track = (id = 'track', extra: Record<string, unknown> = {}) => ({ id, type: 'track', points, ...extra })
const document = (extra: Record<string, unknown> = {}) => ({ name: '旧版项目', layers: [], elements: [], ...extra })
const parse = (value: unknown) => parseDocument(JSON.stringify(value))
function accepted(value: unknown): RailDocument {
  const result = parse(value)
  assert.equal(result.ok, true, result.error)
  assert.ok(result.document)
  return result.document
}
function rejected(value: unknown, message?: RegExp): void {
  const result = parse(value)
  assert.equal(result.ok, false)
  assert.equal(result.document, undefined)
  assert.ok(result.error)
  if (message) assert.match(result.error, message)
}

// JSON.stringify converts non-finite JS numbers to null; use literal overflow
// tokens to exercise JSON.parse's real Infinity path instead.
function withOverflow(value: unknown): string {
  return JSON.stringify(value).replace('987654321', '1e309')
}

test('v1 defaults and missing IDs migrate; deleted/zero layers remain supported', () => {
  const doc = accepted(document({ elements: [track('old', { layerId: 'deleted' })] }))
  assert.equal(doc.version, 3)
  assert.deepEqual(doc.canvas, { width: 4000, height: 3000, gridSize: 20 })
  assert.equal(doc.layers.length, 0)
  assert.equal(doc.elements[0].layerId, '')
  assert.equal(doc.nodes.length, 2)
  assert.deepEqual(validateTopology(doc), [])
  const legacy = accepted(document({ layers: [{ name: '旧图层' }], elements: [{ type: 'label', text: '旧文字' }] }))
  assert.ok(legacy.layers[0].id)
  assert.ok(legacy.elements[0].id)
})

test('v2 nodes without vertexLinks migrate idempotently', () => {
  const doc = accepted(document({
    version: 2,
    nodes: [{ id: 'start', x: 0, y: 0, connectedTrackIds: ['stale'] }],
    elements: [track('t', { startNodeId: 'start' })],
  }))
  assert.deepEqual(doc.nodes.find((n) => n.id === 'start')?.vertexLinks, [])
  assert.deepEqual(doc.nodes.find((n) => n.id === 'start')?.connectedTrackIds, ['t'])
  assert.deepEqual(validateTopology(doc), [])
  const before = serializeDocument(doc)
  assert.equal(migrateDocument(doc), doc)
  assert.equal(serializeDocument(doc), before)
})

test('current factory and demonstration documents round-trip safely', () => {
  for (const source of [createDocument(), migrateDocument(createDemoDocument())]) {
    const result = parseDocument(serializeDocument(source))
    assert.equal(result.ok, true, result.error)
    assert.deepEqual(JSON.parse(serializeDocument(result.document!)), JSON.parse(serializeDocument(source)))
  }
})

test('unsupported and non-integer versions fail instead of being silently downgraded', () => {
  for (const version of [0, -1, 1.5, 4, 999, null, '3']) rejected(document({ version }))
  const doc = createDocument()
  doc.version = 4
  assert.throws(() => migrateDocument(doc), /版本/)
  assert.equal(doc.version, 4)
})

test('malformed roots, arrays, elements and geometry fail atomically', () => {
  for (const value of [null, [], 3, 'x', {}, document({ name: null }), document({ canvas: [] }),
    document({ layers: [null] }), document({ elements: [1] }), document({ nodes: {} }),
    document({ crossings: [false] }), document({ elements: [{ type: 'unsupported' }] }),
    document({ elements: [track('t', { points: [] })] }),
    document({ elements: [track('t', { points: [points[0]] })] }),
    document({ elements: [{ type: 'line', points: [points[0], null, points[1]] }] }),
    document({ elements: [track('t', { points: [{ x: 0 }, points[1]] })] }),
  ]) rejected(value)
  assert.equal(parseDocument('{broken').ok, false)
})

test('bad vertices are not filtered and cannot shift vertexLinks indices', () => {
  rejected(document({
    elements: [track('t', { points: [points[0], { x: 'bad', y: 1 }, points[1]] })],
    nodes: [{ id: 'n', vertexLinks: [{ trackId: 't', vertexIndex: 1 }] }],
  }), /track.points/)
})

test('canvas values reject zero, negative, tiny, huge, wrong-type and overflowing numbers', () => {
  for (const field of ['width', 'height', 'gridSize']) {
    for (const value of [0, -1, 1e-300, 1e300, null, '20']) {
      rejected(document({ canvas: { [field]: value } }), new RegExp(`canvas.${field}`))
    }
    const result = parseDocument(withOverflow(document({ canvas: { [field]: 987654321 } })))
    assert.equal(result.ok, false)
    assert.equal(result.document, undefined)
  }
})

test('all imported geometry locations reject overflowing or enormous coordinates', () => {
  const cases = (value: number) => [
    document({ elements: [track('t', { points: [{ x: value, y: 0 }, points[1]] })] }),
    document({ elements: [{ type: 'line', points: [points[0], { x: 0, y: value }] }] }),
    document({ elements: [{ type: 'platform', start: { x: value, y: 0 } }] }),
    document({ elements: [{ type: 'platform', end: { x: 0, y: value } }] }),
    document({ elements: [{ type: 'label', x: value }] }),
    document({ elements: [{ type: 'label', y: value }] }),
    document({ nodes: [{ id: 'n', x: value }] }),
    document({ nodes: [{ id: 'n', y: value }] }),
    document({ crossings: [{ id: 'c', point: { x: value, y: 0 } }] }),
  ]
  for (const value of [MAX_COORDINATE + 1, -MAX_COORDINATE - 1, 1e300, -1e300]) {
    for (const input of cases(value)) rejected(input)
  }
  for (const input of cases(987654321)) assert.equal(parseDocument(withOverflow(input)).ok, false)
  accepted(document({ elements: [track('t', { points: [{ x: -MAX_COORDINATE, y: MAX_COORDINATE }, points[1]] })] }))
})

test('every rendering size/offset rejects overflow instead of poisoning camera or canvas', () => {
  const fields: Record<string, string[]> = {
    track: ['strokeWidth', 'spacing', 'cornerRadius', 'bridgeGap'],
    line: ['strokeWidth'],
    platform: ['width'],
    label: ['rotation', 'fontSize'],
    'direction-marker': ['offset', 'textOffset', 'fontSize', 'arrowSize', 'strokeWidth'],
  }
  for (const [type, names] of Object.entries(fields)) {
    for (const field of names) {
      for (const value of [null, '12', 1e300]) rejected(document({ elements: [{ type, points, [field]: value }] }))
      const result = parseDocument(withOverflow(document({ elements: [{ type, points, [field]: 987654321 }] })))
      assert.equal(result.ok, false, `${type}.${field}`)
    }
  }
  rejected(document({ elements: [{ type: 'label', fontSize: 0 }] }))
  rejected(document({ elements: [track('t', { spacing: -1 })] }))
  accepted(document({ elements: [track('t'), { type: 'direction-marker', trackId: 't', offset: -10, textOffset: -20, arrowSize: 0 }] }))
})

test('duplicate or empty IDs in each namespace are rejected before migration', () => {
  const items = {
    layers: { id: 'same' }, elements: { id: 'same', type: 'label' },
    nodes: { id: 'same' }, crossings: { id: 'same' },
  }
  for (const [field, item] of Object.entries(items)) {
    rejected(document({ [field]: [item, item] }), /重复 ID/)
    rejected(document({ [field]: [{ ...item, id: '' }] }), /不能为空/)
  }
  // IDs are local to each explicitly typed reference namespace.
  accepted(document({ layers: [{ id: 'same' }], elements: [{ id: 'same', type: 'label', layerId: 'same' }] }))
})

test('synthesized legacy IDs do not collide with supplied IDs appearing later', () => {
  const doc = accepted(document({
    layers: [{}, { id: 'layer-0' }],
    elements: [{ type: 'label' }, { id: 'el-0', type: 'label' }],
    nodes: [{}, { id: 'node-0' }],
  }))
  assert.equal(new Set(doc.layers.map((l) => l.id)).size, 2)
  assert.equal(new Set(doc.elements.map((el) => el.id)).size, 2)
  assert.ok(doc.elements.some((el) => el.id === 'el-0'))
})

test('dangling endpoints are repaired, cached links rebuilt and bad/duplicate vertexLinks removed', () => {
  const doc = accepted(document({
    elements: [track('t', { startNodeId: 'missing' })],
    nodes: [{
      id: 'switch', x: 0, y: 0, connectedTrackIds: ['ghost', 't', 't'],
      vertexLinks: [
        { trackId: 't', vertexIndex: 0 }, { trackId: 't', vertexIndex: 0 },
        { trackId: 't', vertexIndex: 2 }, { trackId: 't', vertexIndex: -1 },
        { trackId: 'ghost', vertexIndex: 0 }, { trackId: 't', vertexIndex: Number.MAX_SAFE_INTEGER },
      ],
    }, { id: 'orphan', connectedTrackIds: ['t'] }],
  }))
  assert.deepEqual(doc.nodes.find((n) => n.id === 'switch')?.vertexLinks, [{ trackId: 't', vertexIndex: 0 }])
  assert.deepEqual(doc.nodes.find((n) => n.id === 'switch')?.connectedTrackIds, ['t'])
  assert.ok(!doc.nodes.some((n) => n.id === 'orphan'))
  assert.deepEqual(validateTopology(doc), [])
  const before = serializeDocument(doc)
  migrateDocument(doc)
  assert.equal(serializeDocument(doc), before)
})

test('dangling/wrong-type marker, label and crossing references are removed', () => {
  const doc = accepted(document({
    elements: [
      track('a', { labelId: 'missing', labelText: 'keep text' }), track('b', { labelId: 'label' }),
      { id: 'label', type: 'label' },
      { id: 'valid', type: 'direction-marker', trackId: 'a' },
      { id: 'ghost', type: 'direction-marker', trackId: 'missing' },
      { id: 'wrong-type', type: 'direction-marker', trackId: 'label' },
    ],
    crossings: [
      { id: 'valid', trackAId: 'a', trackBId: 'b' },
      { id: 'duplicate-pair', trackAId: 'b', trackBId: 'a' },
      { id: 'missing', trackAId: 'a', trackBId: 'missing' },
      { id: 'wrong-type', trackAId: 'a', trackBId: 'label' },
      { id: 'self', trackAId: 'a', trackBId: 'a' },
    ],
  }))
  assert.deepEqual(doc.elements.filter((el) => el.type === 'direction-marker').map((el) => el.id), ['valid'])
  const tracks = doc.elements.filter(isTrack)
  assert.equal(tracks[0].labelId, undefined)
  assert.equal(tracks[0].labelText, 'keep text')
  assert.equal(tracks[1].labelId, 'label')
  assert.deepEqual(doc.crossings.map((c) => c.id), ['valid'])
})

test('distinct intersections of the same track pair survive save and reload', () => {
  const doc = accepted(document({
    elements: [track('a'), track('b', { points: [{ x: 20, y: -10 }, { x: 20, y: 10 }, { x: 80, y: 10 }, { x: 80, y: -10 }] })],
    crossings: [
      { id: 'first', trackAId: 'a', trackBId: 'b', point: { x: 20, y: 0 }, mode: 'bridge-a-over-b' },
      { id: 'second', trackAId: 'b', trackBId: 'a', point: { x: 80, y: 0 }, mode: 'bridge-a-over-b' },
      { id: 'duplicate', trackAId: 'b', trackBId: 'a', point: { x: 20, y: 0 }, mode: 'plain' },
    ],
  }))
  assert.deepEqual(doc.crossings.map((c) => c.id), ['first', 'second'])
  assert.deepEqual(accepted(JSON.parse(serializeDocument(doc))), doc)
})

test('explicit endpoint and internal vertex node-coordinate conflicts are rejected', () => {
  rejected(document({ elements: [track('t', { startNodeId: 'n' })], nodes: [{ id: 'n', x: 10, y: 0 }] }), /坐标与绑定/)
  rejected(document({ elements: [track('t')], nodes: [{ id: 'n', x: 10, y: 0, vertexLinks: [{ trackId: 't', vertexIndex: 0 }] }] }), /坐标与绑定/)
  // The node cannot simultaneously bind two different geometric locations,
  // even when its own coordinates were omitted in an older document.
  rejected(document({ elements: [track('t', { startNodeId: 'n', endNodeId: 'n' })], nodes: [{ id: 'n' }] }), /坐标与绑定/)
  const near = accepted(document({ elements: [track('t', { startNodeId: 'n' })], nodes: [{ id: 'n', x: 0.001, y: 0 }] }))
  assert.deepEqual(validateTopology(near), [])
})

test('missing legacy node coordinates are inferred from bound geometry without moving tracks', () => {
  for (const version of [1, 2, 3]) {
    const doc = accepted(document({
      version,
      elements: [track('t', { startNodeId: 'n', points: [{ x: 150, y: 40 }, { x: 250, y: 40 }] })],
      nodes: [{ id: 'n' }, { id: 'vertex', x: 250, vertexLinks: [{ trackId: 't', vertexIndex: 1 }] }],
    }))
    const endpoint = doc.nodes.find((n) => n.id === 'n')!
    const vertex = doc.nodes.find((n) => n.id === 'vertex')!
    assert.deepEqual({ x: endpoint.x, y: endpoint.y }, { x: 150, y: 40 })
    assert.deepEqual({ x: vertex.x, y: vertex.y }, { x: 250, y: 40 })
    assert.deepEqual(validateTopology(doc), [])
    assert.deepEqual(accepted(JSON.parse(serializeDocument(doc))), doc)
  }
})

test('JSON enum objects cannot throw via attacker-controlled toString coercion', () => {
  const hostile = { toString: {}, valueOf: {} }
  const doc = accepted(document({
    elements: [track('t'), { type: 'direction-marker', trackId: 't', arrow: hostile }],
    nodes: [{ id: 'n', nodeType: hostile, vertexLinks: [{ trackId: 't', vertexIndex: 0 }] }],
    crossings: [{ id: 'c', mode: hostile }],
  }))
  assert.equal(doc.nodes.find((n) => n.id === 'n')?.nodeType, 'endpoint')
  const marker = doc.elements.find((el) => el.type === 'direction-marker')
  assert.ok(marker?.type === 'direction-marker')
  assert.equal(marker.arrow, 'outward')
})

test('unknown keys are dropped without prototype pollution or retaining platform point properties', () => {
  const json = '{"name":"test","layers":[],"elements":[{"type":"platform","start":{"x":0,"y":0,"extra":{"deep":true},"__proto__":{"polluted":true}},"__proto__":{"polluted":true}}],"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'
  const result = parseDocument(json)
  assert.equal(result.ok, true, result.error)
  assert.ok(result.document)
  const platform = result.document.elements[0]
  assert.ok(platform.type === 'platform')
  assert.deepEqual(platform.start, { x: 0, y: 0 })
  assert.ok(!Object.hasOwn(result.document, '__proto__'))
  assert.ok(!Object.hasOwn(platform, '__proto__'))
  assert.equal(({} as { polluted?: boolean }).polluted, undefined)
})

test('markup-like text and colors remain inert JSON data, without claiming nonexistent SVG export', () => {
  const text = '</text><script>alert("x")</script>&"'
  const color = '\" onload=\"alert(1)'
  const doc = accepted(document({ elements: [{ type: 'label', text }, track('t', { color })] }))
  const roundTrip = accepted(JSON.parse(serializeDocument(doc)))
  assert.deepEqual(roundTrip, doc)
  assert.equal(roundTrip.elements[0].type === 'label' && roundTrip.elements[0].text, text)
})

test('file byte cap is applied before parsing, including UTF-8 multibyte and surrogate pairs', () => {
  const valid = JSON.stringify(document())
  assert.equal(parseDocument(valid + ' '.repeat(MAX_DOCUMENT_BYTES - Buffer.byteLength(valid))).ok, true)
  assert.equal(parseDocument(valid + ' '.repeat(MAX_DOCUMENT_BYTES - Buffer.byteLength(valid) + 1)).ok, false)
  for (const character of ['界', '\u{1f682}']) {
    // The field is ignored, isolating the byte limit from per-field text limits.
    const json = JSON.stringify(document({ extra: character.repeat(Math.floor(MAX_DOCUMENT_BYTES / Buffer.byteLength(character)) + 1) }))
    assert.ok(json.length < MAX_DOCUMENT_BYTES)
    const result = parseDocument(json)
    assert.equal(result.ok, false)
    assert.match(result.error!, /MiB/)
  }
  assert.equal(parseDocument(null as unknown as string).ok, false)
})

test('top-level entity budgets fail before normalization and migration', () => {
  const cases = [
    ['elements', MAX_DOCUMENT_ELEMENTS], ['layers', MAX_DOCUMENT_LAYERS],
    ['nodes', MAX_DOCUMENT_NODES], ['crossings', MAX_DOCUMENT_CROSSINGS],
  ] as const
  for (const [field, limit] of cases) rejected(document({ [field]: Array(limit + 1).fill(null) }), /数量超过上限/)
})

test('per-polyline and cumulative point budgets are enforced', () => {
  rejected(document({ elements: [track('t', { points: Array(MAX_POLYLINE_POINTS + 1).fill(points[0]) })] }), /数量超过上限/)
  const count = Math.floor(MAX_DOCUMENT_POINTS / 3) + 1
  rejected(document({ elements: Array.from({ length: 3 }, (_, i) => ({ id: `line-${i}`, type: 'line', points: Array(count).fill(points[0]) })) }), /折线点总数/)
})

test('aggregate topology link budget includes stale and cached references', () => {
  rejected(document({ nodes: [{ id: 'n', connectedTrackIds: Array(MAX_DOCUMENT_LINKS + 1).fill('t') }] }), /数量超过上限/)
  rejected(document({ nodes: [
    { id: 'a', connectedTrackIds: Array(MAX_DOCUMENT_LINKS / 2 + 1).fill('t') },
    { id: 'b', vertexLinks: Array(MAX_DOCUMENT_LINKS / 2).fill({ trackId: 't', vertexIndex: 0 }) },
  ] }), /拓扑引用总数/)
})

test('migration-generated connectivity is also bounded and accepted links round-trip', () => {
  const links = Array.from({ length: MAX_DOCUMENT_LINKS / 2 }, (_, vertexIndex) => ({ trackId: 't', vertexIndex }))
  const longTrack = track('t', { points: Array.from({ length: MAX_POLYLINE_POINTS }, () => ({ x: 0, y: 0 })) })
  rejected(document({ elements: [longTrack], nodes: [
    { id: 'a', vertexLinks: links }, { id: 'b', vertexLinks: links },
  ] }), /迁移后的拓扑引用/)
  const acceptedDoc = accepted(document({ elements: [longTrack], nodes: [{ id: 'a', vertexLinks: links }] }))
  assert.deepEqual(accepted(JSON.parse(serializeDocument(acceptedDoc))), acceptedDoc)
})

test('single and aggregate text budgets reject resource-heavy label sets', () => {
  rejected(document({ elements: [{ type: 'label', text: 'a'.repeat(MAX_TEXT_LENGTH + 1) }] }), /字符串/)
  rejected(document({ elements: Array.from({ length: Math.ceil(MAX_TOTAL_TEXT_LENGTH / MAX_TEXT_LENGTH) }, () => ({ type: 'label', text: 'a'.repeat(MAX_TEXT_LENGTH) })) }), /文本总长度/)
})

test('compact files cannot request unbounded all-pairs segment or crossing-record searches', () => {
  const manySegments = (y: number) => Array.from({ length: 1501 }, (_, x) => ({ x, y }))
  rejected(document({ elements: [track('a', { points: manySegments(0) }), track('b', { points: manySegments(1) })] }), /交叉计算量/)
  rejected(document({
    elements: [track('t-0', { points: manySegments(0).slice(0, 51) }), track('t-1', { points: manySegments(1).slice(0, 51) })],
    crossings: Array.from({ length: 1000 }, (_, i) => ({ id: `c-${i}`, trackAId: 't-0', trackBId: 't-1' })),
  }), /交叉计算量/)
  // One long track has no cross-track quadratic work; do not reject it solely
  // because another shape of document with the same point count is expensive.
  accepted(document({ elements: [track('long', { points: Array.from({ length: MAX_POLYLINE_POINTS }, (_, x) => ({ x, y: 0 })) })] }))
})

test('direct migration rejects ambiguous model IDs and empty tracks', () => {
  const duplicate = accepted(document({ elements: [{ id: 'a', type: 'label' }] }))
  duplicate.elements.push({ ...duplicate.elements[0] })
  assert.throws(() => migrateDocument(duplicate), /重复 ID/)
  const empty = accepted(document({ elements: [track()] }))
  const t = empty.elements[0]
  assert.ok(isTrack(t))
  t.points = []
  assert.throws(() => migrateDocument(empty), /两个点/)
})
