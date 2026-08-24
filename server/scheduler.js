const ATTEMPTS = [
  { name: 'balanced', dayOffset: 0, hardBias: 0 },
  { name: 'early-hard', dayOffset: 1, hardBias: -10 },
  { name: 'compact', dayOffset: 2, hardBias: 6 },
  { name: 'spread', dayOffset: 3, hardBias: 12 },
  { name: 'reverse', dayOffset: 4, reverse: true }
];

export function generateSchedule({ classes, assignments, settings, classIds, weekMode }) {
  const days = settings.days.filter((day) => day.enabled);
  const maxCount = maxPeriodCount(settings);
  const periods = Array.from({ length: maxCount }, (_, i) => ({ number: i + 1 }));
  const selected = classes.filter((item) => classIds.includes(item.id));
  const variants = weekMode === 'two' ? ['odd', 'even'] : ['single'];
  const attempts = ATTEMPTS.map((strategy) => buildSchedule({ selected, assignments, settings, days, periods, variants, weekMode, strategy }));
  return attempts.sort((a, b) => scheduleScore(a) - scheduleScore(b))[0];
}

// Each (education level, shift) has its own bell schedule (start + per-lesson duration/break).
function timetableFor(settings, level, shift) {
  const t = settings.timetables?.[level]?.[shift];
  if (t && Array.isArray(t.periods) && t.periods.length) return t;
  const start = settings.levelStarts?.[level]?.[shift]
    || (settings.shifts || []).find((s) => s.id === shift)?.startsAt
    || (shift === 'afternoon' ? '14:00' : '08:30');
  return { start, periods: settings.periods || [] };
}

function maxPeriodCount(settings) {
  let max = 0;
  const timetables = settings.timetables || {};
  for (const level of Object.keys(timetables)) {
    for (const shift of Object.keys(timetables[level] || {})) {
      max = Math.max(max, (timetables[level][shift]?.periods || []).length);
    }
  }
  if (!max) max = (settings.periods || []).length || 7;
  return max;
}

function buildSchedule({ selected, assignments, settings, days, periods, variants, weekMode, strategy }) {
  const busy = { teachers: new Map(), rooms: new Map() };
  const payload = {
    title: weekMode === 'two' ? 'Расписание на четную и нечетную недели' : 'Расписание на одну неделю',
    weekMode,
    days,
    periods,
    shifts: settings.shifts || [],
    levelStarts: settings.levelStarts || {},
    timetables: settings.timetables || {},
    classMeta: {},
    classes: {},
    diagnostics: [],
    quality: { strategy: strategy.name, score: 0 }
  };

  const classOrder = [...selected].sort((a, b) => {
    const ah = assignmentHours(assignments, a.id);
    const bh = assignmentHours(assignments, b.id);
    if (bh !== ah) return bh - ah;
    return classKey(a).localeCompare(classKey(b), 'ru');
  });
  if (strategy.reverse) classOrder.reverse();

  for (const schoolClass of classOrder) {
    const key = classKey(schoolClass);
    const shift = schoolClass.shift || 'morning';
    const classPeriods = timetableFor(settings, schoolClass.level, shift).periods;
    payload.classMeta[key] = { shift, level: schoolClass.level };
    payload.classes[key] = {};
    for (const variant of variants) payload.classes[key][variant] = emptyGrid(days, periods);

    for (const variant of variants) {
      const classLessons = lessonsForClass(assignments, schoolClass.id, strategy, variant, weekMode);
      for (const lesson of classLessons) {
        const slot = bestSlot({
          grid: payload.classes[key][variant],
          days,
          periods: classPeriods,
          lesson,
          busy,
          settings,
          schoolClass,
          shift,
          variant,
          strategy
        });
        if (!slot) {
          payload.diagnostics.push({
            level: 'warning',
            className: key,
            week: variant,
            message: `Не удалось поставить ${lesson.subjectName}`
          });
          continue;
        }
        const cell = {
          subject: lesson.subjectName,
          teacher: lesson.teacherName || 'Не назначен',
          teacherId: lesson.teacherId || null,
          room: lesson.roomName || '',
          roomId: lesson.roomId || null,
          difficulty: lesson.difficulty,
          paired: lesson.paired ? 1 : 0
        };
        payload.classes[key][variant][slot.day.id][slot.period.number] = cell;
        reserveResource({ busy, settings, variant, level: schoolClass.level, shift, dayId: slot.day.id, period: slot.period, lesson });
      }
    }
  }

  payload.quality = {
    strategy: strategy.name,
    score: scheduleScore(payload),
    diagnostics: payload.diagnostics.length,
    classWindows: totalClassWindows(payload),
    lateHardLessons: lateHardLessons(payload),
    difficultyImbalance: totalDifficultyImbalance(payload)
  };
  return payload;
}

