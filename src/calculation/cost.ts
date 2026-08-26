import type { CostResult, PricedBlendComponent } from './types'
import { assertFiniteNumber, assertFractions } from './validation'

export function calculateCost(components: readonly PricedBlendComponent[]): CostResult {
  assertFractions(components.map(({ fraction }) => fraction))

  for (const [index, component] of components.entries()) {
    if (component.pricePerKg === null) continue
    assertFiniteNumber(component.pricePerKg, `组分${index + 1}价格`)
    if (component.pricePerKg < 0) throw new RangeError('价格不能小于0。')
  }

  if (components.some(({ pricePerKg }) => pricePerKg === null)) {
    return { status: 'INCOMPLETE_PRICE_DATA', costPerKg: null, costPerTon: null }
  }

  const costPerKg = components.reduce(
    (total, component) => total + component.fraction * component.pricePerKg!,
    0,
  )
  const costPerTon = costPerKg * 1000
  if (!Number.isFinite(costPerKg) || !Number.isFinite(costPerTon)) {
    throw new RangeError('成本结果超出可计算范围。')
  }
  return { status: 'COMPLETE', costPerKg, costPerTon }
}
