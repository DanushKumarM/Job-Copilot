import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useAuth } from '../../src/hooks/useAuth';
import { Input } from '../../src/components/Input';
import { Button } from '../../src/components/Button';
import { formatErrorMessage } from '../../src/api/client';

export default function RegisterScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { register } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await register(email.trim(), password);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 24) + 12, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={[styles.logoIcon, { backgroundColor: theme.colors.primaryMuted, borderColor: theme.colors.primary }]}>
            <Ionicons name="person-add" size={32} color={theme.colors.primaryLight} />
          </View>
          <Text style={[styles.title, { color: theme.colors.text }]}>Create Account</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
            Set up an account to store your profile facts and track your job search.
          </Text>
        </View>

        {error && (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: theme.colors.dangerMuted, borderColor: theme.colors.danger },
            ]}
          >
            <Ionicons name="alert-circle" size={18} color={theme.colors.danger} />
            <Text style={[styles.errorText, { color: theme.colors.danger }]}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (error) setError(null);
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Input
            label="Password"
            placeholder="At least 8 characters"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (error) setError(null);
            }}
            secureTextEntry
            hint="Minimum 8 characters."
          />

          <Input
            label="Confirm Password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChangeText={(t) => {
              setConfirmPassword(t);
              if (error) setError(null);
            }}
            secureTextEntry
          />

          <Button
            title="Create Account"
            onPress={handleRegister}
            loading={loading}
            style={styles.submitBtn}
          />
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.colors.textMuted }]}>
            Already have an account?{' '}
          </Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={[styles.linkText, { color: theme.colors.primaryLight }]}>
              Sign in
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 290,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  form: {
    marginBottom: 20,
  },
  submitBtn: {
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  footerText: {
    fontSize: 14,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
