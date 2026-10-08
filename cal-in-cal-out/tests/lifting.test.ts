import { epley1rm, parseRepsAverage } from '../src/lib/lifting';

const cases = [
  ['12,12,10', 11.333333],
  ['12,12,12', 12],
  ['15,15,20>10', 16.666667],
  ['3-5', 3],
  ['10 (per leg)', 10],
  ['band 3 -> 3 neg', 3],
  ['Failure', null],
  [null, null],
  ['12, 8, 10', 10],
  ['tbh', null],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = parseRepsAverage(input as string | null);
  const ok =
    expected === null
      ? got === null
      : got !== null && typeof expected === 'number' && Math.abs(got - expected) < 0.001;
  if (!ok) { console.log(`FAIL ${JSON.stringify(input)} -> ${got}, want ${expected}`); failed++; }
}
const oneRm = epley1rm(27.5, 12);
if (Math.abs(oneRm - 38.5) > 0.01) { console.log(`FAIL epley 27.5x12 = ${oneRm}, want 38.5`); failed++; }
console.log(failed === 0 ? 'all lifting helper tests passed' : `${failed} failures`);
process.exit(failed === 0 ? 0 : 1);
