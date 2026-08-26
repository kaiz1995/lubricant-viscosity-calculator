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
  viscosities: readonly [number, number, number]
  targetViscosity: number
  lockedIndex: 0 | 1 | 2
  lockedFraction: number
}

interface ReverseBlendBase {
  feasibleLockedFractionRange: FractionRange | null
}

export type ReverseBlendResult =
  | (ReverseBlendBase & {
      status: 'SUCCESS'
      fractions: [number, number, number]
      blendViscosity: number
    })
  | (ReverseBlendBase & {
      status: 'NO_SOLUTION' | 'INFINITE_SOLUTIONS' | 'INVALID_INPUT'
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
