import express from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import {
  allAssignments, allClasses, allRooms, allScheduleBlocks, allSubjects, allTeacherConstraints,
  allTeachers, allAuditLog, allClassAdvisors, audit, db, ensureAdminPasswordHash,
  json, migrate, runTransaction, setAdminPassword, verifyAdminPassword
} from './db.js';
import { generateSchedule } from './scheduler.js';

migrate();

const app = express();
const port = Number(process.env.PORT || 4173);
const root = path.resolve(process.env.SCHEDULER_APP_ROOT || process.cwd());
const sessions = new Map();
const sessionTtlMs = 8 * 60 * 60 * 1000;

app.use(cors({
  origin(origin, callback) {
    if (!origin || /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(origin)) return callback(null, true);
    return callback(new Error('CORS origin blocked'));
  }
}));
app.use(express.json({ limit: '20mb' }));

app.post('/api/login', (req, res) => {
  const password = String(req.body?.password || '');
  const result = verifyAdminPassword(password);
  if (!result.ok) {
    audit('login-failed', 'admin');
    return res.status(401).json({ ok: false, error: 'Пароль неверный' });
  }
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + sessionTtlMs });
  audit('login', 'admin');
  res.json({ ok: true, token, expiresIn: sessionTtlMs / 1000, mustChangePassword: result.forceChange });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    subjects: allSubjects().length,
    classes: allClasses().length,
    teachers: allTeachers().length,
    rooms: allRooms().length
  });
});

app.use('/api', requireAdminSession);

app.post('/api/logout', (req, res) => {
  const token = tokenFromRequest(req);
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

app.post('/api/admin/password', (req, res) => {
  const body = z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(8)
  }).parse(req.body);
  const current = verifyAdminPassword(body.currentPassword);
  if (!current.ok) return res.status(403).json({ error: 'Текущий пароль неверный' });
  setAdminPassword(body.newPassword);
  audit('update', 'admin-password');
  res.json({ ok: true });
});

app.get('/api/bootstrap', (_req, res) => {
  res.json({
    subjects: allSubjects(),
    classes: allClasses(),
    teachers: allTeachers(),
    rooms: allRooms(),
    classAdvisors: allClassAdvisors(),
    teacherConstraints: allTeacherConstraints(),
    scheduleBlocks: allScheduleBlocks(),
    auditLog: allAuditLog(),
    assignments: allAssignments(),
    settings: { days: json.get('days'), periods: json.get('periods'), shifts: json.get('shifts'), sanpin: json.get('sanpin') },
    schedules: db.prepare('SELECT id, title, week_mode AS weekMode, created_at AS createdAt FROM schedules ORDER BY id DESC').all()
  });
});

app.post('/api/classes', (req, res) => {
  const rows = z.array(z.object({
    level: z.enum(['НОО', 'ООО', 'СОО']),
    grade: z.number().int().min(1).max(11),
    letter: z.string().min(1).max(3),
    shift: z.enum(['morning', 'afternoon']).default('morning')
  })).parse(req.body.classes || []);
  const stmt = db.prepare(`
    INSERT INTO classes (level, grade, letter, shift) VALUES (?, ?, ?, ?)
    ON CONFLICT(grade, letter) DO UPDATE SET level = excluded.level, shift = excluded.shift
  `);
  runTransaction(() => rows.forEach((row) => stmt.run(row.level, row.grade, row.letter.toUpperCase(), row.shift)));
  autoBindSubjectsToClasses();
  audit('upsert', 'classes', { count: rows.length });
  res.json({ classes: allClasses(), assignments: allAssignments() });
});

app.post('/api/import/classes', async (req, res) => {
  const rows = await rowsFromDataUrl(req.body.dataUrl);
  const classes = rows.slice(1).map(classRowFromImport).filter(Boolean);
  const stmt = db.prepare(`
    INSERT INTO classes (level, grade, letter, shift) VALUES (?, ?, ?, ?)
    ON CONFLICT(grade, letter) DO UPDATE SET level = excluded.level, shift = excluded.shift
  `);
  runTransaction(() => classes.forEach((row) => stmt.run(row.level, row.grade, row.letter, row.shift)));
  autoBindSubjectsToClasses();
  audit('import', 'classes', { count: classes.length });
  res.json({ imported: classes.length, classes: allClasses(), assignments: allAssignments() });
});

app.post('/api/class-advisors', (req, res) => {
  const rows = z.array(z.object({
    classId: z.number().int(),
    teacherId: z.number().int().nullable().optional(),
    roomId: z.number().int().nullable().optional(),
    shift: z.enum(['', 'morning', 'afternoon']).default(''),
    note: z.string().default('')
  })).parse(req.body.advisors || []);
  const stmt = db.prepare(`
    INSERT INTO class_advisor_assignments (class_id, teacher_id, room_id, shift, note)
    VALUES (?, ?, ?, ?, ?)
  `);
  db.exec('DELETE FROM class_advisor_assignments');
  runTransaction(() => rows.forEach((row) => {
    if (row.classId) stmt.run(row.classId, row.teacherId || null, row.roomId || null, row.shift || null, row.note || '');
  }));
  audit('upsert', 'class-advisors', { count: rows.length });
  res.json({ classAdvisors: allClassAdvisors() });
});

app.post('/api/import/class-advisors', async (req, res) => {
  const rows = await rowsFromDataUrl(req.body.dataUrl);
  const classes = allClasses();
  const teachers = allTeachers();
  const rooms = allRooms();
  const advisors = rows.slice(1).map((row) => advisorRowFromImport(row, classes, teachers, rooms)).filter(Boolean);
  const stmt = db.prepare(`
    INSERT INTO class_advisor_assignments (class_id, teacher_id, room_id, shift, note)
    VALUES (?, ?, ?, ?, ?)
  `);
  runTransaction(() => advisors.forEach((row) => stmt.run(row.classId, row.teacherId, row.roomId, row.shift, row.note)));
  audit('import', 'class-advisors', { count: advisors.length });
  res.json({ imported: advisors.length, classAdvisors: allClassAdvisors() });
});

app.delete('/api/classes/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Класс не найден' });
  db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
  audit('delete', 'class', row);
  res.json({ classes: allClasses(), assignments: allAssignments() });
});

app.post('/api/subjects', (req, res) => {
  const rows = z.array(z.object({
    name: z.string().min(2),
    levels: z.array(z.string()).default([]),
    grades: z.array(z.number()).default([]),
    difficulty: z.number().min(1).max(5).default(3),
    weeklyHours: z.number().min(1).max(8).default(1),
    parallelHours: z.record(z.string(), z.number().min(0).max(12)).optional()
  })).parse(req.body.subjects || []);
  const stmt = db.prepare(`
    INSERT INTO subjects (name, levels, grades, difficulty, weekly_hours)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET levels = excluded.levels, grades = excluded.grades,
      difficulty = excluded.difficulty, weekly_hours = excluded.weekly_hours
  `);
  runTransaction(() => rows.forEach((row) => {
    const parallelHours = normalizeParallelHours(row.parallelHours, row.grades, row.weeklyHours);
    const grades = Object.keys(parallelHours).map(Number).sort((a, b) => a - b);
    stmt.run(row.name.trim(), JSON.stringify(row.levels), JSON.stringify(grades), row.difficulty, row.weeklyHours);
    const subject = db.prepare('SELECT id FROM subjects WHERE name = ?').get(row.name.trim());
    saveParallelHours(subject.id, parallelHours);
  }));
  autoBindSubjectsToClasses();
  audit('upsert', 'subjects', { count: rows.length });
  res.json({ subjects: allSubjects(), assignments: allAssignments() });
});

app.delete('/api/subjects/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Предмет не найден' });
  db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
  audit('delete', 'subject', row);
  res.json({ subjects: allSubjects(), assignments: allAssignments() });
});