function lessonsForClass(assignments, classId, strategy, variant = 'single', weekMode = 'one') {
  return assignments
    .filter((item) => item.classId === classId)
    .flatMap((item) => expandAssignment(item, variant, weekMode))
    .sort((a, b) => {
      const constraintDelta = lessonConstraintWeight(b) - lessonConstraintWeight(a);
      if (constraintDelta !== 0) return constraintDelta;
      const difficultyDelta = (b.difficulty + strategy.hardBias / 100) - (a.difficulty + strategy.hardBias / 100);
      if (difficultyDelta !== 0) return difficultyDelta;
      return a.subjectName.localeCompare(b.subjectName, 'ru');
    });
}

function lessonCountForVariant(weeklyHours, variant, weekMode) {
  const hours = Number(weeklyHours) || 0;
  if (hours <= 0) return 0;
  const whole = Math.floor(hours);
  const frac = hours - whole;
  let count = whole;
  if (frac >= 0.5) {
    // half-hour = one lesson every two weeks: in two-week mode only the odd week gets it;
    // in a single-week schedule it becomes one lesson that week.
    if (weekMode === 'two') { if (variant === 'odd') count += 1; }
    else count += 1;
  }
  return count;
}

function expandAssignment(item, variant = 'single', weekMode = 'one') {
  const count = lessonCountForVariant(item.weeklyHours, variant, weekMode);
  return Array.from({ length: count }, (_, index) => ({ ...item, copy: index }));
}

function lessonConstraintWeight(lesson) {
  return Number(Boolean(lesson.teacherId)) * 4 + Number(Boolean(lesson.roomId)) * 3 + Number(lesson.difficulty || 3);
}

function emptyGrid(days, periods) {
  const grid = {};
  for (const day of days) {
    grid[day.id] = {};
    for (const period of periods) grid[day.id][period.number] = null;
  }
  return grid;
}

function bestSlot({ grid, days, periods, lesson, busy, settings, schoolClass, shift, variant, strategy }) {
  const candidates = [];
  for (const day of rotateDays(days, strategy.dayOffset)) {
    for (const period of periods) {
      if (grid[day.id][period.number]) continue;
      const hardBlock = violatesHardRules({ grid, day, period, lesson, busy, settings, schoolClass, shift, variant });
      if (hardBlock) continue;
      candidates.push({
        day,
        period,
        score: slotScore({ grid, days, day, period, periods, lesson, settings, schoolClass, shift, strategy })
      });
    }
  }
  return candidates.sort((a, b) => a.score - b.score || a.period.number - b.period.number)[0] || null;
}

function violatesHardRules({ grid, day, period, lesson, busy, settings, schoolClass, shift, variant }) {
  if (dayLoad(grid, day.id) >= maxLessons(settings, schoolClass.grade)) return true;
  if (dayDifficulty(grid, day.id) + lesson.difficulty > maxDailyDifficulty(settings, schoolClass.grade)) return true;
  if (isScheduleBlocked(settings, day.id, period.number, shift, schoolClass.id)) return true;
  if (isTeacherUnavailable(settings, lesson.teacherId, day.id, period.number, shift)) return true;
  if (isOutsideAvailability(settings, lesson.teacherId, day.id, period.number)) return true;
  if (lesson.teacherId && resourceBusy(busy.teachers, settings, variant, schoolClass.level, shift, lesson.teacherId, day.id, period)) return true;
  if (lesson.roomId && resourceBusy(busy.rooms, settings, variant, schoolClass.level, shift, lesson.roomId, day.id, period)) return true;
  return false;
}

function slotScore({ grid, days, day, period, periods, lesson, settings, schoolClass, shift, strategy }) {
  const beforeLoad = dayLoad(grid, day.id);
  const projectedGrid = cloneGrid(grid);
  projectedGrid[day.id][period.number] = { subject: lesson.subjectName, difficulty: lesson.difficulty };
  const targetLoad = targetDayLoad(grid, days);
  const loadPenalty = Math.abs((beforeLoad + 1) - targetLoad) * 12;
  const difficultyPenalty = Math.max(0, dayDifficulty(projectedGrid, day.id) - averageDifficulty(projectedGrid, days)) * 3;
  const sameSubjectPeriodsToday = Object.entries(grid[day.id] || {})
    .filter(([, cell]) => cell?.subject === lesson.subjectName)
    .map(([number]) => Number(number));
  const repeatPenalty = lesson.paired ? 0 : (sameSubjectPeriodsToday.length ? 80 : 0);
  const spreadPenalty = lesson.paired ? 0 : sameSubjectNearDays(grid, days, day.id, lesson.subjectName) * 16;
  const pairPenalty = pairAdjacencyPenalty(lesson, sameSubjectPeriodsToday, period.number);
  const periodPenalty = preferredPeriodPenalty(period.number, lesson.difficulty);
  const gapPenalty = classWindowCount(projectedGrid) * (strategy.name === 'compact' ? 32 : 20);
  const leadingGapPenalty = leadingEmptyBefore(grid, periods, day.id, period.number, settings, shift, schoolClass) * 26;
  const lateHardPenalty = lesson.difficulty >= 4 && period.number >= 5 ? 34 : 0;
  const firstLessonEasyPenalty = lesson.difficulty <= 2 && period.number === 1 ? 8 : 0;
  const overloadRisk = dayDifficulty(projectedGrid, day.id) / maxDailyDifficulty(settings, schoolClass.grade);
  return loadPenalty + difficultyPenalty + repeatPenalty + spreadPenalty + pairPenalty + periodPenalty + gapPenalty + leadingGapPenalty + lateHardPenalty + firstLessonEasyPenalty + overloadRisk;
}

