import { describe, expect, it } from 'vitest'
import {
  IMPORT_LIMITS,
  buildBackup,
  parseBackup,
  planImport,
  serializeBackup,
} from './backup'
import { createRecipe, serializeRecipe, type RecipeDraft } from './storage'
import type { Recipe } from './types'

function forwardRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return createRecipe({
    name: '备份方案',
    mode: 'forward',
    appVersion: '0.1.0',
    viscosityModel: { id: 'simplified-walther', version: 1 },
    components: [{ id: 'pao', name: 'PAO 6', category: 'PAO', viscosity: 10, fraction: 1, pricePerKg: 2 }],
    categoryConstraints: [],
    targetViscosity: null,
    targetTolerance: null,
    lockedIndex: null,
    lockedFraction: null,
    optimizationConstraints: null,
    blendViscosity: 10,
    costPerKg: 2,
    costPerTon: 2000,
    isoVG: { matchedGrade: 10, nearestGrade: 10 },
    ...overrides,
  } as RecipeDraft)
}

describe('JSON backup export/import', () => {
  it('exports a formatted backup with schema and model fields', () => {
    const recipe = forwardRecipe({ id: 'a', categoryConstraints: [{ category: 'PAO', minFraction: 0.5 }] })
    const json = serializeBackup([recipe], new Date('2026-08-26T00:00:00Z'))
    expect(json).toContain('"backupFormatVersion": 1')
    expect(json).toContain('"schemaVersion": 2')
    expect(json).toContain('"viscosityModel"')
    expect(json).toContain('"categoryConstraints"')
    expect(json).toContain('"category": "PAO"')
    const backup = buildBackup([recipe])
    expect(backup.recipes[0]).not.toBe(recipe)
    expect(backup.recipes[0].components[0]).not.toBe(recipe.components[0])
  })

  it('imports a valid backup and migrates V1 entries', () => {
    const v2 = forwardRecipe({ id: 'a' })
    const v1Raw = JSON.parse(serializeRecipe(v2)) as Record<string, unknown>
    v1Raw.schemaVersion = 1
    delete v1Raw.categoryConstraints
    ;(v1Raw.components as Array<Record<string, unknown>>)[0].category = undefined
    const parsed = parseBackup(JSON.stringify({ backupFormatVersion: 1, recipes: [v1Raw] }))
    expect(parsed.error).toBeUndefined()
    expect(parsed.recipes).toHaveLength(1)
    expect(parsed.migratedCount).toBe(1)
    expect(parsed.failedCount).toBe(0)
    expect(parsed.recipes[0].schemaVersion).toBe(2)
    expect(parsed.recipes[0].components[0].category).toBe('OTHER')
    expect(parsed.recipes[0].categoryConstraints).toEqual([])
  })

  it('rejects malformed and oversized backups without throwing', () => {
    expect(parseBackup('{bad json').error).toBeDefined()
    expect(parseBackup(JSON.stringify({ recipes: [] })).error).toBeDefined()
    const huge = 'x'.repeat(IMPORT_LIMITS.maxFileBytes + 1)
    expect(parseBackup(huge).error).toContain('大小')
  })

  it('handles partial imports and isolates failures', () => {
    const good = forwardRecipe({ id: 'good' })
    const bad = { ...JSON.parse(serializeRecipe(good)), blendViscosity: -5 }
    const tooLong = forwardRecipe({ id: 'long', name: '长'.repeat(IMPORT_LIMITS.maxNameLength + 1) })
    const parsed = parseBackup(JSON.stringify({ backupFormatVersion: 1, recipes: [
      JSON.parse(serializeRecipe(good)), bad, JSON.parse(serializeRecipe(tooLong)),
    ] }))
    expect(parsed.recipes.map((recipe) => recipe.id)).toEqual(['good'])
    expect(parsed.failedCount).toBe(2)
  })

  it('applies duplicate strategies with copy semantics by default', () => {
    const existing = forwardRecipe({ id: 'dup' })
    const incoming = forwardRecipe({ id: 'dup', name: '原始名', createdAt: '2020-01-01T00:00:00.000Z' })
    const now = new Date('2026-08-26T12:00:00Z')

    const skip = planImport({ recipes: [incoming], failedCount: 0 }, ['dup'], 'skip', now)
    expect(skip.skipped).toBe(1)
    expect(skip.toWrite).toHaveLength(0)

    const overwrite = planImport({ recipes: [incoming], failedCount: 0 }, ['dup'], 'overwrite', now)
    expect(overwrite.overwritten).toBe(1)
    expect(overwrite.toWrite[0]?.id).toBe('dup')

    const copy = planImport({ recipes: [incoming], failedCount: 0 }, ['dup'], 'duplicate', now)
    expect(copy.duplicated).toBe(1)
    expect(copy.toWrite[0]?.id).not.toBe('dup')
    expect(copy.toWrite[0]?.name).toBe('原始名（导入副本）')
    expect(copy.toWrite[0]?.createdAt).toBe('2020-01-01T00:00:00.000Z')
    expect(copy.toWrite[0]?.updatedAt).toBe(now.toISOString())

    const fresh = planImport({ recipes: [existing], failedCount: 0 }, [], 'duplicate', now)
    expect(fresh.imported).toBe(1)
    expect(fresh.toWrite[0]?.id).toBe(existing.id)
  })
})
