import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { todayISO } from '@/lib/date';
import { fmtInt, fmtNum, round } from '@/lib/num';
import { estimateTdee } from '@/lib/tdee';
import type { AppSettings } from '@/lib/types';
import { useDb } from '@/db/db';
import { recalculateAll } from '@/db/recalc';
import {
  createUserGoal,
  getLatestTdeePoint,
  getSettings,
} from '@/db/queries';
import {
  calculateGoalPlan,
  GoalCompletionMetric,
} from '@/lib/goalEngine';
import {
  Button,
  Card,
  CardTitle,
  Divider,
  Screen,
  Txt,
} from '@/components/ui';

export default function SetGoalScreen() {
  const db = useDb();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [currentWeight, setCurrentWeight] = useState<number>(75);
  const [currentTdee, setCurrentTdee] = useState<number>(2200);

  // Wizard Step State (1: Target Weight -> 2: Rate -> 3: Review)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form State
  const [targetWeight, setTargetWeight] = useState<number>(70);
  const [goalRateAbs, setGoalRateAbs] = useState<number>(0.5); // kg per week
  const [completionMetric, setCompletionMetric] = useState<GoalCompletionMetric>('TREND_WEIGHT');
  const [saving, setSaving] = useState(false);

  // Ruler dragging state
  const [isDraggingRuler, setIsDraggingRuler] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartWeight, setDragStartWeight] = useState(70);

  // Rate Slider dragging state
  const [isDraggingRate, setIsDraggingRate] = useState(false);
  const sliderTrackRef = useRef<any>(null);
  const sliderBounds = useRef<{ left: number; width: number }>({ left: 0, width: 300 });

  useEffect(() => {
    let live = true;
    (async () => {
      const s = await getSettings(db);
      const point = await getLatestTdeePoint(db, s);
      if (!live) return;
      setSettings(s);
      setTargetWeight(s.target_weight_kg ?? 70);

      const w = point.trendWeight ?? 75;
      setCurrentWeight(w);

      const estimated = point.tdee ?? estimateTdee(s, w);
      setCurrentTdee(estimated);

      const currentRate = Math.abs(s.goal_rate_kg_per_week);
      setGoalRateAbs(currentRate > 0 ? currentRate : 0.5);
    })();
    return () => {
      live = false;
    };
  }, [db]);

  // Pointer / Touch handlers for Ruler scrubbing
  const handlePointerDown = (e: any) => {
    e.stopPropagation?.();
    const clientX =
      e.clientX ??
      e.nativeEvent?.clientX ??
      e.nativeEvent?.pageX ??
      e.nativeEvent?.touches?.[0]?.pageX ??
      0;
    try {
      e.target?.setPointerCapture?.(e.pointerId);
    } catch {}
    setIsDraggingRuler(true);
    setDragStartX(clientX);
    setDragStartWeight(targetWeight);
  };

  const handlePointerMove = (e: any) => {
    if (!isDraggingRuler) return;
    e.stopPropagation?.();
    const clientX =
      e.clientX ??
      e.nativeEvent?.clientX ??
      e.nativeEvent?.pageX ??
      e.nativeEvent?.touches?.[0]?.pageX ??
      0;
    const dx = clientX - dragStartX;
    const deltaKg = Math.round((dx / 10) * 2) / 2;
    const next = Math.max(30, Math.min(250, round(dragStartWeight + deltaKg, 1)));
    setTargetWeight(next);
  };

  const handlePointerUp = (e?: any) => {
    try {
      if (e?.target?.releasePointerCapture && e?.pointerId !== undefined) {
        e.target.releasePointerCapture(e.pointerId);
      }
    } catch {}
    setIsDraggingRuler(false);
  };

  // Pointer / Touch handlers for Rate Slider scrubbing
  const updateRateFromPointer = (clientX: number) => {
    const bounds = sliderBounds.current;
    if (bounds.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const rawRate = 0.1 + ratio * (1.5 - 0.1);
    const stepped = Math.round(rawRate / 0.05) * 0.05;
    const next = Math.max(0.1, Math.min(1.5, round(stepped, 2)));
    setGoalRateAbs(next);
  };

  const handleRatePointerDown = (e: any) => {
    e.stopPropagation?.();
    const clientX =
      e.clientX ??
      e.nativeEvent?.clientX ??
      e.nativeEvent?.pageX ??
      e.nativeEvent?.touches?.[0]?.pageX ??
      0;
    try {
      e.target?.setPointerCapture?.(e.pointerId);
    } catch {}
    setIsDraggingRate(true);
    updateRateFromPointer(clientX);
  };

  const handleRatePointerMove = (e: any) => {
    if (!isDraggingRate) return;
    e.stopPropagation?.();
    const clientX =
      e.clientX ??
      e.nativeEvent?.clientX ??
      e.nativeEvent?.pageX ??
      e.nativeEvent?.touches?.[0]?.pageX ??
      0;
    updateRateFromPointer(clientX);
  };

  const handleRatePointerUp = (e?: any) => {
    try {
      if (e?.target?.releasePointerCapture && e?.pointerId !== undefined) {
        e.target.releasePointerCapture(e.pointerId);
      }
    } catch {}
    setIsDraggingRate(false);
  };

  // Run dynamic calculation engine
  const plan = useMemo(() => {
    if (!settings) return null;
    return calculateGoalPlan({
      currentWeightKg: currentWeight,
      targetWeightKg: targetWeight,
      selectedRateKgPerWeek: goalRateAbs,
      currentTdee,
      settings,
    });
  }, [settings, currentWeight, targetWeight, goalRateAbs, currentTdee]);

  const stepTargetWeight = (delta: number) => {
    setTargetWeight((prev) => Math.max(30, Math.min(250, round(prev + delta, 1))));
  };

  const stepRate = (delta: number) => {
    setGoalRateAbs((prev) => Math.max(0.1, Math.min(1.5, round(prev + delta, 1))));
  };

  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const handleCommitGoal = async () => {
    if (!settings || !plan || saving) return;
    setSaving(true);
    try {
      await createUserGoal(db, {
        created_at: todayISO(),
        goal_type: plan.goalType,
        start_weight_kg: currentWeight,
        target_weight_kg: targetWeight,
        target_rate_kg_per_week: plan.signedRateKgPerWeek,
        goal_completion_metric: completionMetric,
        daily_calorie_target: plan.dailyCalorieTarget,
        protein_target_g: plan.macroTargets.protein,
      });

      await recalculateAll(db);
      setShowSuccessModal(true);
    } catch (err) {
      console.warn('Failed to save goal:', err);
      router.replace('/(tabs)');
    } finally {
      setSaving(false);
    }
  };

  if (!settings || !plan) {
    return <Screen title="Set New Goal" loading onBack={() => router.back()} />;
  }

  // Expanded ruler ticks
  const rulerTicks = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];

  // Rate Slider percentage (0.1 to 1.5 kg/week)
  const rateSliderPct = Math.min(100, Math.max(0, ((goalRateAbs - 0.1) / (1.5 - 0.1)) * 100));

  return (
    <Screen
      title="Set New Goal"
      subtitle={
        step === 1
          ? 'Step 1 of 3 · Target Weight'
          : step === 2
            ? 'Step 2 of 3 · Rate of Progress'
            : 'Step 3 of 3 · Review & Commit'
      }
      onBack={() => {
        if (step > 1) {
          setStep((prev) => (prev - 1) as 1 | 2);
        } else {
          router.back();
        }
      }}
    >
      {/* Top Multi-Step Progress Track */}
      <View style={st.topProgressTrack}>
        <View
          style={[
            st.topProgressBar,
            { width: step === 1 ? '33%' : step === 2 ? '66%' : '100%' },
          ]}
        />
      </View>

      {/* Top 2 Live Metric Cards */}
      <View style={st.metricRow}>
        <View
          style={[
            st.metricCard,
            plan.isFloorEnforced
              ? { borderColor: C.warn, backgroundColor: '#1C150A' }
              : { borderColor: C.accentSoft, backgroundColor: '#0C1C16' },
          ]}
        >
          <Txt size="lg" weight="900" color={plan.isFloorEnforced ? C.warn : C.accent} numberOfLines={1}>
            {`${fmtInt(plan.dailyCalorieTarget)} kcal`}
          </Txt>
          <Txt size="xs" color={C.dim} weight="600" style={{ marginTop: 2 }}>
            {plan.isFloorEnforced ? 'floor advisory' : 'initial daily budget'}
          </Txt>
        </View>

        <View style={st.metricCard}>
          <Txt size="lg" weight="900" color={C.text} numberOfLines={1}>
            {plan.projectedEndDateFormatted}
          </Txt>
          <Txt size="xs" color={C.dim} weight="600" style={{ marginTop: 2 }}>
            projected end date
          </Txt>
        </View>
      </View>

      {/* ======================================================== */}
      {/* STEP 1: TARGET WEIGHT PICKER                             */}
      {/* ======================================================== */}
      {step === 1 ? (
        <Card style={{ padding: 18, alignItems: 'center', gap: 14 }}>
          <Txt size="lg" weight="900" color={C.text} style={{ letterSpacing: -0.3 }}>
            What is your target weight?
          </Txt>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Txt size="hero" weight="900" color={C.text} style={{ letterSpacing: -1 }}>
              {fmtNum(targetWeight, 1)}
            </Txt>
            <Txt size="lg" weight="800" color={C.dim}>
              kg
            </Txt>
          </View>

          {/* Interactive Hold & Drag Scale Ruler */}
          <View
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handlePointerDown}
            onResponderMove={handlePointerMove}
            onResponderRelease={handlePointerUp}
            onResponderTerminate={handlePointerUp}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={[
              st.rulerContainer,
              isDraggingRuler && { borderColor: C.accent, backgroundColor: '#0C1C16' },
              Platform.OS === 'web' && ({
                cursor: isDraggingRuler ? 'grabbing' : 'grab',
                userSelect: 'none',
                touchAction: 'none',
                WebkitUserSelect: 'none',
              } as any),
            ]}
          >
            <View style={st.rulerCenterIndicator} />
            <View style={st.rulerTicksRow}>
              {rulerTicks.map((tick) => {
                const val = Math.round(targetWeight + tick);
                const isCenter = tick === 0;
                return (
                  <View key={tick} style={st.rulerTickCol}>
                    <View
                      style={[
                        st.tickLine,
                        isCenter && st.tickLineCenter,
                        tick % 2 === 0 && st.tickLineMajor,
                      ]}
                    />
                    {tick % 2 === 0 ? (
                      <Txt
                        size="xs"
                        weight={isCenter ? '900' : '700'}
                        color={isCenter ? C.accent : C.dimmer}
                        style={{ marginTop: 6 }}
                      >
                        {val}
                      </Txt>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>

          <Txt size="xs" color={C.dimmer} align="center">
            ← Drag ruler left or right to adjust weight →
          </Txt>

          {/* Stepper Buttons for Target Weight */}
          <View style={st.stepperRow}>
            <Pressable
              onPress={() => stepTargetWeight(-0.5)}
              style={({ pressed }) => [st.stepperBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="remove" size={20} color={C.text} />
            </Pressable>

            <View style={st.stepperInfoBadge}>
              <Txt size="xs" weight="700" color={C.dim}>
                {plan.goalType === 'CUT'
                  ? `Lose ${fmtNum(plan.absDeltaKg, 1)} kg from current (${fmtNum(currentWeight, 1)} kg)`
                  : plan.goalType === 'BULK'
                    ? `Gain ${fmtNum(plan.absDeltaKg, 1)} kg from current (${fmtNum(currentWeight, 1)} kg)`
                    : 'Maintain current bodyweight'}
              </Txt>
            </View>

            <Pressable
              onPress={() => stepTargetWeight(0.5)}
              style={({ pressed }) => [st.stepperBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="add" size={20} color={C.text} />
            </Pressable>
          </View>

          <Button
            title={plan.goalType === 'MAINTAIN' ? 'Next: Review Plan ›' : 'Next: Choose Rate of Progress ›'}
            onPress={() => setStep(plan.goalType === 'MAINTAIN' ? 3 : 2)}
          />
        </Card>
      ) : null}

      {/* ======================================================== */}
      {/* STEP 2: RATE OF LOSS / PROGRESS SELECTOR                 */}
      {/* ======================================================== */}
      {step === 2 ? (
        <Card style={{ padding: 18, gap: 14 }}>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Txt size="lg" weight="900" color={C.text} style={{ letterSpacing: -0.3 }}>
              What is your target goal rate?
            </Txt>

            {/* Visual Color-Coded Rate Tier Badge */}
            <View
              style={[
                st.rateTierBadge,
                { borderColor: plan.rateZone.color + '60', backgroundColor: plan.rateZone.color + '15' },
              ]}
            >
              <Txt size="xs" weight="800" color={plan.rateZone.color}>
                {plan.rateZone.label}
              </Txt>
            </View>
            <Txt size="xs" color={C.dim} align="center" style={{ maxWidth: 300 }}>
              {plan.rateZone.description}
            </Txt>
          </View>

          {/* Interactive Hold & Drag Rate Slider Bar */}
          <View
            ref={sliderTrackRef}
            onLayout={(e) => {
              const { width } = e.nativeEvent.layout;
              if (Platform.OS === 'web' && sliderTrackRef.current?.getBoundingClientRect) {
                const rect = sliderTrackRef.current.getBoundingClientRect();
                sliderBounds.current = { left: rect.left, width: rect.width || width };
              } else {
                sliderBounds.current = { left: 20, width: width || 300 };
              }
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleRatePointerDown}
            onResponderMove={handleRatePointerMove}
            onResponderRelease={handleRatePointerUp}
            onResponderTerminate={handleRatePointerUp}
            onPointerDown={handleRatePointerDown}
            onPointerMove={handleRatePointerMove}
            onPointerUp={handleRatePointerUp}
            onPointerCancel={handleRatePointerUp}
            style={[
              st.rateSliderContainer,
              Platform.OS === 'web' && ({
                cursor: isDraggingRate ? 'grabbing' : 'pointer',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              } as any),
            ]}
          >
            <View style={st.rateSliderTrack}>
              <View
                style={[
                  st.rateSliderFill,
                  { width: `${rateSliderPct}%`, backgroundColor: plan.rateZone.color },
                ]}
              />
            </View>
            <View
              style={[
                st.rateSliderThumb,
                {
                  left: `calc(${rateSliderPct}% - 14px)` as any,
                  borderColor: plan.rateZone.color,
                  transform: [{ scale: isDraggingRate ? 1.25 : 1 }],
                },
              ]}
            />
          </View>
          <Txt size="xs" color={C.dimmer} align="center">
            ← Drag slider thumb or tap track to adjust pace →
          </Txt>

          {/* Stepper Buttons for Goal Rate */}
          <View style={st.stepperRow}>
            <Pressable
              onPress={() => stepRate(-0.05)}
              style={({ pressed }) => [st.stepperBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="remove" size={20} color={C.text} />
            </Pressable>

            <View style={{ alignItems: 'center' }}>
              <Txt size="xl" weight="900" color={plan.rateZone.color}>
                {`${fmtNum(plan.absRateKgPerWeek, 2)} kg / week`}
              </Txt>
            </View>

            <Pressable
              onPress={() => stepRate(0.05)}
              style={({ pressed }) => [st.stepperBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="add" size={20} color={C.text} />
            </Pressable>
          </View>

          {/* Rate Breakdown Metric Boxes (Per Week & Per Month) */}
          <View style={{ gap: 8, marginTop: 4 }}>
            {/* Per Week Row */}
            <View style={st.rateBreakdownRow}>
              <View style={st.rateValueBox}>
                <Txt size="md" weight="800" color={C.text}>
                  {fmtNum(plan.absRateKgPerWeek, 2)}
                </Txt>
                <Txt size="xs" weight="700" color={C.dim}>
                  kg
                </Txt>
              </View>

              <View style={st.rateValueBox}>
                <Txt size="md" weight="800" color={C.text}>
                  {fmtNum(plan.ratePctBwPerWeek, 2)}
                </Txt>
                <Txt size="xs" weight="700" color={C.dim}>
                  % BW
                </Txt>
              </View>

              <Txt size="sm" weight="700" color={C.dim} style={{ width: 90 }}>
                Per Week
              </Txt>
            </View>

            {/* Per Month Row */}
            <View style={st.rateBreakdownRow}>
              <View style={st.rateValueBox}>
                <Txt size="md" weight="800" color={C.text}>
                  {fmtNum(plan.absRateKgPerWeek * 4, 2)}
                </Txt>
                <Txt size="xs" weight="700" color={C.dim}>
                  kg
                </Txt>
              </View>

              <View style={st.rateValueBox}>
                <Txt size="md" weight="800" color={C.text}>
                  {fmtNum(plan.ratePctBwPerWeek * 4, 2)}
                </Txt>
                <Txt size="xs" weight="700" color={C.dim}>
                  % BW
                </Txt>
              </View>

              <Txt size="sm" weight="700" color={C.dim} style={{ width: 90 }}>
                Per Month
              </Txt>
            </View>
          </View>

          {/* Goal Completion Condition Toggle */}
          <Divider />
          <View style={{ gap: 8 }}>
            <Txt size="xs" color={C.dimmer} weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Goal Completion Trigger Condition
            </Txt>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => setCompletionMetric('TREND_WEIGHT')}
                style={[
                  st.completionToggleBox,
                  completionMetric === 'TREND_WEIGHT' && st.completionToggleBoxActive,
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons
                    name="trending-up"
                    size={16}
                    color={completionMetric === 'TREND_WEIGHT' ? C.accent : C.dim}
                  />
                  <Txt
                    size="sm"
                    weight="800"
                    color={completionMetric === 'TREND_WEIGHT' ? C.accent : C.text}
                  >
                    Trend Weight (Recommended)
                  </Txt>
                </View>
                <Txt size="xs" color={C.dim} weight="500">
                  Completes only when EWMA smoothed weight reaches target (prevents false dehydration milestones).
                </Txt>
              </Pressable>

              <Pressable
                onPress={() => setCompletionMetric('RAW_SCALE')}
                style={[
                  st.completionToggleBox,
                  completionMetric === 'RAW_SCALE' && st.completionToggleBoxActive,
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons
                    name="scale-outline"
                    size={16}
                    color={completionMetric === 'RAW_SCALE' ? C.accent : C.dim}
                  />
                  <Txt
                    size="sm"
                    weight="800"
                    color={completionMetric === 'RAW_SCALE' ? C.accent : C.text}
                  >
                    Raw Scale
                  </Txt>
                </View>
                <Txt size="xs" color={C.dim} weight="500">
                  Completes the moment any single morning weigh-in reaches target.
                </Txt>
              </Pressable>
            </View>
          </View>

          <Button title="Next: Review Plan ›" onPress={() => setStep(3)} />
        </Card>
      ) : null}

      {/* ======================================================== */}
      {/* STEP 3: REVIEW & COMMIT STRATEGY                         */}
      {/* ======================================================== */}
      {step === 3 ? (
        <Card style={{ padding: 18, gap: 14 }}>
          <CardTitle icon={<Ionicons name="flag" size={16} color={C.accent} />}>
            STRATEGY CONFIRMATION
          </CardTitle>

          <View style={st.destinationSummaryCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ gap: 2 }}>
                <Txt size="xs" color={C.dim} weight="700">START WEIGHT</Txt>
                <Txt size="lg" weight="900" color={C.text}>{`${fmtNum(currentWeight, 1)} kg`}</Txt>
              </View>

              <Ionicons name="arrow-forward" size={20} color={C.accent} />

              <View style={{ gap: 2, alignItems: 'flex-end' }}>
                <Txt size="xs" color={C.accent} weight="700">TARGET GOAL</Txt>
                <Txt size="lg" weight="900" color={C.accent}>{`${fmtNum(targetWeight, 1)} kg`}</Txt>
              </View>
            </View>

            <Divider />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt size="sm" color={C.dim} weight="600">Goal Type &amp; Phase</Txt>
              <View style={st.phaseBadgePill}>
                <Txt size="xs" weight="800" color={C.accent}>{`${plan.goalType} (${plan.phase})`}</Txt>
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt size="sm" color={C.dim} weight="600">Weekly Pace</Txt>
              <Txt size="sm" weight="800" color={C.text}>
                {plan.goalType === 'MAINTAIN' ? '0.00 kg/wk (Maintenance)' : `${fmtNum(plan.absRateKgPerWeek, 2)} kg/wk (${fmtNum(plan.ratePctBwPerWeek, 2)}% BW)`}
              </Txt>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt size="sm" color={C.dim} weight="600">Daily Calorie Target</Txt>
              <Txt size="sm" weight="900" color={C.kcal}>{`${fmtInt(plan.dailyCalorieTarget)} kcal/day`}</Txt>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt size="sm" color={C.dim} weight="600">Daily Deficit / Surplus</Txt>
              <Txt size="sm" weight="800" color={plan.dailyCalorieDelta < 0 ? C.protein : C.accent}>
                {`${plan.dailyCalorieDelta > 0 ? '+' : ''}${fmtInt(plan.dailyCalorieDelta)} kcal/day`}
              </Txt>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt size="sm" color={C.dim} weight="600">Projected ETA</Txt>
              <Txt size="sm" weight="800" color={C.text}>{`${plan.estimatedWeeks} weeks (${plan.projectedEndDateFormatted})`}</Txt>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt size="sm" color={C.dim} weight="600">Completion Trigger</Txt>
              <Txt size="sm" weight="800" color={C.text}>
                {completionMetric === 'TREND_WEIGHT' ? 'Trend Weight (EWMA)' : 'Raw Scale Weigh-in'}
              </Txt>
            </View>
          </View>

          {/* Recommended Macro Split */}
          <View style={{ gap: 6 }}>
            <Txt size="xs" color={C.dimmer} weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Recommended Macro Split
            </Txt>
            <View style={st.macroGrid}>
              <View style={st.macroBox}>
                <Txt size="xs" color={C.protein} weight="800">PROTEIN</Txt>
                <Txt size="lg" weight="900" color={C.protein}>{`${plan.macroTargets.protein}g`}</Txt>
                <Txt size="xs" color={C.dimmer}>2.0g/kg</Txt>
              </View>
              <View style={st.macroBox}>
                <Txt size="xs" color={C.carbs} weight="800">CARBS</Txt>
                <Txt size="lg" weight="900" color={C.carbs}>{`${plan.macroTargets.carbs}g`}</Txt>
                <Txt size="xs" color={C.dimmer}>Energy</Txt>
              </View>
              <View style={st.macroBox}>
                <Txt size="xs" color={C.fat} weight="800">FAT</Txt>
                <Txt size="lg" weight="900" color={C.fat}>{`${plan.macroTargets.fat}g`}</Txt>
                <Txt size="xs" color={C.dimmer}>Hormones</Txt>
              </View>
            </View>
          </View>

          <Button
            title={saving ? 'Activating Goal…' : 'Start Goal'}
            onPress={handleCommitGoal}
            disabled={saving}
          />
        </Card>
      ) : null}

      {/* SUCCESS MODAL ON GOAL START */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        onRequestClose={() => router.replace('/(tabs)')}
      >
        <View style={st.modalOverlay}>
          <View style={st.successCard}>
            <View style={st.successIconCircle}>
              <Ionicons name="flag" size={32} color={C.accent} />
            </View>

            <Txt size="xl" weight="900" color={C.text} align="center">
              Goal Activated!
            </Txt>

            <Txt size="sm" color={C.dim} align="center" style={{ lineHeight: 20 }}>
              Good luck with your journey! Your daily calorie budget is now calibrated to{' '}
              <Txt size="sm" weight="900" color={C.accent}>
                {`${fmtInt(plan.dailyCalorieTarget)} kcal/day`}
              </Txt>.
            </Txt>

            <View style={st.successSummaryBox}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="xs" color={C.dim} weight="600">Target Goal</Txt>
                <Txt size="sm" weight="900" color={C.text}>{`${fmtNum(targetWeight, 1)} kg (${plan.phase})`}</Txt>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="xs" color={C.dim} weight="600">Weekly Pace</Txt>
                <Txt size="sm" weight="800" color={C.accent}>
                  {plan.goalType === 'MAINTAIN' ? '0.00 kg/wk' : `${fmtNum(plan.absRateKgPerWeek, 2)} kg/week`}
                </Txt>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="xs" color={C.dim} weight="600">Projected ETA</Txt>
                <Txt size="sm" weight="800" color={C.text}>{plan.projectedEndDateFormatted}</Txt>
              </View>
            </View>

            <Button
              title="Go to Dashboard ›"
              onPress={() => {
                setShowSuccessModal(false);
                router.replace('/(tabs)');
              }}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const st = StyleSheet.create({
  topProgressTrack: {
    height: 4,
    backgroundColor: C.surfaceHi,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  topProgressBar: {
    height: '100%',
    backgroundColor: C.accent,
    borderRadius: 2,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
  },
  rulerContainer: {
    width: '100%',
    height: 70,
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    position: 'relative',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 8,
  },
  rulerCenterIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 2,
    backgroundColor: C.accent,
    zIndex: 10,
  },
  rulerTicksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
  },
  rulerTickCol: {
    alignItems: 'center',
    flex: 1,
  },
  tickLine: {
    width: 1,
    height: 14,
    backgroundColor: C.dimmer,
  },
  tickLineMajor: {
    height: 22,
    backgroundColor: C.dim,
  },
  tickLineCenter: {
    backgroundColor: C.accent,
    width: 2,
    height: 32,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
  },
  stepperBtn: {
    backgroundColor: C.surfaceHi,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperInfoBadge: {
    backgroundColor: C.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  rateTierBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  rateSliderContainer: {
    width: '100%',
    height: 30,
    justifyContent: 'center',
    position: 'relative',
  },
  rateSliderTrack: {
    width: '100%',
    height: 6,
    backgroundColor: C.surfaceHi,
    borderRadius: 3,
    overflow: 'hidden',
  },
  rateSliderFill: {
    height: '100%',
    borderRadius: 3,
  },
  rateSliderThumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 3,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  rateBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rateValueBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  completionToggleBox: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 4,
  },
  completionToggleBoxActive: {
    borderColor: C.accent,
    backgroundColor: '#0C1C16',
  },
  destinationSummaryCard: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  phaseBadgePill: {
    backgroundColor: C.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  macroGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  macroBox: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    gap: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  successCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: C.borderLight,
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  successIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  successSummaryBox: {
    width: '100%',
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
});
