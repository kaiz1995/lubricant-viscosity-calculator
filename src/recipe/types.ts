import type { CategoryConstraint } from './categories'

export const RECIPE_SCHEMA_VERSION = 2 as const

export type RecipeMode = 'forward' | 'reverse' | 'optimize'
export type TargetMode = 'exact' | 'range' | 'tolerance'

export interface ViscosityModelSnapshot {
  id: string
  version: number | string
}

export interface IsoVGSnapshot {
  matchedGrade: number | null
  nearestGrade: number
}

export interface OilComponent {
  id: string
  name: string
  viscosity: number
  category?: string
  fraction?: number
  pricePerKg: number | null
  minFraction?: number
  maxFraction?: number
}

export interface OptimizationConstraintSnapshot {
  targetMode: TargetMode
  minViscosity: number
  maxViscosity: number
  minFractions: [number, number, number]
  maxFractions: [number, number, number]
}

/** A complete, serializable input and result snapshot for one calculation. */
export interface Recipe {
  schemaVersion: typeof RECIPE_SCHEMA_VERSION
  id: string
  name: string
  createdAt: string
  updatedAt: string
  mode: RecipeMode
  appVersion: string
  viscosityModel: ViscosityModelSnapshot
  components: OilComponent[]
  categoryConstraints: CategoryConstraint[]
  targetViscosity: number | null
  targetTolerance: number | null
  lockedIndex: 0 | 1 | 2 | null
  lockedFraction: number | null
  optimizationConstraints: OptimizationConstraintSnapshot | null
  blendViscosity: number
  costPerKg: number | null
  costPerTon: number | null
  isoVG: IsoVGSnapshot
}

export type RecipeDraft = Omit<Recipe, 'schemaVersion' | 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
  createdAt?: string
  updatedAt?: string
}