// Count empty, non-blocked periods before `periodNumber` on this day for the class.
// School blocks (e.g. Разговоры о важном) don't count — the day may legitimately start later there.
function leadingEmptyBefore(grid, periods, dayId, periodNumber, settings, shift, schoolClass) {
  let gaps = 0;
  for (const p of periods) {
    if (p.number >= periodNumber) break;
    if (grid[dayId]?.[p.number]) continue;
    if (isScheduleBlocked(settings, dayId, p.number, shift, schoolClass.id)) continue;
    gaps += 1;
  }
  return gaps;
}

function pairAdjacencyPenalty(lesson, sameSubjectPeriodsToday, periodNumber) {
  if (!lesson.paired || !sameSubjectPeriodsToday.length) return 0;
  const adjacent = sameSubjectPeriodsToday.some((number) => Math.abs(number - periodNumber) === 1);
  return adjacent ? -140 : 90;
}

function preferredPeriodPenalty(periodNumber, difficulty) {
  if (difficulty >= 5) return ({ 1: 6, 2: 0, 3: 2, 4: 8, 5: 26, 6: 42, 7: 60 })[periodNumber] ?? 80;
  if (difficulty === 4) return ({ 1: 8, 2: 2, 3: 0, 4: 6, 5: 20, 6: 36, 7: 50 })[periodNumber] ?? 70;
  if (difficulty === 3) return ({ 1: 12, 2: 6, 3: 2, 4: 0, 5: 8, 6: 18, 7: 30 })[periodNumber] ?? 50;
  return ({ 1: 24, 2: 14, 3: 8, 4: 2, 5: 0, 6: 4, 7: 10 })[periodNumber] ?? 30;
}

function reserveResource({ busy, settings, variant, level, shift, dayId, period, lesson }) {
  const interval = periodInterval(settings, level, shift, period.number);
  if (lesson.teacherId) addBusy(busy.teachers, variant, lesson.teacherId, dayId, interval);
  if (lesson.roomId) addBusy(busy.rooms, variant, lesson.roomId, dayId, interval);
}

function resourceBusy(store, settings, variant, level, shift, resourceId, dayId, period) {
  const interval = periodInterval(settings, level, shift, period.number);
  const entries = store.get(resourceBusyKey(variant, resourceId, dayId)) || [];
  return entries.some((item) => intervalsOverlap(item, interval));
}

function addBusy(store, variant, resourceId, dayId, interval) {
  const key = resourceBusyKey(variant, resourceId, dayId);
  const entries = store.get(key) || [];
  entries.push(interval);
  store.set(key, entries);
}

function resourceBusyKey(variant, resourceId, dayId) {
  return `${variant}:${resourceId}:${dayId}`;
}

function periodInterval(settings, level, shiftId, periodNumber) {
  const tt = timetableFor(settings, level, shiftId);
  let cursor = timeToMinutes(tt.start);
  for (const period of [...tt.periods].sort((a, b) => Number(a.number) - Number(b.number))) {
    const start = cursor;
    const end = start + Number(period.duration || 40);
    if (Number(period.number) === Number(periodNumber)) return { start, end };
    cursor = end + Number(period.breakAfter || 0);
  }
  return { start: cursor, end: cursor + 40 };
}

function intervalsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '08:30').split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function rotateDays(days, offset) {
  if (!days.length) return days;
  return days.map((_, index) => days[(index + offset) % days.length]);
}

function targetDayLoad(grid, days) {
  const loads = days.map((day) => dayLoad(grid, day.id));
  return (loads.reduce((sum, value) => sum + value, 0) + 1) / Math.max(1, days.length);
}

