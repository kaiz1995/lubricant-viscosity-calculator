import type { BlendComponent, ValidationResult, ViscosityModel } from './types'
import { assertFractions, assertViscosity, finiteResult } from './validation'

export class SimplifiedWaltherModel implements ViscosityModel {
  readonly id = 'simplified-walther-single-temperature'

  private static readonly MIN_VISCOSITY = 0.3

  validateDomain(viscosity: number): ValidationResult {
    return Number.isFinite(viscosity) && viscosity > SimplifiedWaltherModel.MIN_VISCOSITY
      ? { valid: true }
      : { valid: false, message: '当前粘度模型要求运动粘度大于0.3 mm²/s。' }
  }

  // W(v) = log10(log10(v + 0.7)); written as log1p(v - 0.3) for stability.
  transformViscosity(viscosity: number): number {
    assertViscosity(this, viscosity, '运动粘度')
    // log1p 保留 v 接近模型下限时的有效精度。
    const inner = Math.log1p(viscosity - SimplifiedWaltherModel.MIN_VISCOSITY) / Math.LN10
    return finiteResult(Math.log(inner) / Math.LN10, '粘度变换结果')
  }

  inverseTransform(transformed: number): number {
    finiteResult(transformed, '粘度反变换输入')
    const inner = 10 ** transformed
    if (!Number.isFinite(inner) || inner <= 0) {
      throw new RangeError('粘度反变换结果超出当前模型可计算范围。')
    }
    const exponent = Math.LN10 * inner
    if (exponent > Math.log(Number.MAX_VALUE)) {
      throw new RangeError('粘度反变换结果超出当前模型可计算范围。')
    }
    const viscosity = Math.expm1(exponent) + SimplifiedWaltherModel.MIN_VISCOSITY
    if (!Number.isFinite(viscosity) || !this.validateDomain(viscosity).valid) {
      throw new RangeError('粘度反变换结果超出当前模型可计算范围。')
    }
    return viscosity
  }

  blendViscosity(components: readonly BlendComponent[]): number {
    assertFractions(components.map(({ fraction }) => fraction))
    const transformed = components.reduce((sum, component, index) => {
      assertViscosity(this, component.viscosity, `组分${index + 1}运动粘度`)
      return sum + component.fraction * this.transformViscosity(component.viscosity)
    }, 0)
    return this.inverseTransform(finiteResult(transformed, '调和粘度变换结果'))
  }
}
