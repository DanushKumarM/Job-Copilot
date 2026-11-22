import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { AppTheme, createTheme } from '../theme';

type ThemeMode = 'system' | 'dark' | 'light';

interface ThemeContextType {
  theme: AppTheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');

  const isDark = mode === 'system' ? systemScheme === 'dark' || !systemScheme : mode === 'dark';
  const theme = createTheme(isDark);

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
};
