export type DrawerTier = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const DRAWER_TIER_WIDTHS: Record<DrawerTier, string> = {
  sm: 'min(384px, calc(100vw - 2rem))',
  md: 'min(672px, calc(100vw - 2rem))',
  lg: 'min(896px, calc(100vw - 2rem))',
  xl: 'min(1152px, calc(100vw - 2rem))',
  full: 'min(90vw, calc(100vw - 2rem))',
}

export function getDrawerTierStyle(tier: DrawerTier) {
  const width = DRAWER_TIER_WIDTHS[tier]
  return {
    width,
    maxWidth: width,
  }
}