app.post('/api/import/subjects', async (req, res) => {
  const rows = await rowsFromDataUrl(req.body.dataUrl);
  const subjects = rows.map((row) => ({
    name: String(row[0] || '').trim(),
    levels: split(row[1]),
    grades: split(row[2]).map(Number).filter(Boolean),
    difficulty: Number(row[3] || 3),
    weeklyHours: Number(row[4] || 1),
    parallelHours: parseParallelHours(row[4])
  })).filter((row) => row.name);
  req.body.subjects = subjects;
  const stmt = db.prepare(`
    INSERT INTO subjects (name, levels, grades, difficulty, weekly_hours)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET levels = excluded.levels, grades = excluded.grades,
      difficulty = excluded.difficulty, weekly_hours = excluded.weekly_hours
  `);
  runTransaction(() => subjects.forEach((row) => {
    const parallelHours = normalizeParallelHours(row.parallelHours, row.grades, row.weeklyHours);
    const grades = Object.keys(parallelHours).map(Number).sort((a, b) => a - b);
    stmt.run(row.name, JSON.stringify(row.levels), JSON.stringify(grades), row.difficulty, row.weeklyHours);
    const subject = db.prepare('SELECT id FROM subjects WHERE name = ?').get(row.name);
    saveParallelHours(subject.id, parallelHours);
  }));
  autoBindSubjectsToClasses();
  res.json({ imported: subjects.length, subjects: allSubjects(), assignments: allAssignments() });
});

app.post('/api/import/teachers', async (req, res) => {
  const rows = await rowsFromDataUrl(req.body.dataUrl);
  const teachers = rows.flatMap((row) => teacherRowsFromImport(row)).filter((row) => row.fullName && row.subjectName && !isTeacherHeader(row));
  const stmt = db.prepare(`
    INSERT INTO teachers (full_name, subject_name)
    SELECT ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM teachers WHERE lower(full_name) = lower(?) AND lower(subject_name) = lower(?)
    )
  `);
  runTransaction(() => teachers.forEach((row) => stmt.run(row.fullName, row.subjectName, row.fullName, row.subjectName)));
  autoAssignTeachers();
  audit('import', 'teachers', { count: teachers.length });
  res.json({ imported: teachers.length, teachers: allTeachers(), assignments: allAssignments() });
});

app.get('/api/templates/teachers.xlsx', (_req, res) => {
  const headers = ['ФИО', ...Array.from({ length: 10 }, (_, index) => `Предмет ${index + 1}`)];
  sendXlsx(res, 'Шаблон-импорта-учителей.xlsx', [
    {
      name: 'Учителя для импорта',
      rows: [
        headers,
        ...Array.from({ length: 200 }, () => Array.from({ length: headers.length }, () => ''))
      ]
    },
    {
      name: 'Пример',
      rows: [
        headers,
        ['Иванова Мария Петровна', 'Математика', 'Информатика', 'Алгебра', 'Геометрия', '', '', '', '', '', ''],
        ['Петров Сергей Иванович', 'Физика', 'Астрономия', '', '', '', '', '', '', '', ''],
        ['Сидорова Анна Викторовна', 'Русский язык', 'Литература', 'Родной язык', 'Родная литература', '', '', '', '', '', '']
      ]
    }
  ]);
});

app.get('/api/templates/classes.xlsx', (_req, res) => {
  const headers = ['Уровень', 'Класс', 'Литера', 'Смена'];
  sendXlsx(res, 'Шаблон-импорта-классов.xlsx', [
    { name: 'Классы', rows: [headers, ...Array.from({ length: 120 }, () => ['', '', '', ''])] },
    { name: 'Пример', rows: [headers, ['НОО', 1, 'А', '1 смена'], ['ООО', 5, 'А', '2 смена'], ['СОО', 10, 'А', '1 смена']] }
  ]);
});

app.get('/api/templates/class-advisors.xlsx', (_req, res) => {
  const headers = ['Класс', 'Классный руководитель', 'Кабинет', 'Смена', 'Примечание'];
  sendXlsx(res, 'Шаблон-классных-руководителей.xlsx', [
    { name: 'Руководители', rows: [headers, ...Array.from({ length: 200 }, () => ['', '', '', '', ''])] },
    { name: 'Пример', rows: [headers, ['1А', 'Иванова Мария Петровна', '101', '1 смена', 'Основной руководитель'], ['1А', 'Петров Сергей Иванович', '102', '2 смена', 'Вторая смена']] }
  ]);
});

app.get('/api/templates/schedule.xlsx', (_req, res) => {
  const settings = { days: json.get('days'), periods: json.get('periods'), shifts: json.get('shifts') };
  const classes = allClasses();
  const scheduleClasses = classes.length ? classes : defaultTemplateClasses();
  const sheets = [
    { name: 'Общее расписание', rows: fullScheduleTemplateRows(settings, scheduleClasses) },
    { name: 'Все классы', rows: scheduleIndexRows(settings, scheduleClasses) },
    ...scheduleClasses.map((schoolClass) => ({
      name: safeSheet(classKey(schoolClass)),
      rows: classScheduleTemplateRows(settings, schoolClass)
    }))
  ];
  sheets.push({
    name: 'Инструкция',
    rows: [
      ['Как заполнять'],
      ['1. В файле есть лист на каждый класс.'],
      ['2. Дни недели идут горизонтально по колонкам.'],
      ['3. В строках идут уроки и время. Заполняйте ячейку на пересечении дня и урока.'],
      ['4. В ячейку урока пишите: Предмет; Учитель; Кабинет; Сложность.'],
      ['5. Пример ячейки: Математика; Иванова М.П.; 101; 5.'],
      ['6. Лист Все классы показывает, какие классы относятся к 1 и 2 смене.']
    ]
  });
  sendXlsx(res, 'Шаблон-расписания-всей-школы.xlsx', sheets);
});

app.post('/api/teachers', (req, res) => {
  const body = z.object({
    fullName: z.string().min(3),
    subjects: z.array(z.string().min(2)).min(1)
  }).parse(req.body);
  const fullName = body.fullName.trim();
  const subjects = uniqueClean(body.subjects);
  const stmt = db.prepare(`
    INSERT INTO teachers (full_name, subject_name)
    SELECT ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM teachers WHERE lower(full_name) = lower(?) AND lower(subject_name) = lower(?)
    )
  `);
  runTransaction(() => subjects.forEach((subject) => stmt.run(fullName, subject, fullName, subject)));
  autoAssignTeachers();
  audit('upsert', 'teacher', { fullName, subjects });
  res.json({ teachers: allTeachers(), assignments: allAssignments() });
});

app.post('/api/teachers/:fullName/subjects', (req, res) => {
  const fullName = String(req.params.fullName || '').trim();
  const body = z.object({
    subjects: z.array(z.string().min(2)).min(1)
  }).parse(req.body);
  const existing = db.prepare('SELECT full_name AS fullName FROM teachers WHERE lower(full_name) = lower(?) LIMIT 1').get(fullName);
  if (!existing) return res.status(404).json({ error: 'Учитель не найден' });
  const subjects = uniqueClean(body.subjects);
  const stmt = db.prepare(`
    INSERT INTO teachers (full_name, subject_name)
    SELECT ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM teachers WHERE lower(full_name) = lower(?) AND lower(subject_name) = lower(?)
    )
  `);
  runTransaction(() => subjects.forEach((subject) => stmt.run(existing.fullName, subject, existing.fullName, subject)));
  autoAssignTeachers();
  audit('upsert', 'teacher-subjects', { fullName: existing.fullName, subjects });
  res.json({ teachers: allTeachers(), assignments: allAssignments() });
});

app.delete('/api/teachers/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Связка учитель-предмет не найдена' });
  db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id);
  audit('delete', 'teacher-subject', row);
  res.json({ teachers: allTeachers(), assignments: allAssignments() });
});

app.delete('/api/teachers/by-name/:fullName', (req, res) => {
  const fullName = String(req.params.fullName || '').trim();
  const rows = db.prepare('SELECT * FROM teachers WHERE lower(full_name) = lower(?)').all(fullName);
  if (!rows.length) return res.status(404).json({ error: 'Учитель не найден' });
  db.prepare('DELETE FROM teachers WHERE lower(full_name) = lower(?)').run(fullName);
  audit('delete', 'teacher', { fullName, count: rows.length });
  res.json({ teachers: allTeachers(), assignments: allAssignments() });
});

app.post('/api/rooms', (req, res) => {
  const rows = z.array(z.object({
    id: z.number().optional(),
    name: z.string().min(1),
    roomType: z.string().min(1).default('Обычный'),
    capacity: z.number().int().min(1).max(500).default(30)
  })).parse(req.body.rooms || []);
  const stmt = db.prepare(`
    INSERT INTO rooms (name, room_type, capacity)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET room_type = excluded.room_type, capacity = excluded.capacity
  `);
  runTransaction(() => rows.forEach((row) => stmt.run(row.name.trim(), row.roomType.trim(), row.capacity)));
  audit('upsert', 'rooms', { count: rows.length });
  res.json({ rooms: allRooms() });
});

