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

  // Prepare grids + per-class context.
  const ctxByKey = {};
  for (const schoolClass of classOrder) {
    const key = classKey(schoolClass);
    const shift = schoolClass.shift || 'morning';
    const classPeriods = timetableFor(settings, schoolClass.level, shift).periods;
    payload.classMeta[key] = { shift, level: schoolClass.level, id: schoolClass.id };
    payload.classes[key] = {};
    for (const variant of variants) payload.classes[key][variant] = emptyGrid(days, periods);
    ctxByKey[key] = { schoolClass, key, shift, classPeriods };
  }

  const maxP = periods.length;
  const priority = teacherPriorityMap(settings, assignments, selected, days, maxP);
  payload.teacherOverload = Object.values(priority.stats)
    .filter((s) => s.load > s.capacity)
    .map((s) => ({ teacher: s.name, lessons: s.load, slots: s.capacity, deficit: s.load - s.capacity }))
    .sort((a, b) => b.deficit - a.deficit);

  for (const variant of variants) {
    // Build one global list of all lessons across classes, then order so that the
    // most constrained teachers (day-offs/windows/tight availability) place first.
    const queue = [];
    for (const schoolClass of classOrder) {
      const ctx = ctxByKey[classKey(schoolClass)];
      for (const lesson of lessonsForClass(assignments, schoolClass.id, strategy, variant, weekMode)) {
        queue.push({ lesson, ctx });
      }
    }
    queue.sort((a, b) => {
      const pa = lessonPlacementRank(a.lesson, priority);
      const pb = lessonPlacementRank(b.lesson, priority);
      if (pa.bucket !== pb.bucket) return pa.bucket - pb.bucket;
      if (pa.tightness !== pb.tightness) return pb.tightness - pa.tightness;
      const wa = lessonConstraintWeight(a.lesson);
      const wb = lessonConstraintWeight(b.lesson);
      if (wb !== wa) return wb - wa;
      return (b.lesson.difficulty || 0) - (a.lesson.difficulty || 0);
    });

    const unplaced = [];
    for (const { lesson, ctx } of queue) {
      const { schoolClass, key, shift, classPeriods } = ctx;
      const grid = payload.classes[key][variant];
      const slot = bestSlot({ grid, days, periods: classPeriods, lesson, busy, settings, schoolClass, shift, variant, strategy });
      if (!slot) { unplaced.push({ lesson, ctx }); continue; }
      grid[slot.day.id][slot.period.number] = lessonToCell(lesson);
      reserveResource({ busy, settings, variant, level: schoolClass.level, shift, dayId: slot.day.id, period: slot.period, lesson });
    }

    // Repair pass: for lessons of constrained teachers that couldn't fit, try to relocate
    // a flexible teacher's lesson into an empty cell to free a slot the constrained teacher can use.
    for (const item of unplaced) {
      if (tryRelocateToFit(payload, item, { busy, settings, days, variant })) { item.placed = true; continue; }
      if (tryCrossClassRelocate(payload, item, { busy, settings, days, variant })) { item.placed = true; }
    }

    // Even out the day loads (all moves respect teacher/room/SanPiN constraints), then remove
    // internal gaps so lessons sit back-to-back with no empty windows between them.
    for (const schoolClass of classOrder) {
      const ctx = ctxByKey[classKey(schoolClass)];
      balanceClassDays(payload, ctx, { busy, settings, days, variant });
      compactClass(payload, ctx, { busy, settings, days, variant });
    }

    for (const { lesson, ctx, placed } of unplaced) {
      if (placed) continue;
      const { schoolClass, key, shift, classPeriods } = ctx;
      const grid = payload.classes[key][variant];
      const reason = diagnoseFailure({ grid, days, periods: classPeriods, lesson, busy, settings, schoolClass, shift, variant });
      payload.diagnostics.push({
        level: 'warning',
        className: key,
        week: variant,
        subject: lesson.subjectName,
        teacher: lesson.teacherName || 'Не назначен',
        reasonCode: reason.code,
        reason: reason.text,
        message: `Не удалось поставить ${lesson.subjectName} — ${reason.text}`
      });
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

// Free day×period slots for a teacher in ONE shift (respects day-off, arrival/departure, per-shift windows).
function slotsForShift(settings, teacherId, shift, days, maxP) {
  const rows = (settings.teacherAvailability || []).filter((a) => a.teacherId === teacherId);
  if (!rows.length) return days.length * maxP;
  const byDay = new Map(rows.map((r) => [r.dayId, r]));
  let slots = 0;
  for (const day of days) {
    const r = byDay.get(day.id);
    if (!r) { slots += maxP; continue; }
    if (r.dayOff) continue;
    const from = r.fromPeriod || 1;
    const to = r.toPeriod || maxP;
    const wins = new Set(Array.isArray(r.windows) ? r.windows : (r.windows?.[shift] || []));
    for (let n = 1; n <= maxP; n += 1) {
      if (n < from || n > to) continue;
      if (wins.has(n)) continue;
      slots += 1;
    }
  }
  return slots;
}

// Per-teacher load and available capacity across the shifts they actually teach.
function computeTeacherStats(settings, assignments, selected, days, maxP) {
  const selectedIds = new Set(selected.map((c) => c.id));
  const stats = {};
  for (const a of assignments) {
    if (!a.teacherId || !selectedIds.has(a.classId)) continue;
    const s = stats[a.teacherId] || { id: a.teacherId, name: a.teacherName || 'учитель', load: 0, shifts: new Set() };
    s.load += Number(a.weeklyHours || 1);
    s.shifts.add(a.shift || 'morning');
    stats[a.teacherId] = s;
  }
  for (const s of Object.values(stats)) {
    s.capacity = [...s.shifts].reduce((sum, sh) => sum + slotsForShift(settings, s.id, sh, days, maxP), 0);
  }
  return stats;
}

// Teachers with tighter availability (more lessons vs fewer free slots) should be placed first.
function teacherPriorityMap(settings, assignments, selected, days, maxP) {
  const stats = computeTeacherStats(settings, assignments, selected, days, maxP);
  const constrained = new Set((settings.teacherAvailability || []).map((a) => a.teacherId));
  const tightness = {};
  for (const s of Object.values(stats)) tightness[s.id] = s.load / Math.max(1, s.capacity);
  return { constrained, tightness, stats };
}

function lessonPlacementRank(lesson, priority) {
  if (!lesson.teacherId) return { bucket: 2, tightness: 0 };
  if (priority.constrained.has(lesson.teacherId)) return { bucket: 0, tightness: priority.tightness[lesson.teacherId] || 0 };
  return { bucket: 1, tightness: priority.tightness[lesson.teacherId] || 0 };
}

function lessonToCell(lesson) {
  return {
    subject: lesson.subjectName,
    teacher: lesson.teacherName || 'Не назначен',
    teacherId: lesson.teacherId || null,
    room: lesson.roomName || '',
    roomId: lesson.roomId || null,
    difficulty: lesson.difficulty,
    paired: lesson.paired ? 1 : 0
  };
}

function cellToLesson(cell) {
  return {
    subjectName: cell.subject,
    teacherName: cell.teacher,
    teacherId: cell.teacherId || null,
    roomName: cell.room,
    roomId: cell.roomId || null,
    difficulty: cell.difficulty,
    paired: cell.paired
  };
}

// Move a flexible lesson out of a slot the stuck lesson could use, into any free cell (same or other
// day), then place the stuck lesson. Keeps per-day capacity valid.
function tryRelocateToFit(payload, { lesson: L, ctx }, { busy, settings, days, variant }) {
  const { schoolClass, shift, classPeriods, key } = ctx;
  const level = schoolClass.level;
  const grid = payload.classes[key][variant];
  const cap = maxLessons(settings, schoolClass.grade);
  for (const day of days) {
    for (const period of classPeriods) {
      const cellM = grid[day.id]?.[period.number];
      if (!cellM) continue;
      if (cellM.teacherId && cellM.teacherId === L.teacherId) continue; // same teacher — swap won't help
      const mLesson = cellToLesson(cellM);
      grid[day.id][period.number] = null;
      releaseResource({ busy, settings, variant, level, shift, dayId: day.id, period, lesson: mLesson });
      const lFits = !hardBlockReason({ grid, day, period, lesson: L, busy, settings, schoolClass, shift, variant });
      if (lFits) {
        for (const d2 of days) {
          for (const p2 of classPeriods) {
            if (grid[d2.id]?.[p2.number]) continue;
            if (d2.id === day.id && p2.number === period.number) continue;
            if (hardBlockReason({ grid, day: d2, period: p2, lesson: mLesson, busy, settings, schoolClass, shift, variant })) continue;
            // tentative placement
            grid[d2.id][p2.number] = cellM;
            reserveResource({ busy, settings, variant, level, shift, dayId: d2.id, period: p2, lesson: mLesson });
            grid[day.id][period.number] = lessonToCell(L);
            reserveResource({ busy, settings, variant, level, shift, dayId: day.id, period, lesson: L });
            if (dayLoad(grid, day.id) <= cap && dayLoad(grid, d2.id) <= cap) return true;
            // revert tentative placement
            grid[day.id][period.number] = null;
            releaseResource({ busy, settings, variant, level, shift, dayId: day.id, period, lesson: L });
            grid[d2.id][p2.number] = null;
            releaseResource({ busy, settings, variant, level, shift, dayId: d2.id, period: p2, lesson: mLesson });
          }
        }
      }
      // restore M
      grid[day.id][period.number] = cellM;
      reserveResource({ busy, settings, variant, level, shift, dayId: day.id, period, lesson: mLesson });
    }
  }
  return false;
}

// Cross-class repair: the stuck teacher T has an empty, allowed slot in class C, but is busy there
// because T teaches another class C2 at that time. Move T's C2 lesson to a free slot, then place L in C.
function tryCrossClassRelocate(payload, { lesson: L, ctx }, { busy, settings, days, variant }) {
  const T = L.teacherId;
  if (!T) return false;
  const { schoolClass: C, shift, classPeriods, key } = ctx;
  const level = C.level;
  const gridC = payload.classes[key][variant];
  const capC = maxLessons(settings, C.grade);
  for (const day of days) {
    for (const period of classPeriods) {
      if (gridC[day.id]?.[period.number]) continue; // need an empty cell in C
      // L must be placeable here except for T being busy elsewhere
      if (isScheduleBlocked(settings, day.id, period.number, shift, C.id)) continue;
      if (isTeacherUnavailable(settings, T, day.id, period.number, shift)) continue;
      if (isOutsideAvailability(settings, T, day.id, period.number, shift)) continue;
      if (dayLoad(gridC, day.id) >= capC) continue;
      if (dayDifficulty(gridC, day.id) + (L.difficulty || 0) > maxDailyDifficulty(settings, C.grade)) continue;
      const wantInterval = periodInterval(settings, level, shift, period.number);
      // find C2 where T teaches at an overlapping time on this day
      for (const key2 of Object.keys(payload.classes)) {
        if (key2 === key) continue;
        const meta2 = payload.classMeta[key2];
        const grid2 = payload.classes[key2][variant];
        if (!grid2) continue;
        const periods2 = timetableFor(settings, meta2.level, meta2.shift).periods;
        for (const p2 of periods2) {
          const cell2 = grid2[day.id]?.[p2.number];
          if (!cell2 || cell2.teacherId !== T) continue;
          if (!intervalsOverlap(wantInterval, periodInterval(settings, meta2.level, meta2.shift, p2.number))) continue;
          // relocate cell2 within C2 to a free slot where T is free
          const m2 = cellToLesson(cell2);
          const c2class = { level: meta2.level, grade: gradeFromKey(key2), id: null };
          grid2[day.id][p2.number] = null;
          releaseResource({ busy, settings, variant, level: meta2.level, shift: meta2.shift, dayId: day.id, period: p2, lesson: m2 });
          let done = false;
          for (const d3 of days) {
            for (const q3 of periods2) {
              if (grid2[d3.id]?.[q3.number]) continue;
              if (d3.id === day.id && q3.number === p2.number) continue;
              if (hardBlockReason({ grid: grid2, day: d3, period: q3, lesson: m2, busy, settings, schoolClass: { level: meta2.level, grade: c2class.grade, id: findClassId(payload, key2) }, shift: meta2.shift, variant })) continue;
              // place C2 lesson at new slot, then L in C
              grid2[d3.id][q3.number] = cell2;
              reserveResource({ busy, settings, variant, level: meta2.level, shift: meta2.shift, dayId: d3.id, period: q3, lesson: m2 });
              // now verify L fits in C (T should be free now)
              if (!hardBlockReason({ grid: gridC, day, period, lesson: L, busy, settings, schoolClass: C, shift, variant })) {
                gridC[day.id][period.number] = lessonToCell(L);
                reserveResource({ busy, settings, variant, level, shift, dayId: day.id, period, lesson: L });
                done = true;
              } else {
                grid2[d3.id][q3.number] = null;
                releaseResource({ busy, settings, variant, level: meta2.level, shift: meta2.shift, dayId: d3.id, period: q3, lesson: m2 });
              }
              if (done) break;
            }
            if (done) break;
          }
          if (done) return true;
          // restore cell2
          grid2[day.id][p2.number] = cell2;
          reserveResource({ busy, settings, variant, level: meta2.level, shift: meta2.shift, dayId: day.id, period: p2, lesson: m2 });
        }
      }
    }
  }
  return false;
}

function gradeFromKey(key) {
  const m = /^(\d+)/.exec(key);
  return m ? Number(m[1]) : 1;
}

// Pull lessons up to remove empty windows between lessons (no holes inside a day).
function compactClass(payload, ctx, { busy, settings, days, variant }) {
  const { schoolClass, shift, classPeriods, key } = ctx;
  const level = schoolClass.level;
  const grid = payload.classes[key][variant];
  for (const day of days) {
    let guard = 0;
    while (guard++ < 60) {
      const used = classPeriods.filter((p) => grid[day.id]?.[p.number]).map((p) => p.number);
      if (!used.length) break;
      const last = Math.max(...used);
      const hole = classPeriods.find((p) => p.number < last && !grid[day.id]?.[p.number]);
      if (!hole) break; // no internal gap
      let moved = false;
      for (const p of classPeriods) {
        if (p.number <= hole.number) continue;
        const cell = grid[day.id]?.[p.number];
        if (!cell) continue;
        const lesson = cellToLesson(cell);
        grid[day.id][p.number] = null;
        releaseResource({ busy, settings, variant, level, shift, dayId: day.id, period: p, lesson });
        if (!hardBlockReason({ grid, day, period: hole, lesson, busy, settings, schoolClass, shift, variant })) {
          grid[day.id][hole.number] = cell;
          reserveResource({ busy, settings, variant, level, shift, dayId: day.id, period: hole, lesson });
          moved = true;
          break;
        }
        grid[day.id][p.number] = cell;
        reserveResource({ busy, settings, variant, level, shift, dayId: day.id, period: p, lesson });
      }
      if (!moved) break;
    }
  }
}

// Even out lesson counts across days (7/6 instead of 8/5). Every move is validated by
// hardBlockReason, so teacher day-offs, windows, arrival/departure and busy times are respected.
function balanceClassDays(payload, ctx, { busy, settings, days, variant }) {
  const { schoolClass, shift, classPeriods, key } = ctx;
  const level = schoolClass.level;
  const grid = payload.classes[key][variant];
  let guard = 0;
  while (guard++ < 60) {
    let heavy = null; let light = null;
    for (const day of days) {
      const load = dayLoad(grid, day.id);
      if (!heavy || load > dayLoad(grid, heavy.id)) heavy = day;
      if (!light || load < dayLoad(grid, light.id)) light = day;
    }
    if (!heavy || !light || heavy.id === light.id) break;
    if (dayLoad(grid, heavy.id) - dayLoad(grid, light.id) <= 1) break;
    const heavyUsed = classPeriods.filter((p) => grid[heavy.id]?.[p.number]).sort((a, b) => b.number - a.number);
    let moved = false;
    for (const q of heavyUsed) {
      const cell = grid[heavy.id][q.number];
      const lesson = cellToLesson(cell);
      grid[heavy.id][q.number] = null;
      releaseResource({ busy, settings, variant, level, shift, dayId: heavy.id, period: q, lesson });
      for (const p of classPeriods) {
        if (grid[light.id]?.[p.number]) continue;
        if (hardBlockReason({ grid, day: light, period: p, lesson, busy, settings, schoolClass, shift, variant })) continue;
        grid[light.id][p.number] = cell;
        reserveResource({ busy, settings, variant, level, shift, dayId: light.id, period: p, lesson });
        moved = true;
        break;
      }
      if (moved) break;
      grid[heavy.id][q.number] = cell;
      reserveResource({ busy, settings, variant, level, shift, dayId: heavy.id, period: q, lesson });
    }
    if (!moved) break;
  }
}

function findClassId(payload, key) {
  return payload.classMeta[key]?.id ?? null;
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

function violatesHardRules(args) {
  return hardBlockReason(args) != null;
}

// Returns a reason code for why this slot can't take the lesson, or null if it can.
function hardBlockReason({ grid, day, period, lesson, busy, settings, schoolClass, shift, variant }) {
  if (grid[day.id]?.[period.number]) return 'occupied';
  // Same subject: never more than 2 per day; non-paired subjects can't be placed back-to-back.
  const sameSubjectPeriods = Object.entries(grid[day.id] || {})
    .filter(([, cell]) => cell?.subject === lesson.subjectName)
    .map(([number]) => Number(number));
  // Only "Подряд"-subjects (труд/технология) may be twice a day (consecutive); all others once a day.
  const dailyLimit = lesson.paired ? 2 : 1;
  if (sameSubjectPeriods.length >= dailyLimit) return 'subject-daily-limit';
  if (!lesson.paired && sameSubjectPeriods.some((n) => Math.abs(n - period.number) === 1)) return 'subject-consecutive';
  if (isEarlyOnly(lesson.subjectName, schoolClass.grade) && period.number > 4) return 'early-only';
  if (isScheduleBlocked(settings, day.id, period.number, shift, schoolClass.id)) return 'school-block';
  if (isTeacherUnavailable(settings, lesson.teacherId, day.id, period.number, shift)) return 'teacher-off';
  if (isOutsideAvailability(settings, lesson.teacherId, day.id, period.number, shift)) return 'teacher-window';
  if (lesson.teacherId && resourceBusy(busy.teachers, settings, variant, schoolClass.level, shift, lesson.teacherId, day.id, period)) return 'teacher-busy';
  if (lesson.roomId && resourceBusy(busy.rooms, settings, variant, schoolClass.level, shift, lesson.roomId, day.id, period)) return 'room-busy';
  if (dayLoad(grid, day.id) >= maxLessons(settings, schoolClass.grade)) return 'day-full';
  if (dayDifficulty(grid, day.id) + lesson.difficulty > maxDailyDifficulty(settings, schoolClass.grade)) return 'difficulty';
  return null;
}

// Math and Russian in grades 5-6 must be on lessons 1-4 only.
function isEarlyOnly(subjectName, grade) {
  if (grade !== 5 && grade !== 6) return false;
  const n = String(subjectName || '').trim().toLowerCase();
  return n === 'математика' || n === 'русский язык';
}

const REASON_TEXT = {
  'occupied': 'нет свободных уроков в сетке класса (все слоты заняты)',
  'early-only': 'Математика/Русский язык в 5–6 классе можно ставить только на 1–4 урок',
  'subject-daily-limit': 'предмет уже стоит в этот день (обычный предмет — 1 раз в день; 2 раза можно только «Подряд»-предметам, напр. труд)',
  'subject-consecutive': 'этот предмет нельзя ставить подряд в один день (спаренно можно только отмеченным «Подряд»)',
  'school-block': 'подходящие слоты заблокированы (блокировка уроков школы)',
  'teacher-off': 'учитель недоступен: выходной или приход/уход не покрывают слот',
  'teacher-window': 'слот попал в «окно» учителя',
  'teacher-busy': 'учитель уже ведёт урок в другом классе в это время',
  'room-busy': 'кабинет занят другим классом в это время',
  'day-full': 'дни класса заполнены до лимита СанПиН (макс. уроков в день)',
  'difficulty': 'превышен дневной лимит сложности по СанПиН'
};

// When a lesson can't be placed, find the reason that blocked the most slots.
function diagnoseFailure({ grid, days, periods, lesson, busy, settings, schoolClass, shift, variant }) {
  const tally = {};
  for (const day of days) {
    for (const period of periods) {
      const reason = hardBlockReason({ grid, day, period, lesson, busy, settings, schoolClass, shift, variant });
      if (reason) tally[reason] = (tally[reason] || 0) + 1;
    }
  }
  // Prefer the most informative reason over generic "occupied" when both exist.
  const order = ['teacher-busy', 'teacher-off', 'teacher-window', 'room-busy', 'difficulty', 'day-full', 'early-only', 'subject-daily-limit', 'subject-consecutive', 'school-block', 'occupied'];
  let best = null;
  for (const code of order) if (tally[code] && (!best || tally[code] > tally[best])) best = code;
  // if a specific (non-occupied) reason blocks at least a quarter of slots, prefer it
  const specific = order.filter((c) => c !== 'occupied').find((c) => tally[c]);
  const total = days.length * periods.length;
  const chosen = (specific && (tally[specific] >= total * 0.25 || !tally['occupied'])) ? specific : (best || 'occupied');
  return { code: chosen, text: REASON_TEXT[chosen] || 'причина не определена', tally };
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
  // Keep light subjects (физкультура/музыка/ИЗО, сложность 1) off the 1st lesson unless forced.
  const firstLessonEasyPenalty = period.number === 1 ? (lesson.difficulty <= 1 ? 46 : lesson.difficulty === 2 ? 18 : 0) : 0;
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

function releaseResource({ busy, settings, variant, level, shift, dayId, period, lesson }) {
  const interval = periodInterval(settings, level, shift, period.number);
  if (lesson.teacherId) removeBusy(busy.teachers, variant, lesson.teacherId, dayId, interval);
  if (lesson.roomId) removeBusy(busy.rooms, variant, lesson.roomId, dayId, interval);
}

function removeBusy(store, variant, resourceId, dayId, interval) {
  const key = resourceBusyKey(variant, resourceId, dayId);
  const entries = store.get(key) || [];
  const i = entries.findIndex((e) => e.start === interval.start && e.end === interval.end);
  if (i >= 0) { entries.splice(i, 1); store.set(key, entries); }
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

function isOutsideAvailability(settings, teacherId, dayId, periodNumber, shift) {
  if (!teacherId) return false;
  const window = (settings.teacherAvailability || []).find((item) => item.teacherId === teacherId && item.dayId === dayId);
  if (!window) return false;
  if (window.dayOff) return true;
  if (window.fromPeriod != null && periodNumber < window.fromPeriod) return true;
  if (window.toPeriod != null && periodNumber > window.toPeriod) return true;
  const wins = Array.isArray(window.windows) ? window.windows : (window.windows?.[shift] || []);
  if (wins.includes(periodNumber)) return true;
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
