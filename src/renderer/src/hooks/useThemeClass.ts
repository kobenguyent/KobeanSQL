import { useAppStore } from '../store'
import { useIsLightTheme } from './useIsLightTheme'

const THEME_CLASS: Record<string, string> = { 
  matrix: 'theme-matrix', 
  cyberpunk: 'theme-cyberpunk' 
}

export function useThemeClass(): string {
  const theme = useAppStore((s) => s.theme)
  const isLightTheme = useIsLightTheme()
  
  if (isLightTheme) return 'theme-light'
  return THEME_CLASS[theme] || ''
}
