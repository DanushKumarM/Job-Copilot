import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../hooks/useTheme';

export interface LoadingStateProps {
  count?: number;
  message?: string;
  style?: any;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ count = 3, style }) => {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <ActivityIndicator size="large" color={theme.colors.primary} style={styles.spinner} />
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.skeletonCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
            },
          ]}
        >
          <View style={[styles.skeletonLine, { backgroundColor: theme.colors.surfaceRaised, width: '60%', height: 16 }]} />
          <View style={[styles.skeletonLine, { backgroundColor: theme.colors.surfaceRaised, width: '40%', height: 12, marginTop: 8 }]} />
          <View style={[styles.skeletonLine, { backgroundColor: theme.colors.surfaceRaised, width: '85%', height: 12, marginTop: 14 }]} />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  spinner: {
    marginVertical: 16,
  },
  skeletonCard: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  skeletonLine: {
    borderRadius: 4,
  },
});