app.post('/api/import/rooms', async (req, res) => {
  const rows = await rowsFromDataUrl(req.body.dataUrl);
  const rooms = rows.map((row) => ({
    name: String(row[0] || '').trim(),
    roomType: String(row[1] || 'Обычный').trim(),
    capacity: Number(row[2] || 30)
  })).filter((row) => row.name);
  const stmt = db.prepare(`
    INSERT INTO rooms (name, room_type, capacity)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET room_type = excluded.room_type, capacity = excluded.capacity
  `);
  runTransaction(() => rooms.forEach((row) => stmt.run(row.name, row.roomType, row.capacity)));
  audit('import', 'rooms', { count: rooms.length });
  res.json({ imported: rooms.length, rooms: allRooms() });
});

app.delete('/api/rooms/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Кабинет не найден' });
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  audit('delete', 'room', row);
  res.json({ rooms: allRooms(), assignments: allAssignments() });
});

app.post('/api/teacher-constraints', (req, res) => {
  const rows = z.array(z.object({
    teacherId: z.number(),
    dayId: z.string().min(1),
    shift: z.enum(['', 'morning', 'afternoon']).default(''),
    periodNumber: z.number().int().nullable().optional(),
    kind: z.string().default('unavailable')
  })).parse(req.body.constraints || []);
  db.exec('DELETE FROM teacher_constraints');
  const stmt = db.prepare('INSERT INTO teacher_constraints (teacher_id, day_id, shift, period_number, kind) VALUES (?, ?, ?, ?, ?)');
  runTransaction(() => rows.forEach((row) => stmt.run(row.teacherId, row.dayId, row.shift || null, row.periodNumber ?? null, row.kind)));
  audit('replace', 'teacher-constraints', { count: rows.length });
  res.json({ teacherConstraints: allTeacherConstraints() });
});

app.post('/api/schedule-blocks', (req, res) => {
  const rows = z.array(z.object({
    dayId: z.string().min(1),
    shift: z.enum(['', 'morning', 'afternoon']).default(''),
    classId: z.number().int().nullable().optional(),
    periodNumber: z.number().int().min(1),
    reason: z.string().default('')
  })).parse(req.body.blocks || []);
  db.exec('DELETE FROM schedule_blocks');
  const stmt = db.prepare('INSERT INTO schedule_blocks (day_id, shift, class_id, period_number, reason) VALUES (?, ?, ?, ?, ?)');
  runTransaction(() => rows.forEach((row) => stmt.run(row.dayId, row.shift || null, row.classId || null, row.periodNumber, row.reason || '')));
  audit('replace', 'schedule-blocks', { count: rows.length });
  res.json({ scheduleBlocks: allScheduleBlocks() });
});

app.post('/api/assignments', (req, res) => {
  const rows = z.array(z.object({
    id: z.number().optional(),
    classId: z.number(),
    subjectId: z.number(),
    teacherId: z.number().nullable().optional(),
    roomId: z.number().nullable().optional(),
    weeklyHours: z.number().min(1).max(10)
  })).parse(req.body.assignments || []);
  const stmt = db.prepare(`
    INSERT INTO assignments (class_id, subject_id, teacher_id, room_id, weekly_hours)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(class_id, subject_id) DO UPDATE SET teacher_id = excluded.teacher_id,
      room_id = excluded.room_id, weekly_hours = excluded.weekly_hours
  `);
  runTransaction(() => rows.forEach((row) => stmt.run(row.classId, row.subjectId, row.teacherId || null, row.roomId || null, row.weeklyHours)));
  audit('upsert', 'assignments', { count: rows.length });
  res.json({ assignments: allAssignments() });
});

app.post('/api/settings', (req, res) => {
  json.set('days', req.body.days || json.get('days'));
  json.set('periods', req.body.periods || json.get('periods'));
  json.set('shifts', req.body.shifts || json.get('shifts'));
  json.set('sanpin', req.body.sanpin || json.get('sanpin'));
  audit('update', 'settings');
  res.json({ settings: { days: json.get('days'), periods: json.get('periods'), shifts: json.get('shifts'), sanpin: json.get('sanpin') } });
});

app.post('/api/generate', (req, res) => {
  const body = z.object({
    classIds: z.array(z.number()).min(1),
    weekMode: z.enum(['one', 'two'])
  }).parse(req.body);
  const payload = generateSchedule({
    classes: allClasses(),
    assignments: allAssignments(),
    settings: {
      days: json.get('days'),
      periods: json.get('periods'),
      shifts: json.get('shifts'),
      sanpin: json.get('sanpin'),
      teacherConstraints: allTeacherConstraints(),
      scheduleBlocks: allScheduleBlocks()
    },
    classIds: body.classIds,
    weekMode: body.weekMode
  });
  const info = db.prepare('INSERT INTO schedules (title, week_mode, created_at, payload) VALUES (?, ?, ?, ?)').run(payload.title, body.weekMode, new Date().toISOString(), JSON.stringify(payload));
  audit('create', 'schedule', { id: info.lastInsertRowid, weekMode: body.weekMode });
  res.json({ id: info.lastInsertRowid, schedule: payload });
});

app.get('/api/schedules/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Расписание не найдено' });
  res.json({ id: row.id, title: row.title, weekMode: row.week_mode, createdAt: row.created_at, schedule: JSON.parse(row.payload) });
});

app.patch('/api/schedules/:id/cell', (req, res) => {
  const body = z.object({
    className: z.string(),
    week: z.string(),
    dayId: z.string(),
    periodNumber: z.number().int(),
    cell: z.object({
      subject: z.string().default(''),
      teacher: z.string().default(''),
      teacherId: z.number().nullable().optional(),
      room: z.string().default(''),
      roomId: z.number().nullable().optional(),
      difficulty: z.number().min(1).max(5).default(3)
    }).nullable()
  }).parse(req.body);
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Расписание не найдено' });
  const payload = JSON.parse(row.payload);
  payload.classes[body.className] ||= {};
  payload.classes[body.className][body.week] ||= {};
  payload.classes[body.className][body.week][body.dayId] ||= {};
  const conflicts = body.cell ? manualConflicts(payload, body) : [];
  payload.classes[body.className][body.week][body.dayId][body.periodNumber] = body.cell?.subject ? body.cell : null;
  payload.updatedAt = new Date().toISOString();
  payload.manualWarnings = conflicts;
  db.prepare('UPDATE schedules SET payload = ? WHERE id = ?').run(JSON.stringify(payload), req.params.id);
  audit('update', 'schedule-cell', { scheduleId: req.params.id, className: body.className, week: body.week, dayId: body.dayId, periodNumber: body.periodNumber });
  res.json({ schedule: payload, conflicts });
});

app.post('/api/schedules/:id/swap', (req, res) => {
  const body = z.object({
    className: z.string(),
    week: z.string(),
    from: z.object({ dayId: z.string(), periodNumber: z.number().int() }),
    to: z.object({ dayId: z.string(), periodNumber: z.number().int() })
  }).parse(req.body);
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Расписание не найдено' });
  const payload = JSON.parse(row.payload);
  const grid = payload.classes?.[body.className]?.[body.week];
  if (!grid) return res.status(404).json({ error: 'Сетка не найдена' });
  grid[body.from.dayId] ||= {};
  grid[body.to.dayId] ||= {};
  const fromCell = grid[body.from.dayId][body.from.periodNumber] || null;
  const toCell = grid[body.to.dayId][body.to.periodNumber] || null;
  grid[body.from.dayId][body.from.periodNumber] = toCell;
  grid[body.to.dayId][body.to.periodNumber] = fromCell;
  payload.updatedAt = new Date().toISOString();
  db.prepare('UPDATE schedules SET payload = ? WHERE id = ?').run(JSON.stringify(payload), req.params.id);
  audit('update', 'schedule-swap', { scheduleId: req.params.id, className: body.className, week: body.week, from: body.from, to: body.to });
  res.json({ schedule: payload });
});

app.post('/api/import/schedule', async (req, res) => {
  const rows = await rowsFromDataUrl(req.body.dataUrl, { allSheets: true });
  const payload = scheduleFromRows(rows);
  const info = db.prepare('INSERT INTO schedules (title, week_mode, created_at, payload) VALUES (?, ?, ?, ?)').run('Импортированное расписание', payload.weekMode, new Date().toISOString(), JSON.stringify(payload));
  audit('import', 'schedule', { id: info.lastInsertRowid });
  res.json({ id: info.lastInsertRowid, schedule: payload });
});