function averageDifficulty(grid, days) {
  const values = days.map((day) => dayDifficulty(grid, day.id));
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function cloneGrid(grid) {
  return Object.fromEntries(Object.entries(grid).map(([dayId, periods]) => [dayId, { ...periods }]));
}

function dayLoad(grid, dayId) {
  return Object.values(grid[dayId] || {}).filter(Boolean).length;
}

function dayDifficulty(grid, dayId) {
  return Object.values(grid[dayId] || {}).reduce((sum, cell) => sum + Number(cell?.difficulty || 0), 0);
}

function subjectCount(grid, dayId, subjectName) {
  return Object.values(grid[dayId] || {}).filter((cell) => cell?.subject === subjectName).length;
}

function subjectAlreadyOnDay(grid, dayId, subjectName) {
  return subjectCount(grid, dayId, subjectName) > 0;
}

function sameSubjectNearDays(grid, days, dayId, subjectName) {
  const index = days.findIndex((day) => day.id === dayId);
  return [-1, 1].reduce((sum, delta) => {
    const neighbor = days[index + delta];
    return sum + (neighbor ? subjectCount(grid, neighbor.id, subjectName) : 0);
  }, 0);
}

function classWindowCount(grid) {
  let windows = 0;
  for (const periods of Object.values(grid)) {
    const used = Object.keys(periods).map(Number).filter((number) => periods[number]).sort((a, b) => a - b);
    if (used.length <= 1) continue;
    for (let number = used[0]; number <= used[used.length - 1]; number += 1) {
      if (!periods[number]) windows += 1;
    }
  }
  return windows;
}

function totalClassWindows(payload) {
  let total = 0;
  for (const classWeeks of Object.values(payload.classes)) {
    for (const grid of Object.values(classWeeks)) total += classWindowCount(grid);
  }
  return total;
}

function lateHardLessons(payload) {
  let total = 0;
  for (const classWeeks of Object.values(payload.classes)) {
    for (const grid of Object.values(classWeeks)) {
      for (const periods of Object.values(grid)) {
        for (const [number, cell] of Object.entries(periods)) {
          if (cell?.difficulty >= 4 && Number(number) >= 5) total += 1;
        }
      }
    }
  }
  return total;
}

function totalDifficultyImbalance(payload) {
  let total = 0;
  for (const classWeeks of Object.values(payload.classes)) {
    for (const grid of Object.values(classWeeks)) {
      const values = payload.days.map((day) => dayDifficulty(grid, day.id));
      const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      total += values.reduce((sum, value) => sum + Math.abs(value - average), 0);
    }
  }
  return Math.round(total);
}

function scheduleScore(payload) {
  return (
    payload.diagnostics.length * 100000 +
    totalClassWindows(payload) * 550 +
    lateHardLessons(payload) * 180 +
    totalDifficultyImbalance(payload) * 16 +
    repeatedSubjects(payload) * 220
  );
}

function repeatedSubjects(payload) {
  let total = 0;
  for (const classWeeks of Object.values(payload.classes)) {
    for (const grid of Object.values(classWeeks)) {
      for (const day of payload.days) {
        const counts = new Map();
        for (const cell of Object.values(grid[day.id] || {})) {
          if (!cell?.subject || cell.paired) continue;
          counts.set(cell.subject, (counts.get(cell.subject) || 0) + 1);
        }
        for (const count of counts.values()) if (count > 1) total += count - 1;
      }
    }
  }
  return total;
}

function assignmentHours(assignments, classId) {
  return assignments.filter((item) => item.classId === classId).reduce((sum, item) => sum + Number(item.weeklyHours || 1), 0);
}

function classKey(item) {
  return `${item.grade}${item.letter}`;
}

function maxLessons(settings, grade) {
  return Number(settings.sanpin?.maxLessonsByGrade?.[grade] || settings.periods.length);
}

function maxDailyDifficulty(settings, grade) {
  return Number(settings.sanpin?.maxDailyDifficultyByGrade?.[grade] || 99);
}

function isTeacherUnavailable(settings, teacherId, dayId, periodNumber, shift) {
  if (!teacherId) return false;
  return (settings.teacherConstraints || []).some((item) => (
    item.teacherId === teacherId &&
    item.dayId === dayId &&
    (!item.shift || item.shift === shift) &&
    (item.periodNumber == null || item.periodNumber === periodNumber)
  ));
}

function isOutsideAvailability(settings, teacherId, dayId, periodNumber) {
  if (!teacherId) return false;
  const window = (settings.teacherAvailability || []).find((item) => item.teacherId === teacherId && item.dayId === dayId);
  if (!window) return false;
  if (window.dayOff) return true;
  if (window.fromPeriod != null && periodNumber < window.fromPeriod) return true;
  if (window.toPeriod != null && periodNumber > window.toPeriod) return true;
  return false;
}

function isScheduleBlocked(settings, dayId, periodNumber, shift, classId) {
  return (settings.scheduleBlocks || []).some((item) => (
    item.dayId === dayId &&
    (!item.shift || item.shift === shift) &&
    (!item.classId || item.classId === classId) &&
    item.periodNumber === periodNumber
  ));
}
