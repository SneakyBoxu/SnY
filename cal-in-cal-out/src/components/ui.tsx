import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { C, Spacing } from '@/constants/theme';

type TxtSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'hero';
const SIZES: Record<TxtSize, number> = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 24,
  xxl: 32,
  hero: 40,
};

export function Txt({
  children,
  size = 'md',
  color = C.text,
  weight = '400',
  align,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  size?: TxtSize;
  color?: string;
  weight?: '400' | '500' | '600' | '700' | '800' | '900';
  align?: 'left' | 'center' | 'right';
  style?: object;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          color,
          fontSize: SIZES[size],
          fontWeight: weight,
          textAlign: align,
          letterSpacing: size === 'hero' || size === 'xxl' ? -1 : size === 'xl' ? -0.5 : 0,
        },
        style,
      ]}
      maxFontSizeMultiplier={1.3}
    >
      {children}
    </Text>
  );
}

export function Screen({
  children,
  title,
  subtitle,
  right,
  loading,
  onBack,
  customHeader,
}: {
  children?: React.ReactNode;
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  loading?: boolean;
  onBack?: () => void;
  customHeader?: React.ReactNode;
}) {
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {customHeader ? (
        customHeader
      ) : title ? (
        <View style={s.header}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
            >
              <Txt size="lg" weight="700" style={{ marginTop: -2 }}>
                {'‹'}
              </Txt>
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            <Txt size="xl" weight="800" style={{ letterSpacing: -0.6 }}>
              {title}
            </Txt>
            {subtitle ? (
              <Txt size="sm" color={C.dim} weight="500" style={{ marginTop: 2 }}>
                {subtitle}
              </Txt>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      <ScrollView
        style={s.scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingBottom: 130,
          gap: 14,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={{ padding: Spacing.xxl, alignItems: 'center', marginVertical: 40 }}>
            <ActivityIndicator color={C.accent} size="large" />
          </View>
        ) : (
          children
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  onPress,
  highlight = false,
}: {
  children: React.ReactNode;
  style?: object;
  onPress?: () => void;
  highlight?: boolean;
}) {
  const cardStyle = [s.card, highlight && s.cardHighlight, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [...cardStyle, pressed && { opacity: 0.88 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={cardStyle}>{children}</View>;
}

export function CardTitle({
  children,
  action,
  icon,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <View style={s.cardTitleRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon}
        <Txt
          size="xs"
          weight="800"
          color={C.dimmer}
          style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}
        >
          {children}
        </Txt>
      </View>
      {action}
    </View>
  );
}

export function Divider({ style }: { style?: object }) {
  return <View style={[{ height: 1, backgroundColor: C.border, marginVertical: 2 }, style]} />;
}

export function Stat({
  label,
  value,
  sub,
  color = C.text,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {icon}
        <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
          {label}
        </Txt>
      </View>
      <Txt size="lg" weight="800" color={color} style={{ letterSpacing: -0.4 }}>
        {value}
      </Txt>
      {sub ? (
        <Txt size="xs" color={C.dim} weight="500">
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{children}</View>;
}

export function StatCell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View
      style={[
        {
          flex: 1,
          minWidth: '47%',
          backgroundColor: C.surfaceAlt,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: C.border,
          padding: 12,
          gap: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={s.segmented}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            style={[s.segment, active && s.segmentActive]}
          >
            <Txt
              size="sm"
              weight={active ? '700' : '600'}
              color={active ? C.text : C.dim}
              align="center"
              numberOfLines={1}
            >
              {o}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
export function MacroPill({
  label,
  value,
  target,
  color,
  softBg,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
  softBg?: string;
}) {
  const remaining = Math.max(0, target - value);
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <View style={s.macroPillBox}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
          <Txt size="sm" weight="700" color={C.text}>
            {label}
          </Txt>
        </View>
        <Txt size="xs" weight="700" color={color}>
          {`${Math.round(remaining)}g left`}
        </Txt>
      </View>
      <View style={s.track}>
        <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: color }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt size="xs" color={C.dimmer} weight="600">
          {`${Math.round(value)} / ${Math.round(target)}g`}
        </Txt>
        <Txt size="xs" color={C.dimmer} weight="600">
          {`${Math.round(pct)}%`}
        </Txt>
      </View>
    </View>
  );
}

export function MacroBar({
  label,
  value,
  target,
  color,
  mode = 'consumed',
}: {
  label: string;
  value: number;
  target: number;
  color: string;
  mode?: 'consumed' | 'left';
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const left = Math.round(target - value);

  return (
    <View style={{ gap: 4 }}>
      <View style={{ gap: 2 }}>
        <Txt size="xs" weight="600" color={C.dim}>
          {label}
        </Txt>
        {mode === 'left' ? (
          <Txt size="sm" weight="900" color={left < 0 ? C.warn : C.text}>
            {left >= 0 ? `${left} g left` : `${Math.abs(left)} g over`}
          </Txt>
        ) : (
          <Txt size="sm" color={C.dim}>
            <Txt size="sm" weight="900" color={C.text}>
              {Math.round(value)}
            </Txt>
            {` / ${Math.round(target)} g`}
          </Txt>
        )}
      </View>
      <View style={s.track}>
        <View
          style={{
            width: `${pct}%`,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

export function NumberField({
  label,
  value,
  onChangeText,
  onCommit,
  suffix,
  placeholder,
  style,
  inputStyle,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  onCommit?: () => void;
  suffix?: string;
  placeholder?: string;
  style?: object;
  inputStyle?: object;
}) {
  return (
    <View style={[{ gap: 4, minWidth: 0 }, style]}>
      {label ? (
        <Txt size="xs" weight="700" color={C.dimmer} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {label}
        </Txt>
      ) : null}
      <View style={[s.input, inputStyle]}>
        {Platform.OS === 'web' ? (
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e: any) => onChangeText(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter') onCommit?.();
            }}
            placeholder={placeholder}
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: C.text,
              fontSize: 16,
              fontWeight: 700,
              padding: 0,
              margin: 0,
              flex: 1,
              minWidth: 0,
              width: '100%',
              fontFamily:
                'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            } as any}
          />
        ) : (
          <TextInput
            value={value}
            onChangeText={onChangeText}
            onBlur={onCommit}
            onSubmitEditing={onCommit}
            placeholder={placeholder}
            placeholderTextColor={C.dimmer}
            keyboardType="decimal-pad"
            style={{ color: C.text, fontSize: 16, fontWeight: '700', padding: 0, flex: 1 }}
            selectionColor={C.accent}
          />
        )}
        {suffix ? (
          <Txt size="sm" color={C.dim} weight="600">
            {suffix}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  color,
  small = false,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
  small?: boolean;
}) {
  const activeBg = color ? color : C.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        s.chip,
        small && s.chipSmall,
        active && { backgroundColor: activeBg, borderColor: activeBg },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Txt size={small ? 'xs' : 'sm'} weight="700" color={active ? C.onAccent : C.dim}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: Spacing.s, paddingRight: Spacing.l }}
    >
      {children}
    </ScrollView>
  );
}

export function Row({
  title,
  sub,
  right,
  onPress,
  onLongPress,
  badge,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt size="md" weight="700">
            {title}
          </Txt>
          {badge}
        </View>
        {sub ? (
          <Txt size="sm" color={C.dim} weight="500">
            {sub}
          </Txt>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

export function Stepper({
  value,
  onChange,
  step = 0.05,
  min = 0,
  max = 10,
  decimals = 2,
  format,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  format?: (n: number) => string;
}) {
  const clampStep = (dir: number) => {
    const next = Math.min(max, Math.max(min, +(value + dir * step).toFixed(4)));
    onChange(next);
  };
  const fmt = (n: number) => (format ? format(n) : n.toFixed(decimals).replace(/\.0+$/, '') || '0');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s }}>
      <Pressable onPress={() => clampStep(-1)} style={s.stepperBtn}>
        <Txt size="lg" weight="700" color={C.text}>
          −
        </Txt>
      </Pressable>
      <Txt size="md" weight="800" style={{ minWidth: 54, textAlign: 'center' }}>
        {fmt(value)}
      </Txt>
      <Pressable onPress={() => clampStep(1)} style={s.stepperBtn}>
        <Txt size="lg" weight="700" color={C.text}>
          +
        </Txt>
      </Pressable>
    </View>
  );
}

export function Ring({
  progress,
  size = 136,
  stroke = 12,
  color = C.accent,
  trackColor = C.surfaceAlt,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  const dash = p * circ;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  small,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'secondary' | 'danger';
  disabled?: boolean;
  small?: boolean;
  icon?: React.ReactNode;
}) {
  const bg =
    variant === 'primary'
      ? C.accent
      : variant === 'danger'
        ? C.danger
        : variant === 'secondary'
          ? C.surfaceHi
          : C.surfaceAlt;

  const textColor = variant === 'primary' ? C.onAccent : C.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        small && s.buttonSmall,
        {
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.82 : 1,
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {icon}
        <Txt
          size={small ? 'sm' : 'md'}
          weight="800"
          color={textColor}
          align="center"
        >
          {title}
        </Txt>
      </View>
    </Pressable>
  );
}

export function EmptyHint({
  title,
  sub,
  icon,
}: {
  title: string;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <View style={{ padding: Spacing.xl, gap: 6, alignItems: 'center' }}>
      {icon}
      <Txt size="md" weight="700" color={C.dim} align="center">
        {title}
      </Txt>
      {sub ? (
        <Txt size="sm" color={C.dimmer} align="center" style={{ maxWidth: 280 }}>
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1, paddingHorizontal: 14 },
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardHighlight: {
    borderColor: C.borderLight,
    backgroundColor: C.surfaceAlt,
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    padding: 3,
    gap: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segmentActive: {
    backgroundColor: C.surfaceHi,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 1,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.surfaceHi,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  input: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  row: {
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.surfaceHi,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  macroPillBox: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmModalSheet: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  confirmModalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmModalOkBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function ConfirmModal({
  visible,
  title,
  message,
  confirmText = 'OK',
  cancelText = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.modalBackdrop} onPress={onCancel}>
        <Pressable style={s.confirmModalSheet} onPress={(e) => e.stopPropagation?.()}>
          <View style={{ gap: 8 }}>
            <Txt size="lg" weight="900" color={C.text}>
              {title}
            </Txt>
            <Txt size="sm" color={C.dim} style={{ lineHeight: 20 }}>
              {message}
            </Txt>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4, justifyContent: 'flex-end' }}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                s.confirmModalCancelBtn,
                pressed && { opacity: 0.7, backgroundColor: C.surfaceHi },
              ]}
            >
              <Txt size="sm" weight="700" color={C.text}>
                {cancelText}
              </Txt>
            </Pressable>

            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                s.confirmModalOkBtn,
                danger && { backgroundColor: C.danger },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Txt size="sm" weight="800" color={danger ? '#FFFFFF' : C.onAccent}>
                {confirmText}
              </Txt>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
