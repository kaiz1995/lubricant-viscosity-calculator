export const EPS = 1e-10

export interface ValidationResult {
  valid: boolean
  message?: string
}

export interface BlendComponent {
  viscosity: number
  fraction: number
}

export interface PricedBlendComponent extends BlendComponent {
  pricePerKg: number | null
}

export interface ViscosityModel {
  readonly id: string
  validateDomain(viscosity: number): ValidationResult
  transformViscosity(viscosity: number): number
  inverseTransform(transformed: number): number
  blendViscosity(components: readonly BlendComponent[]): number
}

export type CostResult =
  | {
      status: 'COMPLETE'
      costPerKg: number
      costPerTon: number
    }
  | {
      status: 'INCOMPLETE_PRICE_DATA'
      costPerKg: null
      costPerTon: null
    }

export interface FractionRange {
  min: number
  max: number
}

export interface ReverseBlendInput {
  /** 组分运动粘度，长度即组分数，至少 2 个。 */
  viscosities: readonly number[]
  targetViscosity: number
  /** 与 viscosities 等长；null 表示该组分比例待反求，数值表示已锁定比例（0～1）。 */
  lockedFractions: readonly (number | null)[]
}

/** 多解场景下某个待求组分的可行比例区间。 */
export interface PendingFractionRange {
  index: number
  min: number
  max: number
}

interface ReverseBlendBase {
  /** 待求组分的可行比例区间；仅在待求组分多于两个、可行域可枚举时给出。 */
  pendingRanges: PendingFractionRange[] | null
  /** 锁定比例固定后，剩余组分可调出的粘度范围。 */
  reachableViscosityRange: FractionRange | null
}

export type ReverseBlendResult =
  | (ReverseBlendBase & {
      status: 'SUCCESS'
      fractions: number[]
      blendViscosity: number
      /** true 表示解唯一；false 表示存在无穷多组解，fractions 为规则化参考解。 */
      unique: boolean
      /** 解的性质说明，供界面直接展示。 */
      note: string
    })
  | (ReverseBlendBase & {
      status: 'NO_SOLUTION' | 'INVALID_INPUT'
      message: string
    })

export interface OptimizationComponent {
  viscosity: number
  pricePerKg: number
  category?: string
  minFraction?: number
  maxFraction?: number
}

export type CategoryConstraintType = 'COMPONENT_MIN' | 'COMPONENT_MAX' | 'VISCOSITY_MIN' | 'VISCOSITY_MAX' | 'CATEGORY_MIN' | 'CATEGORY_MAX'

export interface CategoryConstraintSpec {
  category?: string
  minFraction?: number
  maxFraction?: number
}

export interface OptimizationInput {
  components: readonly [OptimizationComponent, OptimizationComponent, OptimizationComponent]
  minViscosity: number
  maxViscosity: number
  categoryConstraints?: readonly CategoryConstraintSpec[]
}

export interface ReachableViscosityRange {
  minimumReachableViscosity: number
  maximumReachableViscosity: number
}

export interface OptimizationDiagnostics {
  minFractionSum?: number
  maxFractionSum?: number
  reachableViscosityRange?: ReachableViscosityRange
  activeConstraintDetails?: Array<{ id: string; type: CategoryConstraintType; label: string }>
}

export type OptimizationErrorCode =
  | 'INVALID_INPUT'
  | 'INFEASIBLE_FRACTION_BOUNDS'
  | 'TARGET_OUT_OF_REACH'
  | 'CATEGORY_MIN_CONFLICT'
  | 'CATEGORY_MAX_CONFLICT'
  | 'COMPONENT_CONSTRAINT_CONFLICT'
  | 'VISCOSITY_CONSTRAINT_CONFLICT'
  | 'NO_FEASIBLE_SOLUTION'

export type OptimizationResult =
  | {
      success: true
      fractions: [number, number, number]
      blendViscosity: number
      costPerKg: number
      costPerTon: number
      activeConstraints: string[]
      candidateCount: number
      diagnostics: OptimizationDiagnostics
    }
  | {
      success: false
      errorCode: OptimizationErrorCode
      message: string
      diagnostics: OptimizationDiagnostics
    }

export interface IsoVGMatch {
  matchedGrade: number | null
  nearestGrade: number
}
