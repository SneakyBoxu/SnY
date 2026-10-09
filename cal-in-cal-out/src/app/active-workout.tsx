import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { C } from '@/constants/theme';
import { formatDayLabel, todayISO } from '@/lib/date';
import { fmtInt, parseNumber } from '@/lib/num';
import { useDb } from '@/db/db';
import { recalculateAll } from '@/db/recalc';
import {
  focusLabel,
  getCustomFocusLabels,
  getTemplateExercises,
  insertWorkoutEntry,
  lastEntryForExercise,
} from '@/db/workouts';
import {
  Button,
  Card,
  ConfirmModal,
  Divider,
  NumberField,
  TextField,
  Txt,
} from '@/components/ui';
import { clearSession, getSession, saveSession } from '@/lib/workoutSession';

export type SetType = 'NORMAL' | 'WARMUP' | 'FAILURE' | 'DROP';

interface ActiveSetRow {
  setNumber: number;
  setType?: SetType;
  prevStr: string;
  weightLbs: string;
  repsStr: string;
  completed: boolean;
}

interface ActiveExercise {
  id: string;
  name: string;
  prevWeight: string | null;
  prevReps: string | null;
  sets: ActiveSetRow[];
  isCollapsed?: boolean;
}

function getExerciseCategoryIcon(name: string): { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string } {
  const lower = name.toLowerCase();
  if (lower.includes('bench press') || lower.includes('chest') || lower.includes('incline') || lower.includes('dip') || lower.includes('fly')) {
    return { icon: 'barbell', color: '#38BDF8', bg: 'rgba(56,189,248,0.15)' };
  }
  if (lower.includes('squat') || lower.includes('leg') || lower.includes('calf') || lower.includes('lunge') || lower.includes('quad') || lower.includes('hamstring')) {
    return { icon: 'body', color: '#10B981', bg: 'rgba(16,185,129,0.15)' };
  }
  if (lower.includes('deadlift') || lower.includes('row') || lower.includes('pull-up') || lower.includes('lat') || lower.includes('back') || lower.includes('hang')) {
    return { icon: 'fitness', color: '#A855F7', bg: 'rgba(168,85,247,0.15)' };
  }
  if (lower.includes('tricep') || lower.includes('bicep') || lower.includes('curl') || lower.includes('arm') || lower.includes('shoulder') || lower.includes('raise') || lower.includes('press')) {
    return { icon: 'barbell', color: '#FBBF24', bg: 'rgba(251,191,36,0.15)' };
  }
  return { icon: 'walk', color: '#2DD4BF', bg: 'rgba(45,212,191,0.15)' };
}

