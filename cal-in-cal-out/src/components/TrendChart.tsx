import React from 'react';
import { useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop } from 'react-native-svg';

import { C } from '@/constants/theme';
import { formatShortDate } from '@/lib/date';
import { EmptyHint, Txt } from '@/components/ui';

export interface ChartPoint {
  date: string;
  value: number | null;
}

export function TrendChart({
  data,
  type = 'line',
  dots,
  secondary,
  secondaryColor,
  target,
  height = 220,
  color = C.accent,
  yFormat = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toString() : n.toFixed(1)),
  targetLabel = 'target',
}: {
  data: ChartPoint[];
  type?: 'line' | 'bars';
  dots?: ChartPoint[];
  secondary?: ChartPoint[];
  secondaryColor?: string;
  target?: number | null;
  height?: number;
  color?: string;
  yFormat?: (n: number) => string;
  targetLabel?: string;
}) {
  const { width } = useWindowDimensions();
  const chartW = Math.min(width - 40, 680);
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const plotW = Math.max(10, chartW - padL - padR);
  const plotH = Math.max(10, height - padT - padB);

  const allValues: number[] = [];
  for (const p of data) if (p.value !== null) allValues.push(p.value);
  for (const p of dots ?? []) if (p.value !== null) allValues.push(p.value);
  for (const p of secondary ?? []) if (p.value !== null) allValues.push(p.value);
  if (target !== null && target !== undefined) allValues.push(target);
  if (allValues.length === 0) return <EmptyHint title="No data yet" sub="Start logging to see your trend" />;

  let min: number;
  let max: number;

  if (type === 'bars') {
    min = 0;
    const highest = Math.max(...allValues);
    max = Math.max(1200, Math.round(highest * 1.15));
  } else {
    min = Math.min(...allValues);
    max = Math.max(...allValues);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const padding = (max - min) * 0.08;
    min -= padding;
    max += padding;
  }

  const n = data.length;
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => padT + plotH - ((v - min) / (max - min)) * plotH;

  const ticks = [0, 1, 2, 3].map((k) => min + ((max - min) * k) / 3);

  let linePath = '';
  let areaPath = '';
  let started = false;
  let lastX = 0;
  data.forEach((p, i) => {
    if (p.value === null) return;
    const x = xAt(i);
    const y = yAt(p.value);
    if (!started) {
      linePath += `M${x.toFixed(1)},${y.toFixed(1)} `;
      areaPath += `M${x.toFixed(1)},${(padT + plotH).toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)} `;
      started = true;
    } else {
      linePath += `L${x.toFixed(1)},${y.toFixed(1)} `;
      areaPath += `L${x.toFixed(1)},${y.toFixed(1)} `;
    }
    lastX = x;
  });
  if (started) {
    areaPath += `L${lastX.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
  }

  let secPath = '';
  let secStarted = false;
  (secondary ?? []).forEach((p, i) => {
    if (p.value === null) return;
    const cmd = secStarted ? 'L' : 'M';
    secPath += `${cmd}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)} `;
    secStarted = true;
  });

  const barW = Math.max(3, (plotW / Math.max(1, n)) * 0.64);
  const gradId = `chartGrad_${type}_${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <View style={{ width: chartW, height, position: 'relative' }}>
        <Svg width={chartW} height={height}>
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <Stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </LinearGradient>
          </Defs>

          {/* Grid lines */}
          {ticks.map((t, k) => (
            <Line
              key={`tick-${k}`}
              x1={padL}
              x2={padL + plotW}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke={C.border}
              strokeWidth={1}
              strokeDasharray={k === 0 ? undefined : '3 3'}
            />
          ))}

          {/* Bars or Area + Line */}
          {type === 'bars' ? (
            data.map((p, i) =>
              p.value === null ? null : (
                <Rect
                  key={`bar-${i}`}
                  x={xAt(i) - barW / 2}
                  y={yAt(p.value)}
                  width={barW}
                  height={Math.max(0, padT + plotH - yAt(p.value))}
                  fill={color}
                  opacity={0.88}
                  rx={3}
                />
              ),
            )
          ) : (
            <>
              {areaPath ? <Path d={areaPath} fill={`url(#${gradId})`} /> : null}
              {linePath ? <Path d={linePath} stroke={color} strokeWidth={2.8} fill="none" /> : null}
            </>
          )}

          {/* Secondary Line */}
          {secPath && secondaryColor ? (
            <Path
              d={secPath}
              stroke={secondaryColor}
              strokeWidth={2}
              fill="none"
              strokeDasharray="5 4"
            />
          ) : null}

          {/* Raw Dots */}
          {(dots ?? []).map((p, i) =>
            p.value === null ? null : (
              <Circle
                key={`dot-${i}`}
                cx={xAt(i)}
                cy={yAt(p.value)}
                r={2.8}
                fill={C.text}
                stroke={C.bg}
                strokeWidth={1}
                opacity={0.8}
              />
            ),
          )}

          {/* Target Line */}
          {target !== null && target !== undefined && target >= min && target <= max ? (
            <Line
              x1={padL}
              x2={padL + plotW}
              y1={yAt(target)}
              y2={yAt(target)}
              stroke={C.warn}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          ) : null}
        </Svg>

        {/* Y-Axis Labels */}
        <View style={{ position: 'absolute', top: 0, bottom: padB, left: 0, width: padL - 4 }}>
          {ticks.map((t, k) => (
            <View
              key={k}
              style={{
                position: 'absolute',
                top: yAt(t) - 7,
                left: 0,
                right: 4,
                alignItems: 'flex-end',
              }}
            >
              <Txt size="xs" color={C.dimmer} weight="600">
                {yFormat(t)}
              </Txt>
            </View>
          ))}
        </View>

        {/* X-Axis Date Labels (Positioned cleanly at bottom) */}
        <View
          style={{
            position: 'absolute',
            left: padL,
            right: padR,
            bottom: 4,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          {n > 0 ? (
            <>
              <Txt size="xs" color={C.dimmer} weight="600">
                {formatShortDate(data[0].date)}
              </Txt>
              {n > 2 ? (
                <Txt size="xs" color={C.dimmer} weight="600">
                  {formatShortDate(data[Math.floor((n - 1) / 2)].date)}
                </Txt>
              ) : null}
              {n > 1 ? (
                <Txt size="xs" color={C.dimmer} weight="600">
                  {formatShortDate(data[n - 1].date)}
                </Txt>
              ) : null}
            </>
          ) : null}
        </View>
      </View>

      {/* Target Legend (Separated cleanly below chart) */}
      {target !== null && target !== undefined ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 6,
            alignSelf: 'flex-end',
            paddingRight: padR,
          }}
        >
          <View style={{ width: 14, height: 2, backgroundColor: C.warn, borderRadius: 1 }} />
          <Txt size="xs" color={C.warn} weight="700">
            {targetLabel === 'target' ? `Target (${yFormat(target)})` : targetLabel}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
