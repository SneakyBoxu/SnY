import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Tabs, router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { Txt } from '@/components/ui';
import { useWorkoutSession } from '@/lib/workoutSession';

function formatElapsed(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function ResumeWorkoutPill() {
  const session = useWorkoutSession();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;

  const resting = session.restEndsAt !== null && session.restEndsAt > now;
  const restLeft = resting ? Math.ceil(((session.restEndsAt as number) - now) / 1000) : 0;
  const restLabel = `${String(Math.floor(restLeft / 60)).padStart(2, '0')}:${String(restLeft % 60).padStart(2, '0')}`;

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/active-workout' as any,
          params: { focusKey: session.focusKey, date: session.date },
        })
      }
      style={({ pressed }) => [st.resumePill, pressed && { opacity: 0.85 }]}
    >
      <View style={st.resumeDot} />
      <View style={{ flex: 1 }}>
        <Txt size="sm" weight="800" color={C.text} numberOfLines={1}>
          {session.focusName}
        </Txt>
        <Txt size="xs" weight="600" color={C.dim}>
          {resting ? `Rest ${restLabel} · ` : ''}
          {formatElapsed(session.startedAt, now)}
        </Txt>
      </View>
      <Txt size="sm" weight="900" color={C.accent}>
        Resume
      </Txt>
      <Ionicons name="chevron-up" size={16} color={C.accent} />
    </Pressable>
  );
}

const TAB_META: Record<string, { on: string; off: string; label: string }> = {
  index: { on: 'today', off: 'today-outline', label: 'Today' },
  trends: { on: 'trending-up', off: 'trending-up-outline', label: 'Trends' },
  workout: { on: 'barbell', off: 'barbell-outline', label: 'Workout' },
  foods: { on: 'nutrition', off: 'nutrition-outline', label: 'Foods' },
};

const LEFT_TABS = ['index', 'trends'];
const RIGHT_TABS = ['workout', 'foods'];

interface SheetAction {
  key: string;
  icon: string;
  color: string;
  title: string;
  sub: string;
  comingSoon?: boolean;
}

const SHEET_ACTIONS: SheetAction[] = [
  {
    key: 'food',
    icon: 'restaurant-outline',
    color: C.accent,
    title: 'Log Food',
    sub: 'Search database or add custom food',
  },
  {
    key: 'scan',
    icon: 'barcode-outline',
    color: C.blue,
    title: 'Barcode Scan',
    sub: 'Scan product barcode for instant lookup',
  },
  {
    key: 'quicklog',
    icon: 'flash-outline',
    color: '#38BDF8',
    title: 'AI Quick Log',
    sub: 'Describe meal text (e.g. 220g rice, 340g steak)',
  },
  {
    key: 'meal',
    icon: 'camera-outline',
    color: C.accent,
    title: 'AI Meal Scan',
    sub: 'Camera AI food recognition & segmentation',
  },
];

function CustomTabBar({
  state,
  navigation,
}: {
  state: { index: number; routes: { name: string }[] };
  navigation: { navigate: (name: string) => void };
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeRoute = state.routes[state.index]?.name;

  const goTab = (name: string) => {
    navigation.navigate(name);
  };

  const runAction = (key: string) => {
    setSheetOpen(false);
    if (key === 'food') {
      router.push('/add-entry');
    } else if (key === 'scan') {
      router.push('/barcode-scanner' as any);
    } else if (key === 'quicklog') {
      router.push('/quick-log' as any);
    } else if (key === 'meal') {
      router.push('/meal-scan' as any);
    } else if (key === 'settings') {
      goTab('settings');
    }
  };

  const renderTab = (name: string) => {
    const meta = TAB_META[name];
    if (!meta) return null;
    const focused = activeRoute === name;
    const color = focused ? C.accent : C.dim;
    return (
      <Pressable
        key={name}
        onPress={() => goTab(name)}
        style={({ pressed }) => [st.tabItem, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name={(focused ? meta.on : meta.off) as any} size={22} color={color} />
        <Txt size="xs" weight={focused ? '800' : '600'} color={color}>
          {meta.label}
        </Txt>
        {focused ? <View style={st.activeDot} /> : null}
      </Pressable>
    );
  };

  return (
    <View>
      <ResumeWorkoutPill />
      <View style={st.bar}>
      {LEFT_TABS.map(renderTab)}

      {/* Center + FAB */}
      <Pressable
        onPress={() => setSheetOpen(true)}
        style={({ pressed }) => [st.fabWrap, pressed && { opacity: 0.9 }]}
      >
        <View style={st.fab}>
          <Ionicons name="add" size={30} color={C.onAccent} />
        </View>
      </Pressable>

      {RIGHT_TABS.map(renderTab)}

      {/* Quick actions bottom sheet */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={st.overlay} onPress={() => setSheetOpen(false)}>
          <Pressable style={st.sheet} onPress={(e) => e.stopPropagation?.()}>
            {/* Drag handle */}
            <View style={st.handle} />

            <View style={st.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Txt size="lg" weight="900" color={C.text}>
                  Create Food Log
                </Txt>
                <Txt size="xs" color={C.dim} weight="600">
                  Choose what you want to track
                </Txt>
              </View>
              <Pressable onPress={() => setSheetOpen(false)} style={st.closeBtn}>
                <Ionicons name="close" size={18} color={C.dim} />
              </Pressable>
            </View>

            {SHEET_ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                onPress={() => (action.comingSoon ? undefined : runAction(action.key))}
                disabled={action.comingSoon}
                style={({ pressed }) => [
                  st.actionRow,
                  action.comingSoon && { opacity: 0.55 },
                  pressed && !action.comingSoon && { opacity: 0.8 },
                ]}
              >
                <View style={st.iconBox}>
                  <Ionicons name={action.icon as any} size={20} color={action.color} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size="md" weight="800" color={C.text}>
                    {action.title}
                  </Txt>
                  <Txt size="xs" color={C.dim} weight="500">
                    {action.sub}
                  </Txt>
                </View>
                {action.comingSoon ? (
                  <View style={st.soonPill}>
                    <Txt size="xs" weight="800" color={C.dim}>
                      Coming Soon
                    </Txt>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={C.dim} />
                )}
              </Pressable>
            ))}

            <View style={{ height: 2 }} />

            <Pressable
              onPress={() => runAction('settings')}
              style={({ pressed }) => [st.settingsRow, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="settings-outline" size={18} color={C.dim} />
              <Txt size="sm" weight="700" color={C.dim}>
                Settings
              </Txt>
              <View style={{ flex: 1 }} />
              <Ionicons name="chevron-forward" size={14} color={C.dimmer} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg },
      }}
      tabBar={(props: any) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="trends" />
      <Tabs.Screen name="workout" />
      <Tabs.Screen name="foods" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

const st = StyleSheet.create({
  resumePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: C.surfaceHi,
    borderWidth: 1,
    borderColor: C.accent,
  },
  resumeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.accent,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
  },
  fabWrap: {
    width: 84,
    alignItems: 'center',
    marginTop: -26,
    zIndex: 10,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: C.surface,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: C.borderLight,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    gap: 10,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.borderLight,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 12,
    backgroundColor: C.surfaceAlt,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surfaceAlt,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soonPill: {
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
});
