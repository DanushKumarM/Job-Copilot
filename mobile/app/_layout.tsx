import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';
import { ThemeProvider, useTheme } from '../src/providers/ThemeProvider';
import { QueryProvider } from '../src/providers/QueryProvider';
import { AuthProvider, useAuth } from '../src/providers/AuthProvider';

function RootNavigation() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { theme } = useTheme();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="sources" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="insights" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="settings" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="answers" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="jobs/[id]" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="applications/[id]" options={{ headerShown: false, presentation: 'card' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryProvider>
          <AuthProvider>
            <RootNavigation />
          </AuthProvider>
        </QueryProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
