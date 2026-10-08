import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { C } from '@/constants/theme';
import { DatabaseProvider } from '@/db/db';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: C.accent,
    background: C.bg,
    card: C.surface,
    border: C.border,
    text: C.text,
    notification: C.accent,
  },
};

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <ThemeProvider value={theme}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: C.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="add-entry"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="edit-food"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="edit-workout"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="workout-day" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="workout-history-list" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="habit-detail" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="meal-detail" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="log-food" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="exercise-catalog" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="routine-builder" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="quick-log"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="barcode-scanner"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="meal-scan"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="set-goal"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="active-workout"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
        </Stack>
      </ThemeProvider>
    </DatabaseProvider>
  );
}
