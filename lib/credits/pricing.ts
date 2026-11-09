const MARKUP = Number(process.env.CREDIT_MARKUP_MULTIPLIER ?? 5)
const CREDITS_PER_USD = Number(process.env.APP_CREDITS_PER_USD ?? 100)

export type FalActionType = 'generate_image' | 'extract_subject' | 'extract_describe' | 'orbit_scene'

const DEFAULT_FAL_COSTS: Record<FalActionType, number> = {
  generate_image: 0.15,
  extract_subject: 0.005,
  extract_describe: 0.005,
  orbit_scene: 0.02,
}

const ENV_KEYS: Record<FalActionType, string> = {
  generate_image: 'FAL_COST_GENERATE_IMAGE_USD',
  extract_subject: 'FAL_COST_EXTRACT_SUBJECT_USD',
  extract_describe: 'FAL_COST_EXTRACT_DESCRIBE_USD',
  orbit_scene: 'FAL_COST_SAM_3D_OBJECTS_USD',
}

export function quoteFalAction(action: FalActionType, count = 1) {
  const configured = Number(process.env[ENV_KEYS[action]])
  const unitFalUsd = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_FAL_COSTS[action]
  const falUsd = unitFalUsd * Math.max(1, Math.floor(count))
  return { falUsd, credits: Math.ceil(falUsd * MARKUP * CREDITS_PER_USD) }
}
