import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_TOKEN_KEY = 'jobcopilot_mobile_session_token';

// In-memory fallback if SecureStore is not supported (e.g. web/SSR or unit tests)
let memoryStore: Record<string, string> = {};

export async function getSessionToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_TOKEN_KEY) : null;
    }
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch {
    return memoryStore[SESSION_TOKEN_KEY] || null;
  }
}

export async function setSessionToken(token: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SESSION_TOKEN_KEY, token);
      return;
    }
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  } catch {
    memoryStore[SESSION_TOKEN_KEY] = token;
  }
}

export async function removeSessionToken(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SESSION_TOKEN_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  } catch {
    delete memoryStore[SESSION_TOKEN_KEY];
  }
}