app.get('/api/export/schedules/:id.grid.xlsx', (req, res) => {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).send('Расписание не найдено');
  const payload = JSON.parse(row.payload);
  sendXlsx(res, `Все-расписание-сеткой-${row.id}.xlsx`, scheduleGridSheets(payload));
});

app.get('/api/export/schedules/:id.xlsx', async (req, res) => {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).send('Расписание не найдено');
  const payload = JSON.parse(row.payload);
  const sheets = [];
  for (const [className, weeks] of Object.entries(payload.classes)) {
    for (const [week, grid] of Object.entries(weeks)) {
      const classShift = payload.classMeta?.[className]?.shift || 'morning';
      const shiftName = shiftLabel(payload, classShift);
      const aoa = [['Класс', className], ['Смена', shiftName], ['Неделя', weekLabel(week)], [], ['День', 'Урок', 'Время', 'Предмет', 'Учитель', 'Кабинет', 'Сложность']];
      for (const day of payload.days) {
        for (const period of payload.periods) {
          const cell = grid[day.id]?.[period.number];
          aoa.push([day.name, period.number, `${periodTime(payload, classShift, period.number)} / ${period.duration} мин`, cell?.subject || '', cell?.teacher || '', cell?.room || '', cell?.difficulty || '']);
        }
      }
      sheets.push({ name: safeSheet(`${className}-${week}`), rows: aoa });
    }
  }
  const buffer = writeXlsx(sheets);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  setDownloadName(res, `Расписание-данные-${row.id}.xlsx`);
  res.send(buffer);
});

app.get('/api/export/schedules/:id.pdf', (req, res) => {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).send('Расписание не найдено');
  const payload = JSON.parse(row.payload);
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => {
    res.setHeader('Content-Type', 'application/pdf');
  setDownloadName(res, `Расписание-${row.id}.pdf`);
    res.send(Buffer.concat(chunks));
  });
  renderSchedulePdf(doc, payload);
  doc.end();
});

app.get('/api/print/schedules/:id.html', (req, res) => {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).send('Расписание не найдено');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(printHtml(JSON.parse(row.payload)));
});

app.get('/api/reports', (_req, res) => {
  const row = db.prepare('SELECT id, title, week_mode AS weekMode, created_at AS createdAt, payload FROM schedules ORDER BY id DESC LIMIT 1').get();
  const latest = row ? { ...row, payload: JSON.parse(row.payload) } : null;
  res.json(buildReports({
    assignments: allAssignments(),
    teachers: allTeachers(),
    rooms: allRooms(),
    classes: allClasses(),
    classAdvisors: allClassAdvisors(),
    latest
  }));
});

app.get('/api/reports.xlsx', (_req, res) => {
  const row = db.prepare('SELECT id, title, week_mode AS weekMode, created_at AS createdAt, payload FROM schedules ORDER BY id DESC LIMIT 1').get();
  const latest = row ? { ...row, payload: JSON.parse(row.payload) } : null;
  const reports = buildReports({
    assignments: allAssignments(),
    teachers: allTeachers(),
    rooms: allRooms(),
    classes: allClasses(),
    classAdvisors: allClassAdvisors(),
    latest
  });
  sendXlsx(res, 'Отчеты-расписание.xlsx', reportSheets(reports));
});

app.get('/api/backup.json', (_req, res) => {
  const backup = {
    version: 1,
    createdAt: new Date().toISOString(),
    subjects: db.prepare('SELECT * FROM subjects').all(),
    subjectGradeHours: db.prepare('SELECT * FROM subject_grade_hours').all(),
    classes: db.prepare('SELECT * FROM classes').all(),
    teachers: db.prepare('SELECT * FROM teachers').all(),
    rooms: db.prepare('SELECT * FROM rooms').all(),
    classAdvisors: db.prepare('SELECT * FROM class_advisors').all(),
    classAdvisorAssignments: db.prepare('SELECT * FROM class_advisor_assignments').all(),
    assignments: db.prepare('SELECT * FROM assignments').all(),
    teacherConstraints: db.prepare('SELECT * FROM teacher_constraints').all(),
    scheduleBlocks: db.prepare('SELECT * FROM schedule_blocks').all(),
    settings: db.prepare('SELECT * FROM settings').all(),
    schedules: db.prepare('SELECT * FROM schedules').all()
  };
  audit('export', 'backup');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  setDownloadName(res, `Backup-расписание-${Date.now()}.json`);
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/restore', (req, res) => {
  const backup = req.body?.backup || req.body;
  if (!backup?.version) return res.status(400).json({ error: 'Файл backup неверный' });
  restoreBackup(backup);
  ensureAdminPasswordHash();
  audit('import', 'backup', { createdAt: backup.createdAt });
  res.json({ ok: true, subjects: allSubjects().length, classes: allClasses().length });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
}

export function startServer(host = '127.0.0.1') {
  const safeHost = safeListenHost(host);
  return app.listen(port, safeHost, () => {
    console.log(`Scheduler API: http://${safeHost}:${port}`);
  });
}

export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer(process.env.HOST || '127.0.0.1');
}

function safeListenHost(host) {
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return host;
  if (process.env.SCHEDULER_ALLOW_NETWORK === '1') return host;
  console.warn(`Unsafe HOST "${host}" ignored. Set SCHEDULER_ALLOW_NETWORK=1 to expose the API.`);
  return '127.0.0.1';
}

function requireAdminSession(req, res, next) {
  const token = tokenFromRequest(req);
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Требуется вход администратора' });
  }
  session.expiresAt = Date.now() + sessionTtlMs;
  next();
}

function tokenFromRequest(req) {
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7);
  return String(req.headers['x-admin-token'] || '');
}

function autoBindSubjectsToClasses() {
  const subjects = allSubjects();
  const classes = allClasses();
  const stmt = db.prepare('INSERT OR IGNORE INTO assignments (class_id, subject_id, weekly_hours) VALUES (?, ?, ?)');
  runTransaction(() => {
    for (const schoolClass of classes) {
      for (const subject of subjects) {
        const hours = Number(subject.parallelHours?.[schoolClass.grade] || 0);
        if (hours > 0) {
          stmt.run(schoolClass.id, subject.id, hours);
        }
      }
    }
  });
}

function manualConflicts(payload, body) {
  const conflicts = [];
  const currentShift = payload.classMeta?.[body.className]?.shift || 'morning';
  for (const [className, weeks] of Object.entries(payload.classes)) {
    const otherShift = payload.classMeta?.[className]?.shift || 'morning';
    if (otherShift !== currentShift) continue;
    const cell = weeks[body.week]?.[body.dayId]?.[body.periodNumber];
    if (!cell || className === body.className) continue;
    if (body.cell.teacher && cell.teacher === body.cell.teacher) conflicts.push(`Учитель занят: ${body.cell.teacher}`);
    if (body.cell.room && cell.room === body.cell.room) conflicts.push(`Кабинет занят: ${body.cell.room}`);
  }
  return [...new Set(conflicts)];
}

function autoAssignTeachers() {
  const teachers = allTeachers();
  const assignments = allAssignments();
  const stmt = db.prepare('UPDATE assignments SET teacher_id = ? WHERE id = ? AND teacher_id IS NULL');
  runTransaction(() => {
    for (const assignment of assignments) {
      const teacher = teachers.find((item) => same(item.subjectName, assignment.subjectName));
      if (teacher) stmt.run(teacher.id, assignment.id);
    }
  });
}

async function rowsFromDataUrl(dataUrl, options = {}) {
  const base64 = String(dataUrl || '').split(',').pop();
  return readXlsxRows(Buffer.from(base64, 'base64'), options);
}

function readXlsxRows(buffer, options = {}) {
  const files = unzipSync(new Uint8Array(buffer));
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';
  const shared = parseSharedStrings(files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : '');
  const relTargets = workbookSheetTargets(workbook, rels);
  const sheetPaths = options.allSheets ? relTargets : relTargets.slice(0, 1);
  const rows = [];
  for (const sheetPath of sheetPaths.length ? sheetPaths : ['xl/worksheets/sheet1.xml']) {
    const sheetXml = files[sheetPath] ? strFromU8(files[sheetPath]) : '';
    const rowMatches = [...sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
    for (const rowMatch of rowMatches) {
      const cells = [...rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)];
      const values = [];
      for (const cell of cells) {
        const attrs = cell[1];
        const body = cell[2];
        const ref = attrs.match(/r="([A-Z]+)(\d+)"/)?.[1];
        const index = ref ? columnIndex(ref) : values.length;
        const type = attrs.match(/t="([^"]+)"/)?.[1];
        let value = '';
        if (type === 's') value = shared[Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || 0)] || '';
        else if (type === 'inlineStr') value = stripXml(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '');
        else value = stripXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
        values[index] = value;
      }
      const compact = values.map((value) => value ?? '');
      if (compact.some(Boolean)) rows.push(compact);
    }
  }
  return rows;
}

