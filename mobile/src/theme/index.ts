import { darkColors, lightColors, ThemeColors } from './colors';
import { radius, spacing } from './spacing';
import { typography } from './typography';

export { darkColors, lightColors, radius, spacing, typography };
export type { ThemeColors };

export interface AppTheme {
  isDark: boolean;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

export const createTheme = (isDark: boolean): AppTheme => ({
  isDark,
  colors: isDark ? darkColors : lightColors,
  spacing,
  radius,
  typography,
});
