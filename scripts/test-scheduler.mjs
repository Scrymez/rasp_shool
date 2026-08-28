import assert from 'node:assert/strict';
import { generateSchedule } from '../server/scheduler.js';

const days = ['mon', 'tue', 'wed', 'thu', 'fri'].map((id) => ({ id, enabled: true }));
const periods = Array.from({ length: 7 }, (_, index) => ({ number: index + 1, duration: 40, breakAfter: 10 }));
const settings = {
  days,
  periods,
  shifts: [{ id: 'morning', startsAt: '08:30' }],
  timetables: { 'ООО': { morning: { start: '08:30', periods } } },
  teacherConstraints: [],
  teacherAvailability: [],
  scheduleBlocks: [],
  sanpin: {
    maxLessonsByGrade: { 5: 7, 6: 7 },
    maxDailyDifficultyByGrade: { 5: 99, 6: 99 }
  }
};

function makeSchedule(grade, weeklyHours) {
  const schoolClass = { id: grade, level: 'ООО', grade, letter: 'А', shift: 'morning' };
  return generateSchedule({
    classes: [schoolClass],
    assignments: [{
      classId: schoolClass.id,
      subjectName: 'Русский язык',
      teacherId: null,
      teacherName: '',
      roomId: null,
      roomName: '',
      difficulty: 4,
      weeklyHours,
      paired: 0
    }],
    settings,
    classIds: [schoolClass.id],
    weekMode: 'one'
  });
}

function russianPeriodsByDay(schedule, className) {
  const grid = schedule.classes[className].single;
  return days.map(({ id }) => Object.entries(grid[id])
    .filter(([, cell]) => cell?.subject === 'Русский язык')
    .map(([number]) => Number(number))
    .sort((a, b) => a - b));
}

const grade6 = makeSchedule(6, 6);
const grade6Days = russianPeriodsByDay(grade6, '6А');
const grade6DoubleDays = grade6Days.filter((items) => items.length === 2);
assert.equal(grade6DoubleDays.length, 1, 'в 6 классе допустим только один двойной день');
assert.equal(grade6DoubleDays[0][1] - grade6DoubleDays[0][0], 1, 'два урока должны стоять подряд');
assert.ok(grade6Days.flat().every((number) => number <= 4), 'русский в 6 классе должен стоять на 1–4 уроках');
assert.equal(grade6Days.flat().length, 6, 'все шесть часов русского должны быть размещены');
assert.equal(grade6.diagnostics.length, 0, 'для шести часов русского не должно быть предупреждений');

const grade5 = makeSchedule(5, 6);
const grade5Days = russianPeriodsByDay(grade5, '5А');
assert.ok(grade5Days.every((items) => items.length <= 1), 'в 5 классе русский нельзя ставить дважды в день');

console.log(JSON.stringify({ ok: true, grade6Days, grade5Days }));