export default function ActiveWorkoutScreen() {
  const db = useDb();
  const params = useLocalSearchParams<{ focusKey?: string; date?: string }>();
  const focusKeyParam = params.focusKey || 'push';
  const dateParam = params.date || todayISO();

  const [focusName, setFocusName] = useState('Push');
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<ActiveExercise[]>([]);
  const [ready, setReady] = useState(false);
  // Resume an existing minimized session for this routine (if any) instead of starting fresh
  const [sessionInitial] = useState(() => {
    const existing = getSession();
    const startedAt =
      existing && existing.focusKey === focusKeyParam && existing.date === dateParam
        ? existing.startedAt
        : Date.now();
    const initialSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    return { startedAt, initialSeconds };
  });
  const startedAtRef = useRef<number>(sessionInitial.startedAt);
  const finishedRef = useRef(false);
  const [seconds, setSeconds] = useState(sessionInitial.initialSeconds);
  const [isTimerRunning] = useState(true);

  // Rest Timer state
  const [showRestTimerModal, setShowRestTimerModal] = useState(false);
  const [defaultRestSec, setDefaultRestSec] = useState(90); // 1m 30s
  const [exerciseRestSecMap, setExerciseRestSecMap] = useState<Record<string, number>>({});
  const [activeRestRemaining, setActiveRestRemaining] = useState(90);
  const [activeRestTotal, setActiveRestTotal] = useState(90);
  const [isRestTimerActive, setIsRestTimerActive] = useState(false);
  // Rest Timer Duration Wheel Picker Modal
  const [editingDurationTarget, setEditingDurationTarget] = useState<'default' | string | null>(null);
  const [pickerMinutes, setPickerMinutes] = useState(1);
  const [pickerSeconds, setPickerSeconds] = useState(30);

  const [prevDisplayMode, setPrevDisplayMode] = useState<'lbs' | 'reps'>('lbs');

  const togglePrevDisplayMode = () => {
    setPrevDisplayMode((mode) => (mode === 'lbs' ? 'reps' : 'lbs'));
  };

  const formatPrevDisplay = (prevStr: string, setIdx: number) => {
    if (!prevStr || prevStr === '-') return '-';

    // Parse parts: "100 lbs × 12,12,12" or "100 × 12"
    if (prevStr.includes('×')) {
      const parts = prevStr.split('×');
      const wPart = parts[0]?.trim(); // "100 lbs"
      const rPart = parts[1]?.trim(); // "12,12,12"

      if (prevDisplayMode === 'lbs') {
        return wPart || prevStr;
      }

      if (prevDisplayMode === 'reps') {
        const repList = rPart?.split(',').map((x) => x.trim()).filter(Boolean);
        const specificRep = repList ? (repList[setIdx] ?? repList[repList.length - 1] ?? rPart) : rPart;
        return specificRep ? `${specificRep} reps` : prevStr;
      }
    }

    return prevStr;
  };

  const handleApplyPrevToSet = (exIdx: number, setIdx: number) => {
    const ex = exercises[exIdx];
    if (!ex) return;
    const s = ex.sets[setIdx];
    if (!s) return;

    // Parse prev weight & reps from prevStr (e.g., "60 lbs × 12,12,12" or "60 lbs × 10")
    let targetWeight = '';
    let targetReps = '';

    const text = s.prevStr || '';
    if (text.includes('×')) {
      const parts = text.split('×');
      const wPart = parts[0]?.replace(/lbs/i, '').trim();
      const rPart = parts[1]?.trim();
      if (wPart && wPart !== '-') targetWeight = wPart;

      if (rPart && rPart !== '-') {
        // If reps is a comma-separated list like "12,12,12", pick this set's index or the last one
        const repList = rPart.split(',').map((x) => x.trim()).filter(Boolean);
        if (repList.length > 0) {
          targetReps = repList[setIdx] ?? repList[repList.length - 1];
        }
      }
    } else {
      if (ex.prevWeight) targetWeight = ex.prevWeight;
      if (ex.prevReps) {
        const repList = ex.prevReps.split(',').map((x) => x.trim()).filter(Boolean);
        targetReps = repList[setIdx] ?? repList[repList.length - 1] ?? ex.prevReps;
      }
    }

    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[exIdx] };
      const targetSets = [...targetEx.sets];
      const cur = targetSets[setIdx];

      // Cycling logic:
      // 1. If empty or differs -> Fill BOTH LBS & REPS
      // 2. If both match -> Keep LBS only, clear REPS
      // 3. If LBS only -> Keep REPS only, clear LBS
      // 4. If REPS only -> Clear both back to empty
      const hasBoth = cur.weightLbs === targetWeight && cur.repsStr === targetReps;
      const hasWeightOnly = cur.weightLbs === targetWeight && cur.repsStr === '';
      const hasRepsOnly = cur.weightLbs === '' && cur.repsStr === targetReps;

      if (!cur.weightLbs && !cur.repsStr) {
        targetSets[setIdx] = { ...cur, weightLbs: targetWeight, repsStr: targetReps };
      } else if (hasBoth) {
        targetSets[setIdx] = { ...cur, weightLbs: targetWeight, repsStr: '' };
      } else if (hasWeightOnly) {
        targetSets[setIdx] = { ...cur, weightLbs: '', repsStr: targetReps };
      } else if (hasRepsOnly) {
        targetSets[setIdx] = { ...cur, weightLbs: '', repsStr: '' };
      } else {
        targetSets[setIdx] = { ...cur, weightLbs: targetWeight, repsStr: targetReps };
      }

      targetEx.sets = targetSets;
      updated[exIdx] = targetEx;
      return updated;
    });
  };

  const openDurationPicker = (target: 'default' | string) => {
    const sec = target === 'default' ? defaultRestSec : (exerciseRestSecMap[target] ?? defaultRestSec);
    setEditingDurationTarget(target);
    setPickerMinutes(Math.floor(sec / 60));
    setPickerSeconds(sec % 60);
  };

  const confirmDurationPicker = () => {
    if (!editingDurationTarget) return;
    const totalSec = Math.max(5, pickerMinutes * 60 + pickerSeconds);
    if (editingDurationTarget === 'default') {
      setDefaultRestSec(totalSec);
      setActiveRestTotal(totalSec);
      setActiveRestRemaining(totalSec);
    } else {
      setExerciseRestSecMap((prev) => ({ ...prev, [editingDurationTarget]: totalSec }));
    }
    setEditingDurationTarget(null);
  };

  const stepMinutes = (delta: number) => {
    setPickerMinutes((prev) => Math.max(0, Math.min(10, prev + delta)));
  };

  const stepSeconds = (delta: number) => {
    setPickerSeconds((prev) => {
      let next = prev + delta;
      if (next < 0) next = 45;
      if (next > 55) next = 0;
      return next;
    });
  };

  // Wheel Dragging state
  const [isDraggingMin, setIsDraggingMin] = useState(false);
  const dragStartYMin = useRef(0);
  const dragStartMin = useRef(1);

  const [isDraggingSec, setIsDraggingSec] = useState(false);
  const dragStartYSec = useRef(0);
  const dragStartSec = useRef(30);

  const handleMinPointerDown = (e: any) => {
    e.stopPropagation?.();
    const clientY =
      e.clientY ??
      e.nativeEvent?.clientY ??
      e.nativeEvent?.pageY ??
      e.nativeEvent?.touches?.[0]?.pageY ??
      0;
    try {
      e.target?.setPointerCapture?.(e.pointerId);
    } catch {}
    setIsDraggingMin(true);
    dragStartYMin.current = clientY;
    dragStartMin.current = pickerMinutes;
  };

  const handleMinPointerMove = (e: any) => {
    if (!isDraggingMin) return;
    e.stopPropagation?.();
    const clientY =
      e.clientY ??
      e.nativeEvent?.clientY ??
      e.nativeEvent?.pageY ??
      e.nativeEvent?.touches?.[0]?.pageY ??
      0;
    const dy = dragStartYMin.current - clientY;
    const deltaMins = Math.round(dy / 25);
    const next = Math.max(0, Math.min(15, dragStartMin.current + deltaMins));
    setPickerMinutes(next);
  };

  const handleMinPointerUp = (e?: any) => {
    try {
      if (e?.target?.releasePointerCapture && e?.pointerId !== undefined) {
        e.target.releasePointerCapture(e.pointerId);
      }
    } catch {}
    setIsDraggingMin(false);
  };

  const handleSecPointerDown = (e: any) => {
    e.stopPropagation?.();
    const clientY =
      e.clientY ??
      e.nativeEvent?.clientY ??
      e.nativeEvent?.pageY ??
      e.nativeEvent?.touches?.[0]?.pageY ??
      0;
    try {
      e.target?.setPointerCapture?.(e.pointerId);
    } catch {}
    setIsDraggingSec(true);
    dragStartYSec.current = clientY;
    dragStartSec.current = pickerSeconds;
  };

  const handleSecPointerMove = (e: any) => {
    if (!isDraggingSec) return;
    e.stopPropagation?.();
    const clientY =
      e.clientY ??
      e.nativeEvent?.clientY ??
      e.nativeEvent?.pageY ??
      e.nativeEvent?.touches?.[0]?.pageY ??
      0;
    const dy = dragStartYSec.current - clientY;
    const deltaSteps = Math.round(dy / 15);
    const deltaSecs = deltaSteps * 5;
    let next = dragStartSec.current + deltaSecs;
    while (next < 0) next += 60;
    next = next % 60;
    setPickerSeconds(next);
  };

  const handleSecPointerUp = (e?: any) => {
    try {
      if (e?.target?.releasePointerCapture && e?.pointerId !== undefined) {
        e.target.releasePointerCapture(e.pointerId);
      }
    } catch {}
    setIsDraggingSec(false);
  };

  // Set type selector modal
  const [activeSetPicker, setActiveSetPicker] = useState<{ exIdx: number; setIdx: number } | null>(null);

  // Exercise 3-dots options modal
  const [activeExerciseMenuIdx, setActiveExerciseMenuIdx] = useState<number | null>(null);
  const [showReplaceInput, setShowReplaceInput] = useState(false);
  const [replaceNameInput, setReplaceNameInput] = useState('');

  // New exercise modal
  const [showAddExModal, setShowAddExModal] = useState(false);
  const [newExName, setNewExName] = useState('');

  // Finish summary modal
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Live Workout Stopwatch Timer
  useEffect(() => {
    let timer: any;
    if (isTimerRunning) {
      timer = setInterval(() => {
        setSeconds(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isTimerRunning]);

  // Rest Timer Countdown Effect
  useEffect(() => {
    let interval: any;
    if (isRestTimerActive && activeRestRemaining > 0) {
      interval = setInterval(() => {
        setActiveRestRemaining((prev) => {
          if (prev <= 1) {
            setIsRestTimerActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRestTimerActive, activeRestRemaining]);

  const startRestTimer = (secondsToRest?: number) => {
    const sec = secondsToRest ?? activeRestTotal;
    setActiveRestTotal(sec);
    setActiveRestRemaining(sec);
    setIsRestTimerActive(true);
  };

  const adjustRestTimer = (deltaSec: number) => {
    setActiveRestRemaining((prev) => Math.max(0, prev + deltaSec));
    setActiveRestTotal((prev) => Math.max(15, prev + deltaSec));
  };

  const formatTimer = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  };

  const formatRestSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(m)}:${pad(s)}`;
  };

  const formatRestHuman = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (s === 0) return `${m}m 00s`;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  // Load routine template and previous exercise performance
  useEffect(() => {
    let live = true;
    (async () => {
      const existing = getSession();
      if (existing && existing.focusKey === focusKeyParam && existing.date === dateParam) {
        setFocusName(existing.focusName);
        setNotes(existing.notes);
        setExercises(existing.exercises as ActiveExercise[]);
        setDefaultRestSec(existing.defaultRestSec);
        setExerciseRestSecMap(existing.exerciseRestSecMap);
        setActiveRestTotal(existing.restTotal);
        const remaining = existing.restEndsAt
          ? Math.ceil((existing.restEndsAt - Date.now()) / 1000)
          : 0;
        if (remaining > 0) {
          setActiveRestRemaining(remaining);
          setIsRestTimerActive(true);
        } else {
          setActiveRestRemaining(existing.restTotal);
          setIsRestTimerActive(false);
        }
        setReady(true);
        return;
      }
      const [customMap, templateNames] = await Promise.all([
        getCustomFocusLabels(db),
        getTemplateExercises(db, focusKeyParam),
      ]);

      if (!live) return;
      setFocusName(focusLabel(focusKeyParam, customMap));

      const list: ActiveExercise[] = await Promise.all(
        templateNames.map(async (name, idx) => {
          const last = await lastEntryForExercise(db, name, dateParam);
          const prevWeight = last?.weight_lbs ?? null;
          const prevReps = last?.reps ?? null;
          const defaultSets = last?.sets ?? 3;

          let prevStr = '-';
          if (prevWeight !== null && prevReps !== null) {
            prevStr = `${prevWeight} lbs × ${prevReps}`;
          } else if (prevWeight !== null) {
            prevStr = `${prevWeight} lbs`;
          }

          const sets: ActiveSetRow[] = [];
          for (let s = 1; s <= defaultSets; s++) {
            sets.push({
              setNumber: s,
              prevStr: prevStr,
              weightLbs: '',
              repsStr: '',
              completed: false,
            });
          }

          return {
            id: `${name}-${idx}`,
            name,
            prevWeight,
            prevReps,
            sets,
          };
        }),
      );

      if (live) {
        setExercises(list);
        setReady(true);
      }
    })();

    return () => {
      live = false;
    };
  }, [db, focusKeyParam, dateParam]);

  // Keep the in-memory session up to date so minimizing never loses progress
  useEffect(() => {
    if (!ready || finishedRef.current) return;
    saveSession({
      focusKey: focusKeyParam,
      date: dateParam,
      focusName,
      startedAt: startedAtRef.current,
      notes,
      exercises: exercises as any,
      defaultRestSec,
      exerciseRestSecMap,
      restTotal: activeRestTotal,
      restEndsAt: isRestTimerActive ? Date.now() + activeRestRemaining * 1000 : null,
    });
  }, [
    ready,
    focusKeyParam,
    dateParam,
    focusName,
    notes,
    exercises,
    defaultRestSec,
    exerciseRestSecMap,
    activeRestTotal,
    isRestTimerActive,
    activeRestRemaining,
  ]);

  // Set completion toggle (Turns green when completed & starts rest timer!)
  const toggleSetComplete = (exIdx: number, setIdx: number) => {
    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[exIdx] };
      const targetSets = [...targetEx.sets];
      const curr = targetSets[setIdx];
      const nextCompleted = !curr.completed;
      targetSets[setIdx] = { ...curr, completed: nextCompleted };
      targetEx.sets = targetSets;
      updated[exIdx] = targetEx;

      // Automatically trigger rest timer when a set is completed!
      if (nextCompleted) {
        const customRest = exerciseRestSecMap[targetEx.name] ?? defaultRestSec;
        startRestTimer(customRest);
      }

      return updated;
    });
  };

  const updateSetWeight = (exIdx: number, setIdx: number, val: string) => {
    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[exIdx] };
      const targetSets = [...targetEx.sets];
      targetSets[setIdx] = { ...targetSets[setIdx], weightLbs: val };
      targetEx.sets = targetSets;
      updated[exIdx] = targetEx;
      return updated;
    });
  };

  const commitSetWeight = (exIdx: number, setIdx: number) => {
    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[exIdx] };
      const targetSets = [...targetEx.sets];
      const sourceWeight = targetSets[setIdx]?.weightLbs;
      if (sourceWeight && sourceWeight.trim()) {
        for (let i = setIdx + 1; i < targetSets.length; i++) {
          if (!targetSets[i].completed && !targetSets[i].weightLbs) {
            targetSets[i] = { ...targetSets[i], weightLbs: sourceWeight.trim() };
          }
        }
      }
      targetEx.sets = targetSets;
      updated[exIdx] = targetEx;
      return updated;
    });
  };

  const updateSetReps = (exIdx: number, setIdx: number, val: string) => {
    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[exIdx] };
      const targetSets = [...targetEx.sets];
      targetSets[setIdx] = { ...targetSets[setIdx], repsStr: val };
      targetEx.sets = targetSets;
      updated[exIdx] = targetEx;
      return updated;
    });
  };

  const commitSetReps = (exIdx: number, setIdx: number) => {
    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[exIdx] };
      const targetSets = [...targetEx.sets];
      const sourceReps = targetSets[setIdx]?.repsStr;
      if (sourceReps && sourceReps.trim()) {
        for (let i = setIdx + 1; i < targetSets.length; i++) {
          if (!targetSets[i].completed && !targetSets[i].repsStr) {
            targetSets[i] = { ...targetSets[i], repsStr: sourceReps.trim() };
          }
        }
      }
      targetEx.sets = targetSets;
      updated[exIdx] = targetEx;
      return updated;
    });
  };

  const addSetToExercise = (exIdx: number) => {
    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[exIdx] };
      const targetSets = [...targetEx.sets];
      const lastSet = targetSets[targetSets.length - 1];
      const nextNum = targetSets.length + 1;

      targetSets.push({
        setNumber: nextNum,
        prevStr: lastSet?.prevStr ?? '-',
        weightLbs: lastSet?.weightLbs || '',
        repsStr: lastSet?.repsStr || '',
        completed: false,
      });

      targetEx.sets = targetSets;
      updated[exIdx] = targetEx;
      return updated;
    });
  };

  const handleChangeSetType = (setType: SetType) => {
    if (!activeSetPicker) return;
    const { exIdx, setIdx } = activeSetPicker;
    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[exIdx] };
      const targetSets = [...targetEx.sets];
      targetSets[setIdx] = { ...targetSets[setIdx], setType };
      targetEx.sets = targetSets;
      updated[exIdx] = targetEx;
      return updated;
    });
    setActiveSetPicker(null);
  };

  const handleRemoveActiveSet = () => {
    if (!activeSetPicker) return;
    const { exIdx, setIdx } = activeSetPicker;
    removeSetFromExercise(exIdx, setIdx);
    setActiveSetPicker(null);
  };

  const removeSetFromExercise = (exIdx: number, setIdx: number) => {
    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[exIdx] };
      const targetSets = targetEx.sets
        .filter((_, i) => i !== setIdx)
        .map((s, i) => ({ ...s, setNumber: i + 1 }));
      targetEx.sets = targetSets;
      updated[exIdx] = targetEx;
      return updated;
    });
  };

  const removeExerciseFromActive = (exIdx: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== exIdx));
  };

  const handleReplaceExercise = async (newExerciseName: string) => {
    if (activeExerciseMenuIdx === null || !newExerciseName.trim()) return;
    const name = newExerciseName.trim();
    const last = await lastEntryForExercise(db, name, dateParam);
    const prevWeight = last?.weight_lbs ?? null;
    const prevReps = last?.reps ?? null;
    let prevStr = '-';
    if (prevWeight !== null && prevReps !== null) {
      prevStr = `${prevWeight} lbs × ${prevReps}`;
    } else if (prevWeight !== null) {
      prevStr = `${prevWeight} lbs`;
    }

    setExercises((prev) => {
      const updated = [...prev];
      const targetEx = { ...updated[activeExerciseMenuIdx] };
      targetEx.name = name;
      targetEx.prevWeight = prevWeight;
      targetEx.prevReps = prevReps;
      targetEx.sets = targetEx.sets.map((s) => ({
        ...s,
        prevStr,
        weightLbs: prevWeight ? String(prevWeight) : s.weightLbs,
        repsStr: prevReps ? String(prevReps).split(',')[0]?.trim() || '12' : s.repsStr,
      }));
      updated[activeExerciseMenuIdx] = targetEx;
      return updated;
    });

    setActiveExerciseMenuIdx(null);
    setShowReplaceInput(false);
    setReplaceNameInput('');
  };

  const handleAddNewExercise = () => {
    if (!newExName.trim()) return;
    const name = newExName.trim();
    setExercises((prev) => [
      ...prev,
      {
        id: `${name}-${Date.now()}`,
        name,
        prevWeight: null,
        prevReps: null,
        sets: [
          { setNumber: 1, prevStr: '-', weightLbs: '', repsStr: '', completed: false },
          { setNumber: 2, prevStr: '-', weightLbs: '', repsStr: '', completed: false },
          { setNumber: 3, prevStr: '-', weightLbs: '', repsStr: '', completed: false },
        ],
      },
    ]);
    setNewExName('');
    setShowAddExModal(false);
  };

  // Workout Summary Stats
  const workoutSummary = useMemo(() => {
    let completedSetsCount = 0;
    let totalVolumeLbs = 0;
    let exercisesCompletedCount = 0;

    for (const ex of exercises) {
      let exHasCompleted = false;
      for (const s of ex.sets) {
        if (s.completed) {
          completedSetsCount++;
          exHasCompleted = true;
          const w = parseNumber(s.weightLbs) ?? 0;
          const r = parseNumber(s.repsStr) ?? 0;
          if (w > 0 && r > 0) {
            totalVolumeLbs += w * r;
          }
        }
      }
      if (exHasCompleted) exercisesCompletedCount++;
    }

    return {
      completedSetsCount,
      totalVolumeLbs: Math.round(totalVolumeLbs),
      exercisesCompletedCount,
    };
  }, [exercises]);

  const discardWorkout = () => {
    finishedRef.current = true;
    clearSession();
    router.replace('/(tabs)/workout');
  };

  const handleCancelWorkout = () => {
    setShowCancelConfirmModal(true);
  };

  const handleFinishWorkout = async () => {
    setFinishing(true);
    try {
      // Save all completed exercises to SQLite
      for (const ex of exercises) {
        const completedSets = ex.sets.filter((s) => s.completed);
        const setList = completedSets.length > 0 ? completedSets : ex.sets;
        if (setList.length === 0) continue;

        const repsArray: string[] = [];
        let totalWeightNum: number | null = null;
        let lastWeightStr: string | null = null;

        for (const s of setList) {
          const wNum = parseNumber(s.weightLbs);
          if (wNum !== null) {
            totalWeightNum = wNum;
            lastWeightStr = s.weightLbs;
          } else if (ex.prevWeight) {
            totalWeightNum = parseNumber(ex.prevWeight);
            lastWeightStr = ex.prevWeight;
          }
          const defaultRep = ex.prevReps ? String(ex.prevReps).split(',')[0]?.trim() || '12' : '12';
          repsArray.push(s.repsStr || defaultRep);
        }

        const repsJoined = repsArray.join(',');

        await insertWorkoutEntry(db, {
          date: dateParam,
          focusKey: focusKeyParam,
          exercise: ex.name,
          weightLbs: lastWeightStr,
          weightLbsNum: totalWeightNum,
          sets: setList.length,
          reps: repsJoined,
        });
      }

      await recalculateAll(db);
      setShowFinishModal(false);
      finishedRef.current = true;
      clearSession();
      router.replace('/(tabs)/workout');
    } finally {
      setFinishing(false);
    }
  };

  if (!ready) {
    return (
      <SafeAreaView style={[st.safeArea, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={C.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safeArea} edges={['top']}>
      {/* 1. TOP HEADER WITH CLICKABLE TIMER & FINISH */}
      <View style={st.headerBar}>
        <Pressable
          onPress={() => router.back()}
          style={st.headerIconBtn}
          hitSlop={8}
        >
          <Ionicons name="chevron-down" size={24} color={C.text} />
        </Pressable>

        {/* Clickable Timer / Rest Countdown */}
        <Pressable
          onPress={() => setShowRestTimerModal(true)}
          style={({ pressed }) => [
            st.timerContainer,
            isRestTimerActive && st.timerContainerRestActive,
            pressed && { opacity: 0.8 },
          ]}
        >
          {isRestTimerActive ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="hourglass" size={15} color="#38BDF8" />
              <Txt size="sm" weight="900" color="#38BDF8">
                {`REST ${formatRestSec(activeRestRemaining)}`}
              </Txt>
              <View style={st.timerDivider} />
              <Txt size="xs" weight="800" color={C.dim}>
                {formatTimer(seconds)}
              </Txt>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="time-outline" size={16} color={C.accent} />
              <Txt size="lg" weight="900" color={C.text} style={{ letterSpacing: 0.5 }}>
                {formatTimer(seconds)}
              </Txt>
              <Ionicons name="timer-outline" size={13} color={C.dim} style={{ marginLeft: 2 }} />
            </View>
          )}
        </Pressable>

        {/* Finish Workout Action Button */}
        <Pressable
          onPress={() => setShowFinishModal(true)}
          style={st.finishHeaderBtn}
        >
          <Txt size="sm" weight="900" color="#fff">
            Finish
          </Txt>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={st.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Workout Routine Title & Date */}
        <View style={{ gap: 2, paddingHorizontal: 4 }}>
          <Txt size="xxl" weight="900" color={C.text} style={{ letterSpacing: -0.6 }}>
            {focusName}
          </Txt>
          <Txt size="xs" color={C.dim} weight="600">
            {`${formatDayLabel(dateParam)} · Active Session`}
          </Txt>
        </View>

        {/* Workout Notes Box */}
        <View style={st.notesCard}>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Your workout notes…"
            placeholderTextColor={C.dimmer}
            style={{
              color: C.text,
              fontSize: 14,
              fontWeight: '500',
              padding: 0,
              outlineStyle: 'none',
            } as any}
          />
        </View>

        {/* 2. EXERCISE CARDS LIST */}
        <View style={{ gap: 14 }}>
          {exercises.map((ex, exIdx) => {
            const cat = getExerciseCategoryIcon(ex.name);
            return (
              <Card key={ex.id} style={st.exerciseCard}>
                {/* Exercise Header */}
                <View style={st.exerciseCardHeader}>
                  <View style={[st.avatarCircle, { backgroundColor: cat.bg }]}>
                    <Ionicons name={cat.icon} size={18} color={cat.color} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Txt size="md" weight="800" color={C.text}>
                      {ex.name}
                    </Txt>
                  </View>

                  <Pressable
                    onPress={() => {
                      setActiveExerciseMenuIdx(exIdx);
                      setShowReplaceInput(false);
                      setReplaceNameInput('');
                    }}
                    style={{ padding: 4 }}
                    hitSlop={8}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={C.dim} />
                  </Pressable>
                </View>

                {/* Table Column Headers */}
                <View style={st.tableHeaderRow}>
                  <Txt size="xs" color={C.dimmer} weight="800" style={st.colSet}>
                    SET
                  </Txt>

                  {/* PREV Header - Clean toggle between PREV LBS & PREV REPS */}
                  <Pressable
                    onPress={togglePrevDisplayMode}
                    hitSlop={8}
                    style={st.colPrevHeaderBtn}
                  >
                    <Txt
                      size="xs"
                      color={C.accent}
                      weight="800"
                      style={{ fontSize: 10, letterSpacing: -0.2 }}
                    >
                      {prevDisplayMode === 'lbs' ? 'PREV LBS' : 'PREV REPS'}
                    </Txt>
                    <Ionicons
                      name="swap-horizontal"
                      size={9}
                      color={C.accent}
                      style={{ marginLeft: 2 }}
                    />
                  </Pressable>

                  <Txt size="xs" color={C.dimmer} weight="800" style={st.colLbs}>
                    LBS
                  </Txt>
                  <Txt size="xs" color={C.dimmer} weight="800" style={st.colReps}>
                    REPS
                  </Txt>
                  <View style={st.colCheck} />
                </View>

                {/* Set Rows */}
                <View style={{ gap: 8 }}>
                  {ex.sets.map((s, sIdx) => {
                    const badge =
                      s.setType === 'WARMUP'
                        ? { text: 'W', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' }
                        : s.setType === 'FAILURE'
                          ? { text: 'F', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)' }
                          : s.setType === 'DROP'
                            ? { text: 'D', color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.15)' }
                            : { text: String(s.setNumber), color: C.text, bg: C.surfaceAlt };

                    return (
                      <View
                        key={s.setNumber}
                        style={[
                          st.setRow,
                          s.completed && st.setRowCompleted,
                        ]}
                      >
                        {/* Set Type / Number Button (Tap to select set type) */}
                        <View style={st.colSet}>
                          <Pressable
                            onPress={() => setActiveSetPicker({ exIdx, setIdx: sIdx })}
                            style={[
                              st.setNumCircle,
                              { backgroundColor: badge.bg },
                              s.completed && { backgroundColor: 'transparent' },
                            ]}
                          >
                            <Txt
                              size="sm"
                              weight="900"
                              color={s.completed ? '#ffffff' : badge.color}
                            >
                              {badge.text}
                            </Txt>
                          </Pressable>
                        </View>

                        {/* Previous Performance Container (Tappable: switches or fills, shows cycled unit) */}
                        <View style={st.colPrev}>
                          <Pressable
                            onPress={() => {
                              togglePrevDisplayMode();
                              handleApplyPrevToSet(exIdx, sIdx);
                            }}
                            hitSlop={4}
                            style={({ pressed }) => [
                              st.prevContainerBtn,
                              s.completed && st.prevContainerBtnCompleted,
                              pressed && { opacity: 0.7 },
                            ]}
                          >
                            <Txt
                              size="xs"
                              color={s.completed ? '#E2E8F0' : C.dim}
                              weight="700"
                              numberOfLines={1}
                              align="center"
                            >
                              {formatPrevDisplay(s.prevStr, sIdx)}
                            </Txt>
                          </Pressable>
                        </View>

                        {/* Weight LBS Input */}
                        <View style={st.colLbs}>
                          <View style={[st.inputBox, s.completed && st.inputBoxCompleted]}>
                            <TextInput
                              value={s.weightLbs}
                              onChangeText={(v) => updateSetWeight(exIdx, sIdx, v)}
                              onBlur={() => commitSetWeight(exIdx, sIdx)}
                              onSubmitEditing={() => commitSetWeight(exIdx, sIdx)}
                              keyboardType="numeric"
                              placeholder="-"
                              placeholderTextColor={s.completed ? 'rgba(255,255,255,0.4)' : C.dimmer}
                              style={{
                                color: s.completed ? '#ffffff' : C.text,
                                fontSize: 16,
                                fontWeight: '800',
                                textAlign: 'center',
                                padding: 4,
                                outlineStyle: 'none',
                                width: '100%',
                              } as any}
                            />
                          </View>
                        </View>

                        {/* Reps Input */}
                        <View style={st.colReps}>
                          <View style={[st.inputBox, s.completed && st.inputBoxCompleted]}>
                            <TextInput
                              value={s.repsStr}
                              onChangeText={(v) => updateSetReps(exIdx, sIdx, v)}
                              onBlur={() => commitSetReps(exIdx, sIdx)}
                              onSubmitEditing={() => commitSetReps(exIdx, sIdx)}
                              keyboardType="numeric"
                              placeholder="-"
                              placeholderTextColor={s.completed ? 'rgba(255,255,255,0.4)' : C.dimmer}
                              style={{
                                color: s.completed ? '#ffffff' : C.text,
                                fontSize: 16,
                                fontWeight: '800',
                                textAlign: 'center',
                                padding: 4,
                                outlineStyle: 'none',
                                width: '100%',
                              } as any}
                            />
                          </View>
                        </View>

                        {/* Checkmark Button (Turns GREEN when completed!) */}
                        <View style={st.colCheck}>
                          <Pressable
                            onPress={() => toggleSetComplete(exIdx, sIdx)}
                            style={[
                              st.checkBtn,
                              s.completed && st.checkBtnCompleted,
                            ]}
                          >
                            <Ionicons
                              name="checkmark"
                              size={18}
                              color={s.completed ? '#080B10' : C.dimmer}
                            />
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* + ADD SET BUTTON */}
                <Pressable
                  onPress={() => addSetToExercise(exIdx)}
                  style={({ pressed }) => [st.addSetBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="add" size={16} color={C.dim} />
                  <Txt size="xs" weight="800" color={C.dim} style={{ letterSpacing: 0.6 }}>
                    ADD SET
                  </Txt>
                </Pressable>
              </Card>
            );
          })}
        </View>

        {/* 3. ADD EXERCISE & FINISH ACTIONS */}
        <View style={{ gap: 10, marginTop: 4 }}>
          <Button
            title="+ Add Exercise to Session"
            variant="secondary"
            onPress={() => setShowAddExModal(true)}
          />

          <Button
            title="Finish Workout Session"
            onPress={() => setShowFinishModal(true)}
          />

          <Button
            title="Cancel Workout"
            variant="danger"
            onPress={handleCancelWorkout}
          />
        </View>
      </ScrollView>

      {/* ======================================================== */}
      {/* REST TIMER POPUP MODAL (HEVY / STRONG STYLE)             */}
      {/* ======================================================== */}
      <Modal
        visible={showRestTimerModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRestTimerModal(false)}
      >
        <Pressable style={st.modalOverlay} onPress={() => setShowRestTimerModal(false)}>
          <Pressable style={st.modalCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={{ gap: 16 }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="lg" weight="900" color={C.text}>
                  Rest Timer
                </Txt>
                <Pressable onPress={() => setShowRestTimerModal(false)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={22} color={C.dim} />
                </Pressable>
              </View>

              {/* Top Countdown Dial & Controls Row */}
              <View style={st.restTimerTopRow}>
                {/* Circular Dial */}
                <View style={st.restDialContainer}>
                  <Txt size="xxl" weight="900" color={C.text}>
                    {formatRestSec(activeRestRemaining)}
                  </Txt>
                  <Txt size="xs" color={C.dim} weight="600">
                    {formatRestSec(activeRestTotal)}
                  </Txt>
                </View>

                {/* Right Controls: Start / Pause & Step Buttons */}
                <View style={{ flex: 1, gap: 10 }}>
                  <Pressable
                    onPress={() => {
                      if (isRestTimerActive) {
                        setIsRestTimerActive(false);
                        setActiveRestRemaining(0);
                        setShowRestTimerModal(false);
                      } else {
                        if (activeRestRemaining <= 0) {
                          startRestTimer(activeRestTotal);
                        } else {
                          setIsRestTimerActive(true);
                        }
                      }
                    }}
                    style={st.restStartBtn}
                  >
                    <Txt size="md" weight="900" color="#fff">
                      {isRestTimerActive ? 'Skip' : 'Start'}
                    </Txt>
                  </Pressable>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      onPress={() => adjustRestTimer(-15)}
                      style={st.restStepPill}
                    >
                      <Txt size="sm" weight="800" color={C.text}>
                        -15
                      </Txt>
                    </Pressable>
                    <Pressable
                      onPress={() => adjustRestTimer(15)}
                      style={st.restStepPill}
                    >
                      <Txt size="sm" weight="800" color={C.text}>
                        +15
                      </Txt>
                    </Pressable>
                  </View>
                </View>
              </View>

              <Divider />

              {/* Default Exercise Timer */}
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ gap: 2 }}>
                    <Txt size="sm" weight="800" color={C.text}>
                      Default Exercise Timer
                    </Txt>
                    <Txt size="xs" color={C.dim} weight="600">
                      {`Current default: ${formatRestHuman(defaultRestSec)}`}
                    </Txt>
                  </View>

                  <Pressable
                    onPress={() => openDurationPicker('default')}
                    style={st.timerEditBtn}
                  >
                    <Txt size="xs" weight="800" color="#fff">
                      Edit
                    </Txt>
                  </Pressable>
                </View>
              </View>

              <Divider />

              {/* Per-Exercise Custom Rest Timer List */}
              <View style={{ gap: 10, maxHeight: 220 }}>
                <Txt size="xs" color={C.dimmer} weight="800" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Per-Exercise Custom Rest Timers
                </Txt>

                <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                  <View style={{ gap: 8 }}>
                    {exercises.map((ex) => {
                      const cat = getExerciseCategoryIcon(ex.name);
                      const currentSec = exerciseRestSecMap[ex.name] ?? defaultRestSec;

                      return (
                        <View key={ex.id} style={st.exTimerRow}>
                          <View style={[st.exTimerAvatar, { backgroundColor: cat.bg }]}>
                            <Ionicons name={cat.icon} size={15} color={cat.color} />
                          </View>

                          <Txt size="sm" weight="700" color={C.text} style={{ flex: 1 }} numberOfLines={1}>
                            {ex.name}
                          </Txt>

                          <Pressable
                            onPress={() => openDurationPicker(ex.name)}
                            style={st.exTimerPill}
                          >
                            <Txt size="xs" weight="800" color={C.text}>
                              {formatRestHuman(currentSec)}
                            </Txt>
                            <Ionicons name="pencil" size={11} color={C.dim} />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL: ADD EXERCISE TO ACTIVE WORKOUT */}
      <Modal
        visible={showAddExModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddExModal(false)}
      >
        <Pressable style={st.modalOverlay} onPress={() => setShowAddExModal(false)}>
          <Pressable style={st.modalCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="lg" weight="900" color={C.text}>
                  Add Exercise
                </Txt>
                <Pressable onPress={() => setShowAddExModal(false)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </Pressable>
              </View>

              <TextField
                label="Exercise Name"
                value={newExName}
                onChangeText={setNewExName}
                placeholder="e.g. Lateral Raises, Cable Flyes…"
                autoCapitalize="words"
              />

              <Button
                title="+ Add to Workout"
                onPress={handleAddNewExercise}
                disabled={!newExName.trim()}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL: FINISH WORKOUT CONFIRMATION */}
      <Modal
        visible={showFinishModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFinishModal(false)}
      >
        <Pressable style={st.modalOverlay} onPress={() => setShowFinishModal(false)}>
          <Pressable style={st.modalCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="xl" weight="900" color={C.text}>
                  Complete Workout
                </Txt>
                <Pressable onPress={() => setShowFinishModal(false)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </Pressable>
              </View>

              <Txt size="sm" color={C.dim}>
                Great job! Ready to log this session and update your progressive overload analytics?
              </Txt>

              <View style={st.finishStatsGrid}>
                <View style={st.finishStatBox}>
                  <Txt size="xs" color={C.dim} weight="700">DURATION</Txt>
                  <Txt size="lg" weight="900" color={C.text}>{formatTimer(seconds)}</Txt>
                </View>
                <View style={st.finishStatBox}>
                  <Txt size="xs" color={C.accent} weight="700">SETS DONE</Txt>
                  <Txt size="lg" weight="900" color={C.accent}>{workoutSummary.completedSetsCount}</Txt>
                </View>
                <View style={st.finishStatBox}>
                  <Txt size="xs" color={C.kcal} weight="700">VOLUME</Txt>
                  <Txt size="lg" weight="900" color={C.kcal}>{`${fmtInt(workoutSummary.totalVolumeLbs)} lbs`}</Txt>
                </View>
              </View>

              <Button
                title={finishing ? 'Saving Workout…' : '✓ Complete & Save to Diary'}
                onPress={handleFinishWorkout}
                disabled={finishing}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL: SELECT SET TYPE (HEVY / STRONG STYLE) */}
      <Modal
        visible={activeSetPicker !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveSetPicker(null)}
      >
        <Pressable style={st.modalOverlay} onPress={() => setActiveSetPicker(null)}>
          <Pressable style={st.modalCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt size="lg" weight="900" color={C.text}>
                  Select Set Type
                </Txt>
                <Pressable onPress={() => setActiveSetPicker(null)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </Pressable>
              </View>

              <View style={{ gap: 6 }}>
                {/* W · Warm Up Set */}
                <Pressable
                  onPress={() => handleChangeSetType('WARMUP')}
                  style={({ pressed }) => [st.setTypeOptionRow, pressed && { opacity: 0.7 }]}
                >
                  <View style={[st.setTypeIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                    <Txt size="md" weight="900" color="#F59E0B">
                      W
                    </Txt>
                  </View>
                  <Txt size="md" weight="800" color={C.text}>
                    Warm Up Set
                  </Txt>
                </Pressable>

                {/* 1 · Normal Set */}
                <Pressable
                  onPress={() => handleChangeSetType('NORMAL')}
                  style={({ pressed }) => [st.setTypeOptionRow, pressed && { opacity: 0.7 }]}
                >
                  <View style={st.setTypeIconBox}>
                    <Txt size="md" weight="900" color={C.text}>
                      1
                    </Txt>
                  </View>
                  <Txt size="md" weight="800" color={C.text}>
                    Normal Set
                  </Txt>
                </Pressable>

                {/* F · Failure Set */}
                <Pressable
                  onPress={() => handleChangeSetType('FAILURE')}
                  style={({ pressed }) => [st.setTypeOptionRow, pressed && { opacity: 0.7 }]}
                >
                  <View style={[st.setTypeIconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                    <Txt size="md" weight="900" color="#EF4444">
                      F
                    </Txt>
                  </View>
                  <Txt size="md" weight="800" color={C.text}>
                    Failure Set
                  </Txt>
                </Pressable>

                {/* D · Drop Set */}
                <Pressable
                  onPress={() => handleChangeSetType('DROP')}
                  style={({ pressed }) => [st.setTypeOptionRow, pressed && { opacity: 0.7 }]}
                >
                  <View style={[st.setTypeIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                    <Txt size="md" weight="900" color="#38BDF8">
                      D
                    </Txt>
                  </View>
                  <Txt size="md" weight="800" color={C.text}>
                    Drop Set
                  </Txt>
                </Pressable>

                <Divider />

                {/* 🗑️ Remove Set */}
                <Pressable
                  onPress={handleRemoveActiveSet}
                  style={({ pressed }) => [st.setTypeOptionRow, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }, pressed && { opacity: 0.7 }]}
                >
                  <View style={[st.setTypeIconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                    <Ionicons name="trash-outline" size={18} color={C.danger} />
                  </View>
                  <Txt size="md" weight="800" color={C.danger}>
                    Remove Set
                  </Txt>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL: EXERCISE OPTIONS (OPENED FROM 3-DOTS ON EXERCISE CARD) */}
      <Modal
        visible={activeExerciseMenuIdx !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveExerciseMenuIdx(null)}
      >
        <Pressable style={st.modalOverlay} onPress={() => setActiveExerciseMenuIdx(null)}>
          <Pressable style={st.modalCard} onPress={(e) => e.stopPropagation?.()}>
            {activeExerciseMenuIdx !== null && exercises[activeExerciseMenuIdx] ? (
              <View style={{ gap: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Txt size="lg" weight="900" color={C.text}>
                    {exercises[activeExerciseMenuIdx].name}
                  </Txt>
                  <Pressable onPress={() => setActiveExerciseMenuIdx(null)} style={{ padding: 4 }}>
                    <Ionicons name="close" size={20} color={C.dim} />
                  </Pressable>
                </View>

                <View style={{ gap: 8 }}>
                  {/* Replace Exercise */}
                  {showReplaceInput ? (
                    <View style={st.replaceInputBox}>
                      <TextField
                        label="Replacement Exercise Name"
                        value={replaceNameInput}
                        onChangeText={setReplaceNameInput}
                        placeholder="e.g. Incline Dumbbell Press, Cable Flyes…"
                        autoCapitalize="words"
                      />
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                        <Button
                          title="Replace"
                          small
                          onPress={() => handleReplaceExercise(replaceNameInput)}
                          disabled={!replaceNameInput.trim()}
                        />
                        <Button
                          title="Cancel"
                          variant="ghost"
                          small
                          onPress={() => {
                            setShowReplaceInput(false);
                            setReplaceNameInput('');
                          }}
                        />
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => setShowReplaceInput(true)}
                      style={({ pressed }) => [st.setTypeOptionRow, pressed && { opacity: 0.7 }]}
                    >
                      <View style={[st.setTypeIconBox, { backgroundColor: C.accentSoft }]}>
                        <Ionicons name="swap-horizontal" size={18} color={C.accent} />
                      </View>
                      <Txt size="md" weight="800" color={C.text}>
                        Replace Exercise
                      </Txt>
                    </Pressable>
                  )}

                  <Divider />

                  {/* Remove Exercise */}
                  <Pressable
                    onPress={() => {
                      const idx = activeExerciseMenuIdx;
                      setActiveExerciseMenuIdx(null);
                      removeExerciseFromActive(idx);
                    }}
                    style={({ pressed }) => [st.setTypeOptionRow, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }, pressed && { opacity: 0.7 }]}
                  >
                    <View style={[st.setTypeIconBox, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                      <Ionicons name="trash-outline" size={18} color={C.danger} />
                    </View>
                    <Txt size="md" weight="800" color={C.danger}>
                      Remove Exercise
                    </Txt>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL: REST TIMER DURATION (MINUTES & SECONDS PICKER) */}
      <Modal
        visible={editingDurationTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingDurationTarget(null)}
      >
        <Pressable style={st.modalOverlay} onPress={() => setEditingDurationTarget(null)}>
          <Pressable style={st.durationPickerCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={{ gap: 18 }}>
              <Txt size="lg" weight="900" color={C.text}>
                Rest Timer Duration
              </Txt>

              {/* Minutes & Seconds Wheel Display (Hold & Drag up/down) */}
              <View style={st.wheelRow}>
                {/* Minutes Column */}
                <View
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={handleMinPointerDown}
                  onResponderMove={handleMinPointerMove}
                  onResponderRelease={handleMinPointerUp}
                  onResponderTerminate={handleMinPointerUp}
                  onPointerDown={handleMinPointerDown}
                  onPointerMove={handleMinPointerMove}
                  onPointerUp={handleMinPointerUp}
                  onPointerCancel={handleMinPointerUp}
                  style={[
                    st.wheelCol,
                    isDraggingMin && { backgroundColor: C.surfaceHi, borderRadius: 12 },
                    Platform.OS === 'web' && ({
                      cursor: isDraggingMin ? 'grabbing' : 'grab',
                      touchAction: 'none',
                      userSelect: 'none',
                    } as any),
                  ]}
                >
                  <Pressable onPress={() => stepMinutes(1)} style={st.wheelGhostRow}>
                    <Txt size="lg" weight="700" color={C.dimmer}>
                      {String(Math.min(15, pickerMinutes + 1)).padStart(2, '0')}
                    </Txt>
                  </Pressable>

                  <View style={[st.wheelActiveRow, isDraggingMin && { borderColor: C.accent }]}>
                    <Txt size="xxl" weight="900" color={C.text}>
                      {String(pickerMinutes).padStart(2, '0')}
                    </Txt>
                    <Txt size="md" weight="800" color={C.text} style={{ marginLeft: 4 }}>
                      m
                    </Txt>
                  </View>

                  <Pressable onPress={() => stepMinutes(-1)} style={st.wheelGhostRow}>
                    <Txt size="lg" weight="700" color={C.dimmer}>
                      {String(Math.max(0, pickerMinutes - 1)).padStart(2, '0')}
                    </Txt>
                  </Pressable>
                </View>

                {/* Seconds Column */}
                <View
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={handleSecPointerDown}
                  onResponderMove={handleSecPointerMove}
                  onResponderRelease={handleSecPointerUp}
                  onResponderTerminate={handleSecPointerUp}
                  onPointerDown={handleSecPointerDown}
                  onPointerMove={handleSecPointerMove}
                  onPointerUp={handleSecPointerUp}
                  onPointerCancel={handleSecPointerUp}
                  style={[
                    st.wheelCol,
                    isDraggingSec && { backgroundColor: C.surfaceHi, borderRadius: 12 },
                    Platform.OS === 'web' && ({
                      cursor: isDraggingSec ? 'grabbing' : 'grab',
                      touchAction: 'none',
                      userSelect: 'none',
                    } as any),
                  ]}
                >
                  <Pressable onPress={() => stepSeconds(15)} style={st.wheelGhostRow}>
                    <Txt size="lg" weight="700" color={C.dimmer}>
                      {String((pickerSeconds + 15) % 60).padStart(2, '0')}
                    </Txt>
                  </Pressable>

                  <View style={[st.wheelActiveRow, isDraggingSec && { borderColor: '#38BDF8' }]}>
                    <Txt size="xxl" weight="900" color={C.text}>
                      {String(pickerSeconds).padStart(2, '0')}
                    </Txt>
                    <Txt size="md" weight="800" color={C.text} style={{ marginLeft: 4 }}>
                      s
                    </Txt>
                  </View>

                  <Pressable onPress={() => stepSeconds(-15)} style={st.wheelGhostRow}>
                    <Txt size="lg" weight="700" color={C.dimmer}>
                      {String((pickerSeconds - 15 + 60) % 60).padStart(2, '0')}
                    </Txt>
                  </Pressable>
                </View>
              </View>

              <Txt size="xs" color={C.dimmer} align="center">
                ↕ Drag minutes or seconds up &amp; down
              </Txt>

              {/* Action Buttons: Cancel / Confirm */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <Pressable
                  onPress={() => setEditingDurationTarget(null)}
                  style={st.durationCancelBtn}
                >
                  <Txt size="sm" weight="800" color={C.text}>
                    Cancel
                  </Txt>
                </Pressable>

                <Pressable
                  onPress={confirmDurationPicker}
                  style={st.durationConfirmBtn}
                >
                  <Txt size="sm" weight="900" color="#fff">
                    Confirm
                  </Txt>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Cancel Workout Confirmation Modal */}
      <ConfirmModal
        visible={showCancelConfirmModal}
        title="Cancel Workout"
        message="Are you sure you want to cancel this workout? Nothing will be saved and all progress will be lost."
        confirmText="Cancel Workout"
        cancelText="Keep Training"
        danger
        onConfirm={() => {
          setShowCancelConfirmModal(false);
          discardWorkout();
        }}
        onCancel={() => setShowCancelConfirmModal(false)}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.bg,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerIconBtn: {
    padding: 6,
    borderRadius: 8,
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surfaceAlt,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  timerContainerRestActive: {
    backgroundColor: '#0E1F2D',
    borderColor: '#38BDF8',
  },
  timerDivider: {
    width: 1,
    height: 14,
    backgroundColor: C.borderLight,
    marginHorizontal: 2,
  },
  finishHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#38BDF8', // Cyan finish button
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    shadowColor: '#38BDF8',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  notesCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  exerciseCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 12,
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  setRowCompleted: {
    backgroundColor: '#1B3524', // Deep green olive background for completed sets
    borderWidth: 1,
    borderColor: '#10B981',
  },
  colSet: {
    width: 36,
    alignItems: 'center',
  },
  setNumCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colPrev: {
    flex: 1.2,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  colPrevHeaderBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prevContainerBtn: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prevContainerBtnCompleted: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  colLbs: {
    width: 72,
    marginRight: 6,
  },
  colReps: {
    width: 62,
    marginRight: 6,
  },
  colCheck: {
    width: 38,
    alignItems: 'center',
  },
  inputBox: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBoxCompleted: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  checkBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  checkBtnCompleted: {
    backgroundColor: '#10B981', // Turn GREEN when set completed!
    borderColor: '#10B981',
    shadowColor: '#10B981',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: C.surfaceAlt,
    borderRadius: 8,
    paddingVertical: 8,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 12,
  },
  restTimerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  restDialContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0C1C2A',
    gap: 2,
  },
  restStartBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#38BDF8',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  restStepPill: {
    flex: 1,
    backgroundColor: C.surfaceHi,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  timerEditBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  exTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
  },
  exTimerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exTimerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  finishStatsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  finishStatBox: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: C.border,
  },
  setTypeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  setTypeIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replaceInputBox: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
    gap: 6,
  },
  durationPickerCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: C.borderLight,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  wheelRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    paddingVertical: 8,
  },
  wheelCol: {
    alignItems: 'center',
    gap: 12,
    width: 90,
  },
  wheelGhostRow: {
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelActiveRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    width: '100%',
  },
  durationCancelBtn: {
    flex: 1,
    backgroundColor: C.surfaceHi,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  durationConfirmBtn: {
    flex: 1,
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#38BDF8',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
});
