import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  artifacts,
  assertLocalReferences,
  checkArtifacts,
  exportContract,
  renderArtifacts,
  root,
} from './commerce-contract.mjs'

const schema = JSON.parse(await readFile(path.join(root, artifacts[1]), 'utf8'))
const samples = JSON.parse(await readFile(path.join(root, artifacts[2]), 'utf8'))

test('real offline exports match committed schemas and Python-validated samples', async () => {
  assert.deepEqual(await exportContract(), schema)
  assert.deepEqual(await exportContract(true), samples)
})

test('generation is byte-stable and all committed artifacts match', async () => {
  const first = await renderArtifacts(schema, samples)
  const second = await renderArtifacts(schema, samples)
  assert.deepEqual(first, second)
  await checkArtifacts(root, first)
})

test('generated types omit absent empty roots but retain declared contract sections', async () => {
  const rendered = (await renderArtifacts(schema, samples)).get(artifacts[0])
  assert.match(rendered, /export interface paths/)
  assert.match(rendered, /export interface components/)
  assert.doesNotMatch(rendered, /export (?:type|interface) (?:webhooks|\$defs)\b/)

  const extended = structuredClone(schema)
  extended.webhooks = {
    inventoryChanged: {
      post: {
        operationId: 'inventoryChanged',
        responses: { 204: { description: 'Accepted' } },
      },
    },
  }
  extended.$defs = { type: 'object', properties: { eventId: { type: 'string' } } }
  const extendedTypes = (await renderArtifacts(extended, samples)).get(artifacts[0])
  assert.match(extendedTypes, /export interface webhooks/)
  assert.match(extendedTypes, /inventoryChanged/)
  assert.match(extendedTypes, /export interface \$defs/)
  assert.match(extendedTypes, /eventId/)
})

test('drift check rejects both Python schema drift and edited generated files without writing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'commerce-contract-test-'))
  try {
    const original = await renderArtifacts(schema, samples)
    for (const [file, content] of original) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
      await writeFile(path.join(directory, file), content)
    }
    const changed = structuredClone(schema)
    changed.components.schemas.OrderResponse.properties.status.enum.push('paid')
    const regenerated = await renderArtifacts(changed, samples)
    assert.notEqual(regenerated.get(artifacts[0]), original.get(artifacts[0]))
    await assert.rejects(checkArtifacts(directory, regenerated), /Commerce contract drift/)
    for (const [file, content] of original) {
      assert.equal(await readFile(path.join(directory, file), 'utf8'), content)
    }
    for (const file of artifacts) {
      await writeFile(path.join(directory, file), 'stale\n')
      await assert.rejects(checkArtifacts(directory, original), /Commerce contract drift/)
      assert.equal(await readFile(path.join(directory, file), 'utf8'), 'stale\n')
      await writeFile(path.join(directory, file), original.get(file))
    }
    await checkArtifacts(directory, original)
    for (const file of artifacts) {
      await rm(path.join(directory, file))
      await assert.rejects(checkArtifacts(directory, original), /Commerce contract drift/)
      await writeFile(path.join(directory, file), original.get(file))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('external refs are rejected before generator can fetch or read external sources', async () => {
  for (const reference of [
    'https://example.invalid/schema',
    'file:///private',
    '../schema.json',
    null,
  ]) {
    const changed = structuredClone(schema)
    changed.components.schemas.OrderResponse.properties.total = { $ref: reference }
    await assert.rejects(renderArtifacts(changed, samples), /only local references/)
  }
  for (const externalValue of ['https://example.invalid/data', 'file:///private', '../data.json']) {
    const changed = structuredClone(schema)
    changed.components.examples = { remote: { externalValue } }
    await assert.rejects(renderArtifacts(changed, samples), /only local references/)
  }
  for (const reference of ['https://example.invalid/schema', 'file:///private', '../schema.json']) {
    const changed = structuredClone(schema)
    changed.components.schemas.OrderResponse.discriminator = {
      propertyName: 'status',
      mapping: { pending_payment: reference },
    }
    await assert.rejects(renderArtifacts(changed, samples), /only local references/)
  }
  assert.doesNotThrow(() => assertLocalReferences(schema))
})