function workbookSheetTargets(workbook, rels) {
  const relMap = new Map([...rels.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g)].map((match) => [match[1], match[2]]));
  return [...workbook.matchAll(/<sheet[^>]+r:id="([^"]+)"/g)]
    .map((match) => relMap.get(match[1]) || '')
    .filter(Boolean)
    .map((target) => `xl/${target}`.replace('xl//', 'xl/'));
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => (
    [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => stripXml(item[1])).join('')
  ));
}

function writeXlsx(sheets) {
  const safeSheets = sheets.length ? sheets : [{ name: 'Лист1', rows: [[]] }];
  const files = {};
  files['[Content_Types].xml'] = xml(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${safeSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`);
  files['_rels/.rels'] = xml(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  files['xl/workbook.xml'] = xml(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${safeSheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
</workbook>`);
  files['xl/_rels/workbook.xml.rels'] = xml(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${safeSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
</Relationships>`);
  safeSheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = xml(`<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, colIndex) => cellXml(rowIndex + 1, colIndex, value)).join('')}</row>`).join('')}</sheetData>
</worksheet>`);
  });
  return Buffer.from(zipSync(files));
}

function cellXml(rowIndex, colIndex, value) {
  const ref = `${columnName(colIndex)}${rowIndex}`;
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function xml(value) {
  return strToU8(value);
}

function stripXml(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function columnIndex(name) {
  return [...name].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function columnName(index) {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}
function split(value) {
  return String(value || '').split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
}

function parseParallelHours(value) {
  const text = String(value || '').trim();
  if (!text.includes(':')) return null;
  const result = {};
  for (const part of text.split(/[,;]+/)) {
    const [grade, hours] = part.split(':').map((item) => Number(String(item).trim()));
    if (grade >= 1 && grade <= 11 && hours > 0) result[grade] = hours;
  }
  return result;
}

function normalizeParallelHours(parallelHours, grades, weeklyHours) {
  if (parallelHours && Object.keys(parallelHours).length) {
    return Object.fromEntries(Object.entries(parallelHours).map(([grade, hours]) => [grade, Number(hours)]).filter(([grade, hours]) => Number(grade) >= 1 && Number(grade) <= 11 && hours > 0));
  }
  return Object.fromEntries((grades || []).map((grade) => [grade, Number(weeklyHours || 1)]).filter(([grade]) => Number(grade) >= 1 && Number(grade) <= 11));
}

function saveParallelHours(subjectId, parallelHours) {
  db.prepare('DELETE FROM subject_grade_hours WHERE subject_id = ?').run(subjectId);
  const stmt = db.prepare('INSERT INTO subject_grade_hours (subject_id, grade, weekly_hours) VALUES (?, ?, ?)');
  for (const [grade, hours] of Object.entries(parallelHours)) stmt.run(subjectId, Number(grade), Number(hours));
}

function uniqueClean(values) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function same(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function safeSheet(name) {
  return String(name || 'Лист').replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
}

function weekLabel(week) {
  return ({ single: 'Одна неделя', odd: 'Нечетная', even: 'Четная' })[week] || week;
}

function classNameSort(a, b) {
  const left = parseClassName(typeof a === 'string' ? a : a.className) || { grade: 0, letter: '' };
  const right = parseClassName(typeof b === 'string' ? b : b.className) || { grade: 0, letter: '' };
  return left.grade - right.grade || left.letter.localeCompare(right.letter, 'ru');
}

function parseClassName(value) {
  const match = String(value || '').trim().toUpperCase().match(/^(\d{1,2})\s*([А-ЯA-Z]?)$/);
  return match ? { grade: Number(match[1]), letter: match[2] || '' } : null;
}

function classKey(item) {
  return `${item.grade}${item.letter}`;
}

function teacherRowsFromImport(row) {
  const fullName = String(row[0] || '').trim();
  const subjects = row.slice(1).flatMap((value) => split(value));
  return subjects.map((subjectName) => ({ fullName, subjectName }));
}

function classRowFromImport(row) {
  const level = String(row[0] || '').trim().toUpperCase();
  const parsed = parseClassName(row[1]);
  const grade = Number(row[1]) || parsed?.grade;
  const letter = String(row[2] || parsed?.letter || '').trim().toUpperCase();
  const shift = shiftIdFromText(row[3]);
  if (!['НОО', 'ООО', 'СОО'].includes(level) || !grade || !letter) return null;
  return { level, grade, letter, shift };
}

function advisorRowFromImport(row, classes, teachers, rooms) {
  const parsed = parseClassName(row[0]);
  if (!parsed) return null;
  const schoolClass = classes.find((item) => Number(item.grade) === parsed.grade && same(item.letter, parsed.letter));
  if (!schoolClass) return null;
  const teacherName = String(row[1] || '').trim();
  const teacher = teachers.find((item) => same(item.fullName, teacherName));
  const roomName = String(row[2] || '').trim();
  const room = rooms.find((item) => same(item.name, roomName));
  return {
    classId: schoolClass.id,
    teacherId: teacher?.id || null,
    roomId: room?.id || null,
    shift: shiftIdFromText(row[3]) || schoolClass.shift || null,
    note: String(row[4] || '').trim()
  };
}

function shiftIdFromText(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('2') || text.includes('втор') || text.includes('afternoon')) return 'afternoon';
  return 'morning';
}

function isTeacherHeader(row) {
  return same(row.fullName, 'ФИО') && String(row.subjectName || '').toLowerCase().startsWith('предмет');
}

function sendXlsx(res, filename, sheets) {
  const buffer = writeXlsx(sheets);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  setDownloadName(res, filename);
  res.send(buffer);
}

function setDownloadName(res, filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
}

function defaultTemplateClasses() {
  return Array.from({ length: 11 }, (_, index) => {
    const grade = index + 1;
    return { grade, letter: 'А', shift: grade <= 4 ? 'morning' : 'afternoon' };
  });
}

function scheduleIndexRows(settings, classes) {
  const rows = [
    ['Класс', 'Смена', 'Уроков в день', 'Лист расписания']
  ];
  for (const schoolClass of classes) {
    const shiftId = schoolClass.shift || 'morning';
    rows.push([classKey(schoolClass), shiftLabel(settings, shiftId), settings.periods.length, classKey(schoolClass)]);
  }
  return rows;
}

function fullScheduleTemplateRows(settings, classes) {
  const activeDays = settings.days.filter((item) => item.enabled);
  const rows = [
    ['Формат ячейки', 'Предмет; Учитель; Кабинет; Сложность'],
    ['Подсказка', 'Дни недели идут горизонтально. Заполняйте пересечение урока и дня.'],
    []
  ];
  for (const schoolClass of classes) {
    const shiftId = schoolClass.shift || 'morning';
    const className = classKey(schoolClass);
    rows.push(['Класс', className, 'Смена', shiftLabel(settings, shiftId)]);
    rows.push(['Класс', 'Смена', 'Урок', 'Время', ...activeDays.map((day) => day.name)]);
    for (const period of settings.periods) {
      rows.push([
        className,
        shiftLabel(settings, shiftId),
        `${period.number} урок`,
        `${periodTime(settings, shiftId, period.number)} / ${period.duration} мин`,
        ...activeDays.map(() => '')
      ]);
    }
    rows.push([]);
  }
  return rows;
}

function classScheduleTemplateRows(settings, schoolClass) {
  const shiftId = schoolClass.shift || 'morning';
  const className = classKey(schoolClass);
  const rows = [
    ['Класс', className],
    ['Смена', shiftLabel(settings, shiftId)],
    ['Формат ячейки', 'Предмет; Учитель; Кабинет; Сложность'],
    ['Подсказка', 'Дни недели идут горизонтально. Заполняйте пересечение урока и дня.'],
    [],
    ['Урок', 'Время', ...settings.days.filter((item) => item.enabled).map((day) => day.name)]
  ];
  const activeDays = settings.days.filter((item) => item.enabled);
  for (const period of settings.periods) {
    rows.push([`${period.number} урок`, `${periodTime(settings, shiftId, period.number)} / ${period.duration} мин`, ...activeDays.map(() => '')]);
  }
  return rows;
}

function scheduleGridSheets(payload) {
  const sheets = [
    {
      name: 'Полное расписание',
      rows: fullScheduleGridRows(payload)
    },
    {
      name: 'Все классы',
      rows: [['Класс', 'Смена', 'Неделя', 'Лист']].concat(Object.entries(payload.classes).flatMap(([className, weeks]) => (
        Object.keys(weeks).map((week) => {
          const shift = payload.classMeta?.[className]?.shift || 'morning';
          return [className, shiftLabel(payload, shift), weekLabel(week), safeSheet(`${className}-${week}`)];
        })
      )))
    }
  ];
  for (const [className, weeks] of Object.entries(payload.classes)) {
    for (const [week, grid] of Object.entries(weeks)) {
      const shift = payload.classMeta?.[className]?.shift || 'morning';
      sheets.push({
        name: safeSheet(`${className}-${week}`),
        rows: classScheduleGridRows(payload, className, shift, week, grid)
      });
    }
  }
  return sheets;
}

function fullScheduleGridRows(payload) {
  const rows = [['Класс', 'Смена', 'Неделя', 'День', ...payload.periods.map((period) => `${period.number} урок`)]];
  for (const [className, weeks] of Object.entries(payload.classes)) {
    const shift = payload.classMeta?.[className]?.shift || 'morning';
    for (const [week, grid] of Object.entries(weeks)) {
      for (const day of payload.days) {
        rows.push([
          className,
          shiftLabel(payload, shift),
          weekLabel(week),
          day.name,
          ...payload.periods.map((period) => {
            const cell = grid[day.id]?.[period.number];
            if (!cell) return '';
            return [cell.subject, cell.teacher, cell.room, cell.difficulty ? `сложность ${cell.difficulty}` : ''].filter(Boolean).join('\n');
          })
        ]);
      }
    }
  }
  return rows;
}

function classScheduleGridRows(payload, className, shift, week, grid) {
  const rows = [
    ['Класс', className],
    ['Смена', shiftLabel(payload, shift)],
    ['Неделя', weekLabel(week)],
    [],
    ['День', ...payload.periods.map((period) => `${period.number} урок`)],
    ['Время', ...payload.periods.map((period) => `${periodTime(payload, shift, period.number)} / ${period.duration} мин`)]
  ];
  for (const day of payload.days) {
    rows.push([
      day.name,
      ...payload.periods.map((period) => {
        const cell = grid[day.id]?.[period.number];
        if (!cell) return '';
        return [cell.subject, cell.teacher, cell.room, cell.difficulty ? `сложность ${cell.difficulty}` : ''].filter(Boolean).join('\n');
      })
    ]);
  }
  return rows;
}

function scheduleFromRows(rows) {
  const days = json.get('days').filter((day) => day.enabled);
  const periods = json.get('periods');
  const payload = { title: 'Импортированное расписание', weekMode: 'one', days, periods, shifts: json.get('shifts'), classMeta: {}, classes: {} };
  if (fillScheduleFromHorizontalDayRows(payload, rows)) return payload;
  let currentClass = '';
  let currentShift = 'morning';
  for (const row of rows) {
    const first = String(row[0] || '').trim();
    const second = String(row[1] || '').trim();
    if (same(first, 'Класс') && second && !same(second, 'Смена') && !row[2]) {
      currentClass = second;
      payload.classes[currentClass] ||= { single: {} };
      payload.classMeta[currentClass] ||= { shift: currentShift };
      continue;
    }
    if (currentClass && same(first, 'Смена')) {
      currentShift = shiftIdFromLabel(payload, second) || currentShift;
      payload.classMeta[currentClass] = { shift: currentShift };
      continue;
    }
    const day = currentClass ? days.find((item) => item.name === first) : null;
    if (day) {
      payload.classes[currentClass].single[day.id] ||= {};
      periods.forEach((period, index) => {
        const cell = parseTemplateLessonCell(row[index + 1]);
        if (cell) payload.classes[currentClass].single[day.id][period.number] = cell;
      });
    }
  }
  if (Object.keys(payload.classes).length) return payload;

  const header = headerMap(rows[0] || []);
  const wideParsed = fillScheduleFromWideRows(payload, rows, header);
  if (wideParsed) return payload;
  for (const row of rows.slice(1)) {
    const className = valueByHeader(row, header, 'класс', 0);
    const shiftName = valueByHeader(row, header, 'смена', null);
    const dayName = valueByHeader(row, header, 'день', 1);
    const periodNumber = valueByHeader(row, header, 'урок', 2);
    const subject = valueByHeader(row, header, 'предмет', 3);
    const teacher = valueByHeader(row, header, 'учитель', 4);
    const room = valueByHeader(row, header, 'кабинет', 5);
    const difficulty = Number(valueByHeader(row, header, 'сложность', null) || 3);
    if (same(className, 'Класс') || same(dayName, 'День')) continue;
    if (!className || !dayName || !periodNumber) continue;
    payload.classes[className] ||= { single: {} };
    payload.classMeta[className] ||= { shift: shiftIdFromLabel(payload, shiftName) || 'morning' };
    const day = days.find((item) => item.name === dayName) || days[0];
    payload.classes[className].single[day.id] ||= {};
    payload.classes[className].single[day.id][Number(periodNumber)] = { subject: subject || '', teacher: teacher || '', room: room || '', difficulty: Number.isFinite(difficulty) ? difficulty : 3 };
  }
  return payload;
}

function fillScheduleFromHorizontalDayRows(payload, rows) {
  let currentClass = '';
  let currentShift = 'morning';
  let layout = null;
  for (const row of rows) {
    const first = String(row[0] || '').trim();
    const second = String(row[1] || '').trim();
    if (same(first, 'Класс') && second && !same(second, 'Смена') && !row[4]) {
      currentClass = second;
      if (same(row[2], 'Смена')) currentShift = shiftIdFromLabel(payload, row[3]) || currentShift;
      payload.classMeta[currentClass] ||= { shift: currentShift };
      continue;
    }

    const header = horizontalScheduleHeader(row, payload.days);
    if (header) {
      layout = header;
      continue;
    }
    if (!layout) continue;

    const className = layout.classIndex == null ? currentClass : String(row[layout.classIndex] || '').trim();
    const shiftText = layout.shiftIndex == null ? currentShift : row[layout.shiftIndex];
    const periodNumber = parsePeriodNumber(row[layout.periodIndex]);
    if (!className || !periodNumber) continue;

    payload.classes[className] ||= { single: {} };
    payload.classMeta[className] ||= { shift: shiftIdFromLabel(payload, shiftText) || currentShift || 'morning' };
    for (const column of layout.dayColumns) {
      const cell = parseTemplateLessonCell(row[column.index]);
      if (!cell) continue;
      payload.classes[className].single[column.day.id] ||= {};
      payload.classes[className].single[column.day.id][periodNumber] = cell;
    }
  }
  return Object.keys(payload.classes).length > 0;
}

function horizontalScheduleHeader(row, days) {
  const labels = row.map((value) => String(value || '').trim().toLowerCase());
  const periodIndex = labels.findIndex((value) => value === 'урок' || value === 'номер урока');
  if (periodIndex === -1) return null;
  const dayColumns = [];
  for (const day of days) {
    const index = labels.findIndex((value) => value === day.name.toLowerCase());
    if (index !== -1) dayColumns.push({ day, index });
  }
  if (!dayColumns.length) return null;
  return {
    classIndex: labels.indexOf('класс') === -1 ? null : labels.indexOf('класс'),
    shiftIndex: labels.indexOf('смена') === -1 ? null : labels.indexOf('смена'),
    periodIndex,
    dayColumns
  };
}

function parsePeriodNumber(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function fillScheduleFromWideRows(payload, rows, header) {
  const classIndex = header.get('класс');
  const dayIndex = header.get('день');
  const shiftIndex = header.get('смена');
  if (classIndex == null || dayIndex == null) return false;
  const periodColumns = [];
  for (const [name, index] of header.entries()) {
    const match = name.match(/^(\d+)\s*урок/);
    if (match) periodColumns.push({ number: Number(match[1]), index });
  }
  if (!periodColumns.length) return false;
  for (const row of rows.slice(1)) {
    const className = String(row[classIndex] || '').trim();
    const dayName = String(row[dayIndex] || '').trim();
    if (!className || same(className, 'Формат ячейки') || !dayName) continue;
    const day = payload.days.find((item) => item.name === dayName);
    if (!day) continue;
    payload.classes[className] ||= { single: {} };
    payload.classes[className].single[day.id] ||= {};
    payload.classMeta[className] ||= { shift: shiftIdFromLabel(payload, row[shiftIndex]) || 'morning' };
    for (const column of periodColumns) {
      const cell = parseTemplateLessonCell(row[column.index]);
      if (cell) payload.classes[className].single[day.id][column.number] = cell;
    }
  }
  return Object.keys(payload.classes).length > 0;
}

function parseTemplateLessonCell(value) {
  const parts = String(value || '').split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return null;
  return {
    subject: parts[0] || '',
    teacher: parts[1] || '',
    room: parts[2] || '',
    difficulty: Number(parts[3] || 3) || 3
  };
}

function headerMap(row) {
  const map = new Map();
  row.forEach((value, index) => {
    const key = String(value || '').trim().toLowerCase();
    if (key) map.set(key, index);
  });
  return map;
}

function valueByHeader(row, header, key, fallbackIndex) {
  const index = header.has(key) ? header.get(key) : fallbackIndex;
  return index == null ? '' : String(row[index] || '').trim();
}

function shiftIdFromLabel(payload, label) {
  const text = String(label || '').toLowerCase();
  if (!text) return '';
  const shift = payload.shifts?.find((item) => text.includes(String(item.name).toLowerCase()) || text.includes(String(item.label).toLowerCase()) || text === item.id);
  return shift?.id || '';
}

function printHtml(payload) {
  const sections = Object.entries(payload.classes).flatMap(([className, weeks]) => (
    Object.entries(weeks).map(([week, grid]) => `
      <section>
        <h2>${escapeHtml(className)} · ${escapeHtml(shiftLabel(payload, payload.classMeta?.[className]?.shift || 'morning'))} · ${escapeHtml(weekLabel(week))}</h2>
        <table>
          <thead><tr><th>День</th>${payload.periods.map((period) => `<th>${period.number}<br><small>${escapeHtml(periodTime(payload, payload.classMeta?.[className]?.shift || 'morning', period.number))}</small></th>`).join('')}</tr></thead>
          <tbody>${payload.days.map((day) => `
            <tr><th>${escapeHtml(day.name)}</th>${payload.periods.map((period) => {
              const cell = grid[day.id]?.[period.number];
              return `<td>${cell ? `<b>${escapeHtml(cell.subject)}</b><br>${escapeHtml(cell.teacher || '')}<br><small>${escapeHtml(cell.room || '')}</small>` : ''}</td>`;
            }).join('')}</tr>
          `).join('')}</tbody>
        </table>
      </section>
    `)
  )).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(payload.title)}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:24px;color:#111} h1{margin:0 0 18px} section{break-after:page;margin-bottom:24px}
    table{border-collapse:collapse;width:100%;font-size:12px} th,td{border:1px solid #444;padding:6px;vertical-align:top} th{background:#eee}
    small{color:#555}@media print{button{display:none} body{margin:8mm} section{break-after:page}}
  </style></head><body><button onclick="window.print()">Печать</button><h1>${escapeHtml(payload.title)}</h1>${sections}</body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function shiftLabel(payload, shiftId) {
  const shift = payload.shifts?.find((item) => item.id === shiftId);
  return shift ? shift.name : shiftId;
}

function periodTime(payload, shiftId, periodNumber) {
  const shift = payload.shifts?.find((item) => item.id === shiftId) || payload.shifts?.[0] || { startsAt: '08:30' };
  const period = payload.periods.find((item) => item.number === periodNumber);
  if (!period) return '';
  if (period.startsAt?.[shiftId]) return period.startsAt[shiftId];
  let minutes = timeToMinutes(shift.startsAt);
  for (const item of payload.periods) {
    if (item.number === periodNumber) break;
    minutes += Number(item.duration || 0) + Number(item.breakAfter || 0);
  }
  return minutesToTime(minutes);
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '08:30').split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(total) {
  const normalized = ((total % 1440) + 1440) % 1440;
  const hours = String(Math.floor(normalized / 60)).padStart(2, '0');
  const minutes = String(normalized % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function renderSchedulePdf(doc, payload) {
  doc.fontSize(18).text(payload.title || 'Расписание');
  doc.moveDown();
  for (const [className, weeks] of Object.entries(payload.classes)) {
    for (const [week, grid] of Object.entries(weeks)) {
      const shift = payload.classMeta?.[className]?.shift || 'morning';
      doc.fontSize(14).text(`${className} · ${shiftLabel(payload, shift)} · ${weekLabel(week)}`);
      doc.moveDown(0.4);
      for (const day of payload.days) {
        doc.fontSize(11).text(day.name, { underline: true });
        for (const period of payload.periods) {
          const cell = grid[day.id]?.[period.number];
          if (cell) {
            doc.fontSize(9).text(`${period.number}. ${periodTime(payload, shift, period.number)} ${cell.subject} · ${cell.teacher || ''} · ${cell.room || ''}`);
          }
        }
        doc.moveDown(0.25);
      }
      doc.addPage();
    }
  }
}

function buildReports({ assignments, teachers, rooms, classes, classAdvisors, latest }) {
  const teacherMap = new Map();
  for (const teacher of teachers) {
    const entry = teacherMap.get(teacher.fullName) || { teacher: teacher.fullName, hours: 0, subjects: new Set(), classes: new Set(), lessons: [] };
    entry.subjects.add(teacher.subjectName);
    teacherMap.set(teacher.fullName, entry);
  }
  for (const assignment of assignments) {
    if (!assignment.teacherName) continue;
    const className = `${assignment.grade}${assignment.letter}`;
    const entry = teacherMap.get(assignment.teacherName) || { teacher: assignment.teacherName, hours: 0, subjects: new Set(), classes: new Set(), lessons: [] };
    entry.hours += Number(assignment.weeklyHours || 0);
    entry.subjects.add(assignment.subjectName);
    entry.classes.add(className);
    entry.lessons.push({ className, subject: assignment.subjectName, hours: assignment.weeklyHours, room: assignment.roomName || '' });
    teacherMap.set(assignment.teacherName, entry);
  }
  const teacherRows = [...teacherMap.values()].map((value) => ({
    teacher: value.teacher,
    hours: value.hours,
    subjects: [...value.subjects].sort((a, b) => a.localeCompare(b, 'ru')),
    classes: [...value.classes].sort(classNameSort),
    lessons: value.lessons.sort((a, b) => classNameSort(a.className, b.className) || a.subject.localeCompare(b.subject, 'ru'))
  })).sort((a, b) => b.hours - a.hours || a.teacher.localeCompare(b.teacher, 'ru'));

  const classRows = classes.map((schoolClass) => {
    const className = `${schoolClass.grade}${schoolClass.letter}`;
    const rows = assignments.filter((item) => `${item.grade}${item.letter}` === className);
    return {
      className,
      level: schoolClass.level,
      shift: shiftLabel({ shifts: json.get('shifts') }, schoolClass.shift),
      hours: rows.reduce((sum, item) => sum + Number(item.weeklyHours || 0), 0),
      subjects: rows.length,
      teachers: [...new Set(rows.map((item) => item.teacherName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
      lessons: rows.map((item) => ({ subject: item.subjectName, teacher: item.teacherName || '', hours: item.weeklyHours, room: item.roomName || '' }))
    };
  });
  const classesByShiftRows = classes.map((schoolClass) => {
    const className = `${schoolClass.grade}${schoolClass.letter}`;
    return {
      className,
      level: schoolClass.level,
      grade: schoolClass.grade,
      letter: schoolClass.letter,
      shift: shiftLabel({ shifts: json.get('shifts') }, schoolClass.shift)
    };
  }).sort((a, b) => a.shift.localeCompare(b.shift, 'ru') || classNameSort(a.className, b.className));

  const advisorRows = classes.map((schoolClass) => {
    const className = `${schoolClass.grade}${schoolClass.letter}`;
    const advisors = classAdvisors.filter((item) => item.classId === schoolClass.id);
    if (!advisors.length) {
      return [{ classId: schoolClass.id, className, level: schoolClass.level, shift: shiftLabel({ shifts: json.get('shifts') }, schoolClass.shift), teacherId: null, teacher: '', room: '', note: '' }];
    }
    return advisors.map((advisor) => ({
      classId: schoolClass.id,
      className,
      level: schoolClass.level,
      shift: shiftLabel({ shifts: json.get('shifts') }, advisor.shift || schoolClass.shift),
      teacherId: advisor.teacherId || null,
      teacher: advisor.teacherName || '',
      room: advisor.roomName || '',
      note: advisor.note || ''
    }));
  }).flat();

  const unassigned = assignments.filter((item) => !item.teacherName).map((item) => `${item.grade}${item.letter}: ${item.subjectName}`);
  const noRoom = assignments.filter((item) => !item.roomName).map((item) => `${item.grade}${item.letter}: ${item.subjectName}`);
  const roomUse = rooms.map((room) => ({
    room: room.name,
    type: room.roomType,
    capacity: room.capacity,
    assignments: assignments.filter((item) => item.roomName === room.name).length,
    classes: [...new Set(assignments.filter((item) => item.roomName === room.name).map((item) => `${item.grade}${item.letter}`))].sort(classNameSort)
  }));
  const windows = latest ? detectTeacherWindows(latest.payload) : [];
  const teacherScheduleRows = latest ? teacherScheduleFromPayload(latest.payload) : [];
  const unscheduled = latest?.payload?.diagnostics || [];
  return {
    teacherRows,
    classRows,
    classesByShiftRows,
    advisorRows,
    unassigned,
    noRoom,
    roomUse,
    windows,
    teacherScheduleRows,
    unscheduled,
    latestSchedule: latest ? { id: latest.id, title: latest.title, createdAt: latest.createdAt } : null
  };
}

function reportSheets(reports) {
  return [
    { name: 'Учителя', rows: [['Учитель', 'Часы', 'Предметы', 'Классы'], ...reports.teacherRows.map((row) => [row.teacher, row.hours, row.subjects.join(', '), row.classes.join(', ')])] },
    { name: 'Учитель-классы', rows: [['Учитель', 'Класс', 'Предмет', 'Часы', 'Кабинет'], ...reports.teacherRows.flatMap((row) => row.lessons.map((lesson) => [row.teacher, lesson.className, lesson.subject, lesson.hours, lesson.room]))] },
    { name: 'Расписание учителей', rows: [['Учитель', 'Класс', 'Смена', 'Неделя', 'День', 'Урок', 'Время', 'Предмет', 'Кабинет'], ...reports.teacherScheduleRows.map((row) => [row.teacher, row.className, row.shift, row.week, row.day, row.period, row.time, row.subject, row.room])] },
    { name: 'Классы', rows: [['Класс', 'Уровень', 'Смена', 'Часы', 'Предметов', 'Учителя'], ...reports.classRows.map((row) => [row.className, row.level, row.shift, row.hours, row.subjects, row.teachers.join(', ')])] },
    { name: 'Классы по сменам', rows: [['Смена', 'Класс', 'Уровень образования', 'Параллель', 'Литерал'], ...reports.classesByShiftRows.map((row) => [row.shift, row.className, row.level, row.grade, row.letter])] },
    { name: 'Класс-предметы', rows: [['Класс', 'Предмет', 'Учитель', 'Часы', 'Кабинет'], ...reports.classRows.flatMap((row) => row.lessons.map((lesson) => [row.className, lesson.subject, lesson.teacher, lesson.hours, lesson.room]))] },
    { name: 'Классные руководители', rows: [['Класс', 'Уровень', 'Смена', 'Классный руководитель', 'Кабинет', 'Примечание'], ...reports.advisorRows.map((row) => [row.className, row.level, row.shift, row.teacher, row.room, row.note])] },
    { name: 'Кабинеты', rows: [['Кабинет', 'Тип', 'Вместимость', 'Назначений', 'Классы'], ...reports.roomUse.map((row) => [row.room, row.type, row.capacity, row.assignments, row.classes.join(', ')])] },
    { name: 'Проблемы', rows: [['Тип', 'Описание'], ...reports.unassigned.map((item) => ['Без учителя', item]), ...reports.noRoom.map((item) => ['Без кабинета', item]), ...reports.unscheduled.map((item) => ['Не запланировано', `${item.className}: ${item.message}`]), ...reports.windows.map((item) => ['Окно учителя', `${item.teacher}: ${item.day}, ${item.gaps.join(', ')}`])] }
  ];
}

function teacherScheduleFromPayload(payload) {
  const rows = [];
  for (const [className, weeks] of Object.entries(payload.classes || {})) {
    const shift = payload.classMeta?.[className]?.shift || 'morning';
    for (const [week, grid] of Object.entries(weeks)) {
      for (const day of payload.days || []) {
        for (const period of payload.periods || []) {
          const cell = grid[day.id]?.[period.number];
          if (!cell?.teacher || cell.teacher === 'Не назначен') continue;
          rows.push({
            teacher: cell.teacher,
            className,
            shift: shiftLabel(payload, shift),
            week: weekLabel(week),
            day: day.name,
            period: period.number,
            time: periodTime(payload, shift, period.number),
            subject: cell.subject,
            room: cell.room || ''
          });
        }
      }
    }
  }
  return rows.sort((a, b) => a.teacher.localeCompare(b.teacher, 'ru') || classNameSort(a.className, b.className) || a.period - b.period);
}

function detectTeacherWindows(payload) {
  const byTeacher = {};
  for (const [className, weeks] of Object.entries(payload.classes || {})) {
    for (const [week, grid] of Object.entries(weeks)) {
      const shift = payload.classMeta?.[className]?.shift || 'morning';
      for (const day of payload.days || []) {
        for (const period of payload.periods || []) {
          const cell = grid[day.id]?.[period.number];
          if (!cell?.teacher) continue;
          const key = `${cell.teacher}|${week}|${shift}|${day.id}`;
          byTeacher[key] ||= { teacher: cell.teacher, week, shift, day: day.name, periods: [] };
          byTeacher[key].periods.push(period.number);
        }
      }
    }
  }
  return Object.values(byTeacher).flatMap((item) => {
    const sorted = item.periods.sort((a, b) => a - b);
    const gaps = [];
    for (let i = sorted[0]; i <= sorted[sorted.length - 1]; i++) {
      if (!sorted.includes(i)) gaps.push(i);
    }
    return gaps.length ? [{ ...item, gaps }] : [];
  });
}

function restoreBackup(backup) {
  const tables = [
    ['schedules', backup.schedules],
    ['schedule_blocks', backup.scheduleBlocks],
    ['teacher_constraints', backup.teacherConstraints],
    ['assignments', backup.assignments],
    ['class_advisor_assignments', backup.classAdvisorAssignments],
    ['class_advisors', backup.classAdvisors],
    ['teachers', backup.teachers],
    ['rooms', backup.rooms],
    ['classes', backup.classes],
    ['subject_grade_hours', backup.subjectGradeHours],
    ['subjects', backup.subjects],
    ['settings', backup.settings]
  ];
  runTransaction(() => {
    for (const [table] of tables) db.exec(`DELETE FROM ${table}`);
    insertRows('subjects', backup.subjects || [], ['id', 'name', 'levels', 'grades', 'difficulty', 'weekly_hours']);
    insertRows('subject_grade_hours', backup.subjectGradeHours || [], ['subject_id', 'grade', 'weekly_hours']);
    insertRows('classes', backup.classes || [], ['id', 'level', 'grade', 'letter', 'shift']);
    insertRows('teachers', backup.teachers || [], ['id', 'full_name', 'subject_name']);
    insertRows('rooms', backup.rooms || [], ['id', 'name', 'room_type', 'capacity']);
    insertRows('class_advisors', backup.classAdvisors || [], ['class_id', 'teacher_id']);
    insertRows('class_advisor_assignments', backup.classAdvisorAssignments || [], ['id', 'class_id', 'teacher_id', 'room_id', 'shift', 'note']);
    insertRows('assignments', backup.assignments || [], ['id', 'class_id', 'subject_id', 'teacher_id', 'room_id', 'weekly_hours']);
    insertRows('teacher_constraints', backup.teacherConstraints || [], ['id', 'teacher_id', 'day_id', 'shift', 'period_number', 'kind']);
    insertRows('schedule_blocks', backup.scheduleBlocks || [], ['id', 'day_id', 'shift', 'class_id', 'period_number', 'reason']);
    insertRows('settings', backup.settings || [], ['key', 'value']);
    insertRows('schedules', backup.schedules || [], ['id', 'title', 'week_mode', 'created_at', 'payload']);
  });
}

function insertRows(table, rows, columns) {
  if (!rows.length) return;
  const placeholders = columns.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
  for (const row of rows) stmt.run(...columns.map((column) => row[column] ?? null));
}
