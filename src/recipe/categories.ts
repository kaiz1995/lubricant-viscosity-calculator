export type OilCategory =
  | 'PAO'
  | 'GTL'
  | 'CTL'
  | 'AN'
  | 'ESTER'
  | 'MINERAL'
  | 'ADDITIVE'
  | 'OTHER'

export const OIL_CATEGORIES: readonly OilCategory[] = [
  'PAO',
  'GTL',
  'CTL',
  'AN',
  'ESTER',
  'MINERAL',
  'ADDITIVE',
  'OTHER',
] as const

export const CATEGORY_LABELS: Record<OilCategory, string> = {
  PAO: 'PAO',
  GTL: 'GTL',
  CTL: 'CTL',
  AN: '烷基萘',
  ESTER: '合成酯',
  MINERAL: '矿物油',
  ADDITIVE: '添加剂',
  OTHER: '其他',
}

export function isOilCategory(value: unknown): value is OilCategory {
  return typeof value === 'string' && (OIL_CATEGORIES as readonly string[]).includes(value)
}

/** 非法或缺失类别统一归入 OTHER，不通过原料名称猜测。 */
export function normalizeCategory(value: unknown): OilCategory {
  return isOilCategory(value) ? value : 'OTHER'
}

export interface CategoryConstraint {
  category: OilCategory
  minFraction?: number
  maxFraction?: number
}

interface CategorizableComponent {
  fraction?: number
  minFraction?: number
  maxFraction?: number
  category?: string
}

const EPS = 1e-10

export function aggregateFractionsByCategory(
  components: readonly CategorizableComponent[],
): Record<OilCategory, number> {
  const summary = Object.fromEntries(OIL_CATEGORIES.map((category) => [category, 0])) as Record<OilCategory, number>
  for (const component of components) {
    summary[normalizeCategory(component.category)] += component.fraction ?? 0
  }
  return summary
}

export type CategoryValidationErrorCode =
  | 'INVALID_RANGE'
  | 'DUPLICATE_CATEGORY'
  | 'CATEGORY_MIN_INFEASIBLE'
  | 'CATEGORY_MAX_INFEASIBLE'
  | 'TOTAL_MIN_CONFLICT'

export interface CategoryValidationError {
  code: CategoryValidationErrorCode
  category?: OilCategory
  message: string
}

export interface CategoryValidationResult {
  valid: boolean
  errors: CategoryValidationError[]
}

function formatPercent(value: number): string {
  return Number((value * 100).toFixed(2)) + '%'
}

function label(category: OilCategory): string {
  return CATEGORY_LABELS[category]
}

/** 结构化预校验：数值范围、重复类别，以及该类别原料自身上下限合计能否满足类别约束。每个原料只属于一个类别，因此各类别最低值之和超过100%即冲突。 */
export interface CategoryConstraintInput {
  category?: unknown
  minFraction?: number
  maxFraction?: number
}

export function validateCategoryConstraints(
  constraints: readonly CategoryConstraintInput[],
  components: readonly CategorizableComponent[],
): CategoryValidationResult {
  const errors: CategoryValidationError[] = []
  const seen = new Set<OilCategory>()
  let totalMinFraction = 0
  for (const constraint of constraints) {
    const category = normalizeCategory(constraint.category)
    const { minFraction, maxFraction } = constraint
    if (seen.has(category)) {
      errors.push({ code: 'DUPLICATE_CATEGORY', category, message: label(category) + '存在重复的类别约束。' })
      continue
    }
    seen.add(category)
    if (
      (minFraction !== undefined && (minFraction < 0 || minFraction > 1)) ||
      (maxFraction !== undefined && (maxFraction < 0 || maxFraction > 1)) ||
      (minFraction !== undefined && maxFraction !== undefined && minFraction > maxFraction)
    ) {
      errors.push({ code: 'INVALID_RANGE', category, message: label(category) + '约束的比例范围无效。' })
      continue
    }
    if (minFraction !== undefined) {
      totalMinFraction += minFraction
      const maxTotal = components.reduce(
        (total, component) => (normalizeCategory(component.category) === category ? total + (component.maxFraction ?? 1) : total),
        0,
      )
      if (minFraction > maxTotal + EPS) {
        errors.push({
          code: 'CATEGORY_MIN_INFEASIBLE',
          category,
          message: label(category) + '类别最低要求为' + formatPercent(minFraction) + '，但当前' + label(category) + '原料允许的最大总比例仅为' + formatPercent(maxTotal) + '。',
        })
      }
    }
    if (maxFraction !== undefined) {
      const minTotal = components.reduce(
        (total, component) => (normalizeCategory(component.category) === category ? total + (component.minFraction ?? 0) : total),
        0,
      )
      if (minTotal > maxFraction + EPS) {
        errors.push({
          code: 'CATEGORY_MAX_INFEASIBLE',
          category,
          message: label(category) + '类别最高限制为' + formatPercent(maxFraction) + '，但当前' + label(category) + '原料的最小总比例已达' + formatPercent(minTotal) + '。',
        })
      }
    }
  }
  if (totalMinFraction > 1 + EPS) {
    errors.push({ code: 'TOTAL_MIN_CONFLICT', message: '各类别最低比例之和不能超过100%。' })
  }
  return { valid: errors.length === 0, errors }
}
