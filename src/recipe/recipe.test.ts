import { describe, expect, it } from 'vitest'
import {
  buildCsvFileName,
  calculateCostSaving,
  compareRecipes,
  createRecipe,
  deserializeRecipe,
  duplicateStoredRecipe,
  listRecipes,
  percentagePointChange,
  recipeToCsv,
  renameStoredRecipe,
  saveRecipe,
  type Recipe,
  type RecipeDraft,
  type RecipeStorage,
} from './index'

class MemoryStorage implements RecipeStorage {
  private readonly data = new Map<string, string>()
  get length() { return this.data.size }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
}

class ThrowingStorage extends MemoryStorage {
  constructor(private readonly badKey: boolean, private readonly badGet: boolean, private readonly badLength: boolean) {
    super()
  }
  override get length() {
    if (this.badLength) throw new Error('length unavailable')
    return super.length
  }
  override key(index: number) {
    if (this.badKey && index === 1) throw new Error('key unavailable')
    return super.key(index)
  }
  override getItem(key: string) {
    if (this.badGet && key.endsWith(':bad-get')) throw new Error('get unavailable')
    return super.getItem(key)
  }
}

function forwardRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return createRecipe({
    name: '基础方案',
    mode: 'forward',
    appVersion: '0.1.0',
    viscosityModel: { id: 'simplified-walther', version: 1 },
    components: [
      { id: 'pao', name: 'PAO,\n6"', category: 'PAO', viscosity: 10, fraction: 0.8, pricePerKg: 2 },
      { id: 'ester', name: 'Ester', category: 'ESTER', viscosity: 50, fraction: 0.2, pricePerKg: 4 },
    ],
    targetViscosity: null,
    targetTolerance: null,
    lockedIndex: null,
    lockedFraction: null,
    optimizationConstraints: null,
    categoryConstraints: [],
    blendViscosity: 20,
    costPerKg: 2.4,
    costPerTon: 2400,
    isoVG: { matchedGrade: 22, nearestGrade: 22 },
    ...overrides,
  } as RecipeDraft)
}

describe('recipe storage and schema', () => {
  it('rejects malformed JSON, old schema, missing fields and non-finite values', () => {
    const recipe = forwardRecipe()
    expect(deserializeRecipe('{bad json')).toBeNull()
    expect(deserializeRecipe({ ...recipe, schemaVersion: 0 })).toBeNull()
    const { name: _name, ...missing } = recipe
    expect(deserializeRecipe(missing)).toBeNull()
    expect(deserializeRecipe({ ...recipe, blendViscosity: Number.NaN })).toBeNull()
  })

  it('isolates bad records and reports unreadableCount', () => {
    const storage = new MemoryStorage()
    const recipe = forwardRecipe({ id: 'good' })
    saveRecipe(recipe, storage)
    storage.setItem('lubricant-recipe-v1:bad-json', '{bad')
    storage.setItem('lubricant-recipe-v1:old', JSON.stringify({ ...recipe, schemaVersion: 0 }))
    const result = listRecipes(storage)
    expect(result.recipes.map(({ id }) => id)).toEqual(['good'])
    expect(result.unreadableCount).toBe(2)
  })

  it('continues when one storage key/getItem throws, and tolerates length failure', () => {
    const storage = new ThrowingStorage(true, true, false)
    saveRecipe(forwardRecipe({ id: 'good' }), storage)
    storage.setItem('lubricant-recipe-v1:bad-get', JSON.stringify(forwardRecipe({ id: 'bad-get' })))
    const result = listRecipes(storage)
    expect(result.recipes.map(({ id }) => id)).toEqual(['good'])
    expect(result.unreadableCount).toBe(1)
    const getStorage = new ThrowingStorage(false, true, false)
    saveRecipe(forwardRecipe({ id: 'good' }), getStorage)
    getStorage.setItem('lubricant-recipe-v1:bad-get', JSON.stringify(forwardRecipe({ id: 'bad-get' })))
    expect(listRecipes(getStorage).unreadableCount).toBe(1)
    expect(listRecipes(new ThrowingStorage(false, false, true))).toEqual({ recipes: [], unreadableCount: 0 })
  })

  it('supports rename, duplicate and independent delete', () => {
    const storage = new MemoryStorage()
    saveRecipe(forwardRecipe({ id: 'original' }), storage)
    const renamed = renameStoredRecipe('original', '新名称', storage)
    expect(renamed?.name).toBe('新名称')
    const copy = duplicateStoredRecipe('original', '副本', storage)
    expect(copy?.id).not.toBe('original')
    expect(copy?.name).toBe('副本')
    expect(listRecipes(storage).recipes).toHaveLength(2)
  })
})

