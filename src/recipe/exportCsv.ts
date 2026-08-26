import type { Recipe, RecipeMode } from './types'

export const RECIPE_EXPORT_DISCLAIMER = '本结果采用单温度 Walther 型粘度调和模型进行理论预测，用于配方设计参考。实际运动粘度应以实验检测结果为准。'

function modeLabel(mode: RecipeMode): string {
  return mode === 'forward' ? '配比→粘度' : mode === 'reverse' ? '目标粘度→配比' : '最低成本优化'
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function recipeToCsv(recipe: Recipe): string {
  const rows: unknown[][] = [
    ['配方名称', recipe.name],
    ['日期', recipe.updatedAt],
    ['计算模式', modeLabel(recipe.mode)],
    ['粘度模型', `${recipe.viscosityModel.id} v${recipe.viscosityModel.version}`],
    ['目标KV40', recipe.targetViscosity],
    ['目标容差', recipe.targetTolerance],
    ['预计KV40', recipe.blendViscosity],
    ['ISO VG', recipe.isoVG.matchedGrade === null ? `非标准 VG（最接近 VG ${recipe.isoVG.nearestGrade}）` : `ISO VG ${recipe.isoVG.matchedGrade}`],
    ['成本/kg', recipe.costPerKg],
    ['成本/t', recipe.costPerTon],
    [],
    ['原料名称', 'KV40', '比例 wt%', '单价 元/kg', '成本贡献 元/kg', '类别'],
    ...recipe.components.map((component) => [
      component.name,
      component.viscosity,
      component.fraction === undefined ? null : component.fraction * 100,
      component.pricePerKg,
      component.fraction === undefined || component.pricePerKg === null ? null : component.fraction * component.pricePerKg,
      component.category ?? null,
    ]),
    [],
    ['计算说明', RECIPE_EXPORT_DISCLAIMER],
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

export const exportRecipeCsv = recipeToCsv

export function safeCsvFileName(name: string, fallback = '润滑油配方'): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100)
  const value = cleaned || fallback
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(value) ? `_${value}` : value
}

export function buildCsvFileName(recipe: Recipe): string {
  const date = recipe.updatedAt.slice(0, 10).replace(/[^0-9-]/g, '-')
  return `${safeCsvFileName(recipe.name)}-${date || '未定日期'}.csv`
}
