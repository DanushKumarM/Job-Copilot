import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  issues?: string[];
  onRetry?: () => void;
  style?: any;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message = 'An unexpected error occurred while communicating with the server.',
  issues,
  onRetry,
  style,
}) => {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.iconCircle, { backgroundColor: theme.colors.dangerMuted }]}>
        <Ionicons name="alert-circle" size={36} color={theme.colors.danger} />
      </View>
      <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[styles.message, { color: theme.colors.textMuted }]}>{message}</Text>
      {issues && issues.length > 0 && (
        <View style={[styles.issuesContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.issuesTitle, { color: theme.colors.warning }]}>Issues found:</Text>
          {issues.map((issue, idx) => (
            <Text key={idx} style={[styles.issueItem, { color: theme.colors.textMuted }]}>
              • {issue}
            </Text>
          ))}
        </View>
      )}
      {onRetry && (
        <Button
          title="Try again"
          onPress={onRetry}
          variant="secondary"
          style={styles.retryBtn}
          icon={<Ionicons name="refresh" size={18} color={theme.colors.text} />}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  issuesContainer: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  issuesTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  issueItem: {
    fontSize: 12,
    lineHeight: 18,
    marginVertical: 2,
  },
  retryBtn: {
    minWidth: 140,
  },
});
