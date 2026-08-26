import type { BlendComponent, ViscosityModel } from './types'

export function blendViscosity(
  model: ViscosityModel,
  components: readonly BlendComponent[],
): number {
  return model.blendViscosity(components)
}
