import { EPS, type ViscosityModel } from './types'

export class CalculationInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalculationInputError'
  }
}

export function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new CalculationInputError(`${label}必须是有限数值。`)
  }
}

export function assertFraction(value: number, label: string): void {
  assertFiniteNumber(value, label)
  if (value < 0 || value > 1) {
    throw new CalculationInputError(`${label}必须位于0到1之间。`)
  }
}

export function assertFractions(fractions: readonly number[]): void {
  if (fractions.length === 0) {
    throw new CalculationInputError('至少需要一个组分。')
  }
  fractions.forEach((fraction, index) => assertFraction(fraction, `组分${index + 1}比例`))
  const sum = fractions.reduce((total, fraction) => total + fraction, 0)
  if (Math.abs(sum - 1) > EPS * Math.max(1, fractions.length)) {
    throw new CalculationInputError('组分比例之和必须等于1。')
  }
}

export function assertViscosity(model: ViscosityModel, viscosity: number, label: string): void {
  const result = model.validateDomain(viscosity)
  if (!result.valid) {
    throw new CalculationInputError(`${label}：${result.message ?? '超出模型定义域。'}`)
  }
}

export function nearlyEqual(left: number, right: number, epsilon = EPS): boolean {
  return Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right))
}

export function finiteResult(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new CalculationInputError(`${label}超出可计算范围。`)
  }
  return value
}
