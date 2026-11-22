import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: any;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  hint,
  secureTextEntry,
  containerStyle,
  style,
  ...props
}) => {
  const { theme } = useTheme();
  const [isSecure, setIsSecure] = useState(secureTextEntry);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text style={[styles.label, { color: theme.colors.text }]}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.inputWrapper,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error
              ? theme.colors.danger
              : isFocused
              ? theme.colors.primary
              : theme.colors.border,
            borderRadius: theme.radius.md,
          },
          props.multiline && styles.multilineWrapper,
        ]}
      >
        <TextInput
          placeholderTextColor={theme.colors.textSubtle}
          secureTextEntry={isSecure}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={[
            styles.input,
            { color: theme.colors.text },
            props.multiline && styles.multilineInput,
            style,
          ]}
          {...props}
        />
        {secureTextEntry && (
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setIsSecure(!isSecure)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={isSecure ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={theme.colors.textMuted}
            />
          </TouchableOpacity>
        )}
      </View>
      {error ? (
        <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  multilineWrapper: {
    alignItems: 'flex-start',
    paddingVertical: 10,
    minHeight: 100,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  multilineInput: {
    textAlignVertical: 'top',
  },
  eyeBtn: {
    padding: 4,
  },
  error: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
  hint: {
    fontSize: 12,
    marginTop: 4,
  },
});
