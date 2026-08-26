import packageJson from '../../package.json'
import {
  RECIPE_SCHEMA_VERSION,
  type IsoVGSnapshot,
  type OilComponent,
  type OptimizationConstraintSnapshot,
  type Recipe,
  type RecipeDraft,
  type RecipeMode,
} from './types'
import { isOilCategory, type CategoryConstraint } from './categories'

export type { RecipeDraft } from './types'

export const RECIPE_STORAGE_PREFIX = 'lubricant-recipe-v1:'

export interface RecipeStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface RecipeLoadResult {
  recipes: Recipe[]
  unreadableCount: number
}

export function defaultAppVersion(): string {
  return packageJson.version
}

function browserStorage(): RecipeStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function storageOrDefault(storage?: RecipeStorage): RecipeStorage | undefined {
  return storage ?? browserStorage()
}

function nowIso(): string {
  return new Date().toISOString()
}

function newId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID()
  return `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function fraction(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1
}

function nonNegativeFinite(value: unknown): value is number {
  return finite(value) && value >= 0
}

function validIsoVG(value: unknown): value is IsoVGSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (item.matchedGrade === null || nonNegativeFinite(item.matchedGrade)) && nonNegativeFinite(item.nearestGrade)
}

function validComponent(value: unknown): value is OilComponent {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.name !== 'string' || !finite(item.viscosity) || item.viscosity <= 0.3) return false
  if (item.category !== undefined && !isOilCategory(item.category)) return false
  if (item.fraction !== undefined && !fraction(item.fraction)) return false
  if (!(item.pricePerKg === null || nonNegativeFinite(item.pricePerKg))) return false
  if (item.minFraction !== undefined && !fraction(item.minFraction)) return false
  if (item.maxFraction !== undefined && !fraction(item.maxFraction)) return false
  if (item.minFraction !== undefined && item.maxFraction !== undefined && item.minFraction > item.maxFraction) return false
  return true
}

function validOptimizationConstraints(value: unknown): value is OptimizationConstraintSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (!['exact', 'range', 'tolerance'].includes(String(item.targetMode))) return false
  if (!finite(item.minViscosity) || item.minViscosity <= 0.3 || !finite(item.maxViscosity) || item.maxViscosity < item.minViscosity) return false
  const minFractions = item.minFractions
  const maxFractions = item.maxFractions
  if (!Array.isArray(minFractions) || minFractions.length !== 3 || !minFractions.every(fraction)) return false
  if (!Array.isArray(maxFractions) || maxFractions.length !== 3 || !maxFractions.every(fraction)) return false
  return minFractions.every((min, index) => min <= maxFractions[index])
}

function validCategoryConstraints(value: unknown): value is CategoryConstraint[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') return false
    const entry = item as Record<string, unknown>
    if (!isOilCategory(entry.category) || seen.has(entry.category)) return false
    seen.add(entry.category)
    if (entry.minFraction !== undefined && !fraction(entry.minFraction)) return false
    if (entry.maxFraction !== undefined && !fraction(entry.maxFraction)) return false
    if (entry.minFraction !== undefined && entry.maxFraction !== undefined && entry.minFraction > entry.maxFraction) return false
  }
  return true
}

function validModel(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return text(item.id) && (text(item.version) || finite(item.version))
}

function validMode(value: unknown): value is RecipeMode {
  return value === 'forward' || value === 'reverse' || value === 'optimize'
}

/** Returns false instead of throwing so one malformed local record cannot blank the app. */
export function isValidRecipe(value: unknown): value is Recipe {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (item.schemaVersion !== RECIPE_SCHEMA_VERSION || !text(item.id) || !text(item.name) || !text(item.createdAt) || !text(item.updatedAt)) return false
  if (!validCategoryConstraints(item.categoryConstraints)) return false
  if (!validMode(item.mode) || !text(item.appVersion) || !validModel(item.viscosityModel)) return false
  if (!Array.isArray(item.components) || item.components.length < 1 || !item.components.every(validComponent)) return false
  if ((item.mode === 'reverse' || item.mode === 'optimize') && item.components.length !== 3) return false
  if (!(item.targetViscosity === null || (finite(item.targetViscosity) && item.targetViscosity > 0.3))) return false
  if (!(item.targetTolerance === null || nonNegativeFinite(item.targetTolerance))) return false
  if (!(item.lockedIndex === null || item.lockedIndex === 0 || item.lockedIndex === 1 || item.lockedIndex === 2)) return false
  if (!(item.lockedFraction === null || fraction(item.lockedFraction))) return false
  if (!(item.optimizationConstraints === null || validOptimizationConstraints(item.optimizationConstraints))) return false
  if (!finite(item.blendViscosity) || item.blendViscosity <= 0.3) return false
  if (!(item.costPerKg === null || nonNegativeFinite(item.costPerKg))) return false
  if (!(item.costPerTon === null || nonNegativeFinite(item.costPerTon))) return false
  if (!validIsoVG(item.isoVG)) return false
  if (item.mode === 'reverse' && (item.lockedIndex === null || item.lockedFraction === null || item.targetViscosity === null)) return false
  if (item.mode === 'optimize' && (item.optimizationConstraints === null || item.targetViscosity === null)) return false
  return true
}

export function createRecipe(draft: RecipeDraft): Recipe {
  const timestamp = nowIso()
  const recipe: Recipe = {
    ...draft,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    id: draft.id ?? newId(),
    createdAt: draft.createdAt ?? timestamp,
    updatedAt: draft.updatedAt ?? timestamp,
  }
  if (!isValidRecipe(recipe)) throw new TypeError('配方数据不符合 schemaVersion=2。')
  return recipe
}

export function serializeRecipe(recipe: Recipe): string {
  if (!isValidRecipe(recipe)) throw new TypeError('配方数据不符合 schemaVersion=2。')
  return JSON.stringify(recipe)
}

export function deserializeRecipe(input: unknown): Recipe | null {
  try {
    const value = typeof input === 'string' ? JSON.parse(input) : input
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const migrated = record.schemaVersion === 1 ? migrateRecipeV1ToV2(record) : record
    return isValidRecipe(migrated) ? migrated : null
  } catch {
    return null
  }
}

/** V1 → V2：保留合法类别，其余归入 OTHER；类别约束默认为空数组。 */
export function migrateRecipeV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  const components = Array.isArray(raw.components)
    ? raw.components.map((component) => {
        const item = (component ?? {}) as Record<string, unknown>
        return { ...item, category: isOilCategory(item.category) ? item.category : 'OTHER' }
      })
    : raw.components
  return { ...raw, schemaVersion: RECIPE_SCHEMA_VERSION, components, categoryConstraints: [] }
}

function recipeKey(id: string): string {
  return `${RECIPE_STORAGE_PREFIX}${id}`
}

export function listRecipes(storage?: RecipeStorage): RecipeLoadResult {
  const source = storageOrDefault(storage)
  if (!source) return { recipes: [], unreadableCount: 0 }
  const recipes: Recipe[] = []
  let unreadableCount = 0
  let length: number
  try {
    length = source.length
  } catch {
    return { recipes: [], unreadableCount: 0 }
  }
  for (let index = 0; index < length; index += 1) {
    let key: string | null
    try {
      key = source.key(index)
    } catch {
      unreadableCount += 1
      continue
    }
    if (!key?.startsWith(RECIPE_STORAGE_PREFIX)) continue
    let raw: string | null
    try {
      raw = source.getItem(key)
    } catch {
      unreadableCount += 1
      continue
    }
    const recipe = deserializeRecipe(raw)
    if (recipe) recipes.push(recipe)
    else unreadableCount += 1
  }
  recipes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return { recipes, unreadableCount }
}

export const loadRecipes = listRecipes

export function getRecipe(id: string, storage?: RecipeStorage): Recipe | null {
  const source = storageOrDefault(storage)
  if (!source || !text(id)) return null
  return deserializeRecipe(source.getItem(recipeKey(id)))
}

export function saveRecipe(recipe: Recipe, storage?: RecipeStorage): Recipe {
  const source = storageOrDefault(storage)
  if (!source) throw new Error('当前环境无法使用 localStorage。')
  source.setItem(recipeKey(recipe.id), serializeRecipe(recipe))
  return recipe
}

export function deleteRecipe(id: string, storage?: RecipeStorage): boolean {
  const source = storageOrDefault(storage)
  if (!source || !text(id)) return false
  const existed = source.getItem(recipeKey(id)) !== null
  source.removeItem(recipeKey(id))
  return existed
}

export function renameRecipe(recipe: Recipe, name: string, updatedAt = nowIso()): Recipe {
  if (!text(name)) throw new TypeError('配方名称不能为空。')
  const renamed = { ...recipe, name: name.trim(), updatedAt }
  if (!isValidRecipe(renamed)) throw new TypeError('重命名后的配方数据无效。')
  return renamed
}

export function renameStoredRecipe(id: string, name: string, storage?: RecipeStorage): Recipe | null {
  const recipe = getRecipe(id, storage)
  if (!recipe) return null
  return saveRecipe(renameRecipe(recipe, name), storage)
}

export function duplicateRecipe(recipe: Recipe, name = `${recipe.name}（副本）`, timestamp = nowIso()): Recipe {
  const copy: Recipe = {
    ...recipe,
    id: newId(),
    name: name.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    components: recipe.components.map((component) => ({ ...component })),
    categoryConstraints: recipe.categoryConstraints.map((constraint) => ({ ...constraint })),
    optimizationConstraints: recipe.optimizationConstraints
      ? {
          ...recipe.optimizationConstraints,
          minFractions: [...recipe.optimizationConstraints.minFractions] as [number, number, number],
          maxFractions: [...recipe.optimizationConstraints.maxFractions] as [number, number, number],
        }
      : null,
    viscosityModel: { ...recipe.viscosityModel },
    isoVG: { ...recipe.isoVG },
  }
  if (!isValidRecipe(copy)) throw new TypeError('复制后的配方数据无效。')
  return copy
}

export function duplicateStoredRecipe(id: string, name?: string, storage?: RecipeStorage): Recipe | null {
  const recipe = getRecipe(id, storage)
  if (!recipe) return null
  return saveRecipe(duplicateRecipe(recipe, name), storage)
}

export function makeForwardComponent(input: Omit<OilComponent, 'pricePerKg'> & { pricePerKg?: number | null }): OilComponent {
  return { ...input, pricePerKg: input.pricePerKg ?? null }
}
