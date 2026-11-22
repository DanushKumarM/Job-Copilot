import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../hooks/useTheme';

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
  variant?: 'default' | 'raised' | 'interactive';
}

export const Card: React.FC<CardProps> = ({
  children,
  onPress,
  style,
  variant = 'default',
}) => {
  const { theme } = useTheme();

  const cardStyle = [
    styles.card,
    {
      backgroundColor: variant === 'raised' ? theme.colors.surfaceRaised : theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.lg,
    },
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        style={cardStyle}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{children}</View>;
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
});