describe('recipe comparison', () => {
  it('calculates absolute/percent/ton savings and percentage points', () => {
    const saving = calculateCostSaving(37.05, 29.85)
    expect(saving.calculable).toBe(true)
    expect(saving.absoluteCostSaving).toBeCloseTo(7.2, 10)
    expect(saving.costSavingPercent).toBeCloseTo(19.433, 3)
    expect(saving.costSavingPerTon).toBeCloseTo(7200, 10)
    expect(calculateCostSaving(0, 2).calculable).toBe(false)
    expect(calculateCostSaving(null, 2).costSavingPercent).toBeNull()
    expect(percentagePointChange(0.82, 0.6)).toBeCloseTo(-22, 10)
  })

  it('builds an ID/name union and category totals for 2 to 4 plans', () => {
    const baseline = forwardRecipe({ id: 'base', costPerKg: 37.05, components: [{ id: 'pao', name: 'PAO', category: 'PAO', viscosity: 10, fraction: 0.82, pricePerKg: 2 }] })
    const candidate = forwardRecipe({ id: 'candidate', costPerKg: 29.85, components: [{ id: 'pao', name: 'PAO', category: 'PAO', viscosity: 10, fraction: 0.6, pricePerKg: 2 }, { id: '', name: 'AN', category: 'AN', viscosity: 50, fraction: 0.4, pricePerKg: 3 }] })
    const result = compareRecipes([baseline, candidate], 'base')
    expect(result.componentRows.map(({ label }) => label)).toEqual(['PAO', 'AN'])
    expect(result.componentRows[0].percentagePointChanges[1]).toBeCloseTo(-22, 10)
    expect(result.componentRows[1].fractions).toEqual([0, 0.4])
    expect(result.componentRows[1].percentagePointChanges[1]).toBeCloseTo(40, 10)
    expect(result.categorySummary.PAO).toEqual([0.82, 0.6])
    expect(result.savings.candidate.absoluteCostSaving).toBeCloseTo(7.2, 10)
    const candidateMissing = forwardRecipe({ id: 'candidate-missing', components: [{ id: '', name: 'AN', category: 'AN', viscosity: 50, fraction: 1, pricePerKg: 3 }] })
    const missingResult = compareRecipes([baseline, candidateMissing], 'base')
    expect(missingResult.componentRows.find(({ label }) => label === 'PAO')?.fractions).toEqual([0.82, 0])
    expect(missingResult.componentRows.find(({ label }) => label === 'PAO')?.percentagePointChanges[1]).toBeCloseTo(-82, 10)
  })
})

describe('CSV export', () => {
  it('contains UTF-8 BOM, Chinese fields, disclaimer and escaped cells', () => {
    const recipe = forwardRecipe({ name: '方案/一："测试"' })
    const csv = recipeToCsv(recipe)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('配方名称')
    expect(csv).toContain('本结果采用单温度 Walther 型粘度调和模型')
    expect(csv).toContain('"PAO,\n6"""')
    expect(buildCsvFileName(recipe)).not.toMatch(/[<>:"/\\|?*]/)
    expect(buildCsvFileName(recipe).endsWith('.csv')).toBe(true)
  })
})
