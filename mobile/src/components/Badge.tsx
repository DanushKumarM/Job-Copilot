import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';

export interface BadgeProps {
  label: string;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  style?: any;
}

export const Badge: React.FC<BadgeProps> = ({ label, variant = 'neutral', style }) => {
  const { theme } = useTheme();

  const getColors = () => {
    switch (variant) {
      case 'primary':
        return { bg: theme.colors.primaryMuted, text: theme.colors.primaryLight, border: theme.colors.primary };
      case 'success':
        return { bg: theme.colors.successMuted, text: theme.colors.success, border: theme.colors.success };
      case 'warning':
        return { bg: theme.colors.warningMuted, text: theme.colors.warning, border: theme.colors.warning };
      case 'danger':
        return { bg: theme.colors.dangerMuted, text: theme.colors.danger, border: theme.colors.danger };
      default:
        return { bg: theme.colors.badgeBg, text: theme.colors.textMuted, border: theme.colors.border };
    }
  };

  const colors = getColors();

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }, style]}>
      <Text style={[styles.text, { color: colors.text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.5,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
