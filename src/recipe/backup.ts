import { deserializeRecipe, defaultAppVersion } from './storage'
import type { Recipe } from './types'

export interface RecipeBackup {
  backupFormatVersion: 1
  exportedAt: string
  appVersion: string
  recipes: Recipe[]
}

export const IMPORT_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxRecipes: 1000,
  maxComponentsPerRecipe: 100,
  maxNameLength: 200,
} as const

export interface ParsedBackup {
  recipes: Recipe[]
  failedCount: number
  migratedCount: number
  error?: string
}

/** 导出为独立备份结构，不直接输出 localStorage 原始键值。 */
export function buildBackup(recipes: readonly Recipe[], now = new Date()): RecipeBackup {
  return {
    backupFormatVersion: 1,
    exportedAt: now.toISOString(),
    appVersion: defaultAppVersion(),
    recipes: recipes.map((recipe) => ({
      ...recipe,
      components: recipe.components.map((component) => ({ ...component })),
      categoryConstraints: recipe.categoryConstraints.map((constraint) => ({ ...constraint })),
      viscosityModel: { ...recipe.viscosityModel },
      isoVG: { ...recipe.isoVG },
    })),
  }
}

function backupToJson(backup: RecipeBackup): string {
  return JSON.stringify(backup, null, 2)
}

export function serializeBackup(recipes: readonly Recipe[], now = new Date()): string {
  return backupToJson(buildBackup(recipes, now))
}

function countComponents(value: unknown): number {
  return Array.isArray((value as { components?: unknown[] }).components) ? (value as { components: unknown[] }).components.length : 0
}

/** 导入文件是不可信输入：先做文件级限制，再逐条隔离解析（内部完成 V1→V2 迁移）。 */
export function parseBackup(jsonText: string, limits: typeof IMPORT_LIMITS = IMPORT_LIMITS): ParsedBackup {
  if (new TextEncoder().encode(jsonText).length > limits.maxFileBytes) {
    return { recipes: [], failedCount: 0, migratedCount: 0, error: '文件超过大小限制（5 MB）。' }
  }
  let value: unknown
  try {
    value = JSON.parse(jsonText)
  } catch {
    return { recipes: [], failedCount: 0, migratedCount: 0, error: '文件不是有效的 JSON。' }
  }
  const backup = value as Record<string, unknown>
  if (!backup || backup.backupFormatVersion !== 1 || !Array.isArray(backup.recipes)) {
    return { recipes: [], failedCount: 0, migratedCount: 0, error: '备份格式不受支持，缺少 backupFormatVersion=1 或配方列表。' }
  }
  if (backup.recipes.length > limits.maxRecipes) {
    return { recipes: [], failedCount: backup.recipes.length, migratedCount: 0, error: '备份数量超过上限（1000 个）。' }
  }
  let migratedCount = 0
  let failedCount = 0
  const recipes: Recipe[] = []
  for (const item of backup.recipes) {
    const rawName = (item as { name?: unknown })?.name
    const nameValid = typeof rawName === 'string' && rawName.trim().length > 0 && rawName.length <= limits.maxNameLength
    const componentsValid = countComponents(item) <= limits.maxComponentsPerRecipe
    const wasV1 = (item as { schemaVersion?: unknown })?.schemaVersion === 1
    const recipe = nameValid && componentsValid ? deserializeRecipe(item) : null
    if (recipe) {
      recipes.push(recipe)
      if (wasV1) migratedCount += 1
    } else {
      failedCount += 1
    }
  }
  return { recipes, failedCount, migratedCount }
}

export type ImportConflictStrategy = 'skip' | 'duplicate' | 'overwrite'

export interface ImportPlanReport {
  toWrite: Recipe[]
  imported: number
  duplicated: number
  skipped: number
  overwritten: number
  failed: number
}

function newId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID()
  return 'recipe-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
}

/** 纯函数：不写存储，只决定每条配方的去向。默认策略为创建副本。 */
export function planImport(
  parsed: Pick<ParsedBackup, 'recipes'> & Partial<Pick<ParsedBackup, 'failedCount'>>,
  existingIds: Iterable<string>,
  strategy: ImportConflictStrategy = 'duplicate',
  now = new Date(),
): ImportPlanReport {
  const existing = new Set(existingIds)
  const report: ImportPlanReport = { toWrite: [], imported: 0, duplicated: 0, skipped: 0, overwritten: 0, failed: parsed.failedCount ?? 0 }
  for (const recipe of parsed.recipes) {
    if (!existing.has(recipe.id)) {
      report.toWrite.push(recipe)
      report.imported += 1
      existing.add(recipe.id)
      continue
    }
    if (strategy === 'skip') {
      report.skipped += 1
    } else if (strategy === 'overwrite') {
      report.toWrite.push(recipe)
      report.overwritten += 1
    } else {
      const timestamp = now.toISOString()
      report.toWrite.push({
        ...recipe,
        id: newId(),
        name: recipe.name + '（导入副本）',
        createdAt: recipe.createdAt,
        updatedAt: timestamp,
        components: recipe.components.map((component) => ({ ...component })),
        categoryConstraints: recipe.categoryConstraints.map((constraint) => ({ ...constraint })),
      })
      report.duplicated += 1
    }
  }
  return report
}
