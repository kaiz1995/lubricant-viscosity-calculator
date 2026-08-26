import { normalizeCategory, type OilCategory } from './categories'
import type { Recipe } from './types'

export interface CostSaving {
  calculable: boolean
  absoluteCostSaving: number | null
  costSavingPercent: number | null
  costSavingPerTon: number | null
}

export interface ComparisonMetric {
  key: 'blendViscosity' | 'isoVG' | 'costPerKg' | 'costPerTon' | 'componentCount'
  label: string
  values: Array<number | string | null>
}

export interface ComparisonComponentRow {
  key: string
  label: string
  category?: string
  fractions: number[]
  percentagePointChanges: Array<number | null>
}

export interface ComparisonResult {
  recipes: Recipe[]
  baselineId: string
  metrics: ComparisonMetric[]
  componentRows: ComparisonComponentRow[]
  categorySummary: Record<string, number[]>
  savings: Record<string, CostSaving>
}

export function calculateCostSaving(baselineCost: number | null, candidateCost: number | null): CostSaving {
  if (baselineCost === null || candidateCost === null || !Number.isFinite(baselineCost) || !Number.isFinite(candidateCost) || baselineCost <= 0) {
    return { calculable: false, absoluteCostSaving: null, costSavingPercent: null, costSavingPerTon: null }
  }
  const absoluteCostSaving = baselineCost - candidateCost
  return {
    calculable: true,
    absoluteCostSaving,
    costSavingPercent: absoluteCostSaving / baselineCost * 100,
    costSavingPerTon: absoluteCostSaving * 1000,
  }
}

/** Returns candidate minus baseline in percentage points, for fractions in 0..1. */
export function percentagePointChange(baselineFraction: number | null, candidateFraction: number | null): number | null {
  if (baselineFraction === null || candidateFraction === null || !Number.isFinite(baselineFraction) || !Number.isFinite(candidateFraction)) return null
  return (candidateFraction - baselineFraction) * 100
}

function componentKey(id: string, name: string): string {
  const stableId = id.trim()
  return stableId ? `id:${stableId}` : `name:${name.trim().toLocaleLowerCase()}`
}

function componentFraction(recipe: Recipe, key: string): number {
  return recipe.components.reduce((total, component) => {
    if (componentKey(component.id, component.name) !== key) return total
    const value = component.fraction ?? 0
    return total + value
  }, 0)
}

export function summarizeCategories(recipe: Recipe): Record<string, number> {
  return recipe.components.reduce<Record<string, number>>((summary, component) => {
    const category: OilCategory = normalizeCategory(component.category)
    summary[category] = (summary[category] ?? 0) + (component.fraction ?? 0)
    return summary
  }, {})
}

export function compareRecipes(input: readonly Recipe[], baselineId = input[0]?.id): ComparisonResult {
  if (input.length < 2 || input.length > 4) throw new RangeError('方案对比必须选择2到4个方案。')
  const recipes = input.map((recipe) => recipe)
  const baseline = recipes.find((recipe) => recipe.id === baselineId)
  if (!baseline) throw new RangeError('基准方案必须来自已选择的方案。')

  const keyOrder: string[] = []
  const labels = new Map<string, { label: string; category?: string }>()
  recipes.forEach((recipe) => recipe.components.forEach((component) => {
    const key = componentKey(component.id, component.name)
    if (!labels.has(key)) keyOrder.push(key)
    if (!labels.has(key) || labels.get(key)?.label === '') labels.set(key, { label: component.name || component.id, category: component.category })
  }))

  const componentRows = keyOrder.map((key) => {
    const fractions = recipes.map((recipe) => componentFraction(recipe, key))
    const baselineFraction = fractions[recipes.indexOf(baseline)] ?? 0
    return {
      key,
      label: labels.get(key)?.label ?? key.replace(/^(id:|name:)/, ''),
      category: labels.get(key)?.category,
      fractions,
      percentagePointChanges: fractions.map((fraction) => percentagePointChange(baselineFraction, fraction)),
    }
  })

  const metrics: ComparisonMetric[] = [
    { key: 'blendViscosity', label: '预计 KV40', values: recipes.map((recipe) => recipe.blendViscosity) },
    { key: 'isoVG', label: 'ISO VG', values: recipes.map((recipe) => recipe.isoVG.matchedGrade ?? `非标准（近 VG ${recipe.isoVG.nearestGrade}）`) },
    { key: 'costPerKg', label: '成本/kg', values: recipes.map((recipe) => recipe.costPerKg) },
    { key: 'costPerTon', label: '成本/t', values: recipes.map((recipe) => recipe.costPerTon) },
    { key: 'componentCount', label: '组分数量', values: recipes.map((recipe) => recipe.components.length) },
  ]

  const baselineIndex = recipes.indexOf(baseline)
  const baselineCategories = recipes.map(summarizeCategories)
  const categoryNames = new Set<string>()
  baselineCategories.forEach((summary) => Object.keys(summary).forEach((category) => categoryNames.add(category)))
  const categorySummary = Object.fromEntries([...categoryNames].map((category) => [category, baselineCategories.map((summary) => summary[category] ?? 0)]))
  const savings = Object.fromEntries(recipes.map((recipe, index) => [
    recipe.id,
    index === baselineIndex ? calculateCostSaving(baseline.costPerKg, baseline.costPerKg) : calculateCostSaving(baseline.costPerKg, recipe.costPerKg),
  ]))

  return { recipes, baselineId: baseline.id, metrics, componentRows, categorySummary, savings }
}
