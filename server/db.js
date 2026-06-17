import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SUBJECTS } from './fgos.js';

const root = path.resolve(process.env.SCHEDULER_DATA_DIR || process.cwd());
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'scheduler.db'));
db.exec('PRAGMA foreign_keys = ON');

export function runTransaction(work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      levels TEXT NOT NULL,
      grades TEXT NOT NULL,
      difficulty INTEGER NOT NULL DEFAULT 3,
      weekly_hours INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS subject_grade_hours (
      subject_id INTEGER NOT NULL,
      grade INTEGER NOT NULL,
      weekly_hours INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(subject_id, grade),
      FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      grade INTEGER NOT NULL,
      letter TEXT NOT NULL,
      shift TEXT NOT NULL DEFAULT 'morning',
      UNIQUE(grade, letter)
    );
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      subject_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      room_type TEXT NOT NULL DEFAULT 'Обычный',
      capacity INTEGER NOT NULL DEFAULT 30
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      teacher_id INTEGER,
      room_id INTEGER,
      weekly_hours INTEGER NOT NULL DEFAULT 1,
      UNIQUE(class_id, subject_id),
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
      FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS class_advisors (
      class_id INTEGER PRIMARY KEY,
      teacher_id INTEGER,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS class_advisor_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      teacher_id INTEGER,
      room_id INTEGER,
      shift TEXT,
      note TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
      FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS teacher_constraints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      day_id TEXT NOT NULL,
      shift TEXT,
      period_number INTEGER,
      kind TEXT NOT NULL DEFAULT 'unavailable',
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id TEXT NOT NULL,
      shift TEXT,
      period_number INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      week_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}'
    );
  `);
  ensureColumn('assignments', 'room_id', 'INTEGER');
  ensureColumn('classes', 'shift', "TEXT NOT NULL DEFAULT 'morning'");
  ensureColumn('teacher_constraints', 'shift', 'TEXT');
  ensureColumn('class_advisor_assignments', 'room_id', 'INTEGER');
  ensureColumn('class_advisor_assignments', 'shift', 'TEXT');
  ensureColumn('class_advisor_assignments', 'note', "TEXT NOT NULL DEFAULT ''");
  migrateLegacyAdvisors();
  seedSubjects();
  seedSubjectGradeHours();
  seedSettings();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrateLegacyAdvisors() {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM class_advisor_assignments').get();
  if (existing.count > 0) return;
  const legacy = db.prepare('SELECT class_id, teacher_id FROM class_advisors WHERE teacher_id IS NOT NULL').all();
  if (!legacy.length) return;
  const stmt = db.prepare('INSERT INTO class_advisor_assignments (class_id, teacher_id, shift, note) VALUES (?, ?, NULL, ?)');
  runTransaction(() => legacy.forEach((row) => stmt.run(row.class_id, row.teacher_id, 'Перенесено из старого формата')));
}

function seedSubjects() {
  const stmt = db.prepare(`
    INSERT INTO subjects (name, levels, grades, difficulty, weekly_hours)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO NOTHING
  `);
  runTransaction(() => {
    for (const item of DEFAULT_SUBJECTS) stmt.run(item.name, JSON.stringify(item.levels), JSON.stringify(item.grades), item.difficulty, item.weeklyHours);
  });
}

function seedSubjectGradeHours() {
  const stmt = db.prepare(`
    INSERT INTO subject_grade_hours (subject_id, grade, weekly_hours)
    VALUES (?, ?, ?)
    ON CONFLICT(subject_id, grade) DO NOTHING
  `);
  const rows = db.prepare('SELECT id, grades, weekly_hours FROM subjects').all();
  runTransaction(() => {
    for (const row of rows) {
      const grades = JSON.parse(row.grades || '[]');
      for (const grade of grades) stmt.run(row.id, grade, row.weekly_hours);
    }
  });
}

function seedSettings() {
  const defaults = {
    days: [
      { id: 'mon', name: 'Понедельник', enabled: true },
      { id: 'tue', name: 'Вторник', enabled: true },
      { id: 'wed', name: 'Среда', enabled: true },
      { id: 'thu', name: 'Четверг', enabled: true },
      { id: 'fri', name: 'Пятница', enabled: true },
      { id: 'sat', name: 'Суббота', enabled: false }
    ],
    periods: [
      { number: 1, duration: 40, breakAfter: 10 },
      { number: 2, duration: 40, breakAfter: 15 },
      { number: 3, duration: 40, breakAfter: 15 },
      { number: 4, duration: 40, breakAfter: 10 },
      { number: 5, duration: 40, breakAfter: 10 },
      { number: 6, duration: 40, breakAfter: 10 },
      { number: 7, duration: 40, breakAfter: 0 }
    ],
    shifts: [
      { id: 'morning', name: '1 смена', startsAt: '08:30', label: 'утро - обед' },
      { id: 'afternoon', name: '2 смена', startsAt: '14:00', label: 'обед - вечер' }
    ],
    sanpin: {
      maxLessonsByGrade: { 1: 4, 2: 5, 3: 5, 4: 5, 5: 6, 6: 6, 7: 7, 8: 7, 9: 7, 10: 7, 11: 7 },
      maxDailyDifficultyByGrade: { 1: 16, 2: 18, 3: 19, 4: 20, 5: 24, 6: 25, 7: 26, 8: 27, 9: 28, 10: 29, 11: 29 }
    },
    admin: passwordRecord('admin', true)
  };
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) stmt.run(key, JSON.stringify(value));
  ensureAdminPasswordHash();
}

function passwordRecord(password, forceChange = false) {
  return {
    passwordHash: hashPassword(password),
    forceChange,
    updatedAt: new Date().toISOString()
  };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const cost = { n: 16384, r: 8, p: 1 };
  const hash = scryptSync(String(password), salt, 64, {
    N: cost.n,
    r: cost.r,
    p: cost.p,
    maxmem: 64 * 1024 * 1024
  }).toString('base64url');
  return `scrypt$${cost.n}$${cost.r}$${cost.p}$${salt}$${hash}`;
}

function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, expectedHash] = parts;
  const expected = Buffer.from(expectedHash, 'base64url');
  const actual = scryptSync(String(password), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function ensureAdminPasswordHash() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin');
  if (!row) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('admin', JSON.stringify(passwordRecord('admin', true)));
    return;
  }
  const admin = JSON.parse(row.value || '{}');
  if (admin.passwordHash) return;
  const plainPassword = String(admin.password || 'admin');
  db.prepare('UPDATE settings SET value = ? WHERE key = ?')
    .run(JSON.stringify(passwordRecord(plainPassword, plainPassword === 'admin')), 'admin');
}

export function verifyAdminPassword(password) {
  ensureAdminPasswordHash();
  const admin = JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get('admin')?.value || '{}');
  return {
    ok: verifyPassword(password, admin.passwordHash),
    forceChange: Boolean(admin.forceChange)
  };
}

export function setAdminPassword(password) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('admin', JSON.stringify(passwordRecord(password, false)));
}

export const json = {
  get(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  },
  set(key, value) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }
};

export function allSubjects() {
  const hoursRows = db.prepare('SELECT subject_id AS subjectId, grade, weekly_hours AS weeklyHours FROM subject_grade_hours ORDER BY grade').all();
  const hoursBySubject = new Map();
  for (const row of hoursRows) {
    const current = hoursBySubject.get(row.subjectId) || {};
    current[row.grade] = row.weeklyHours;
    hoursBySubject.set(row.subjectId, current);
  }
  return db.prepare('SELECT * FROM subjects ORDER BY name').all().map((row) => {
    const parallelHours = hoursBySubject.get(row.id) || {};
    return {
      id: row.id,
      name: row.name,
      levels: JSON.parse(row.levels),
      grades: Object.keys(parallelHours).map(Number).sort((a, b) => a - b),
      difficulty: row.difficulty,
      weeklyHours: row.weekly_hours,
      parallelHours
    };
  });
}

export function allClasses() {
  return db.prepare('SELECT * FROM classes ORDER BY grade, letter').all().map((row) => ({
    id: row.id,
    level: row.level,
    grade: row.grade,
    letter: row.letter,
    shift: row.shift || 'morning'
  }));
}

export function allTeachers() {
  return db.prepare('SELECT * FROM teachers ORDER BY full_name').all().map((row) => ({
    id: row.id,
    fullName: row.full_name,
    subjectName: row.subject_name
  }));
}

export function allRooms() {
  return db.prepare('SELECT id, name, room_type AS roomType, capacity FROM rooms ORDER BY name').all();
}

export function allClassAdvisors() {
  return db.prepare(`
    SELECT ca.id, ca.class_id AS classId, ca.teacher_id AS teacherId, ca.room_id AS roomId,
           ca.shift, ca.note,
           c.grade, c.letter, c.level, c.shift AS classShift,
           t.full_name AS teacherName, r.name AS roomName
    FROM class_advisor_assignments ca
    JOIN classes c ON c.id = ca.class_id
    LEFT JOIN teachers t ON t.id = ca.teacher_id
    LEFT JOIN rooms r ON r.id = ca.room_id
    ORDER BY c.grade, c.letter
  `).all();
}

export function allTeacherConstraints() {
  return db.prepare(`
    SELECT tc.id, tc.teacher_id AS teacherId, tc.day_id AS dayId, tc.shift,
           tc.period_number AS periodNumber,
           tc.kind, t.full_name AS teacherName
    FROM teacher_constraints tc
    JOIN teachers t ON t.id = tc.teacher_id
    ORDER BY t.full_name, tc.day_id, tc.period_number
  `).all();
}

export function allScheduleBlocks() {
  return db.prepare(`
    SELECT id, day_id AS dayId, shift, period_number AS periodNumber, reason
    FROM schedule_blocks
    ORDER BY day_id, shift, period_number
  `).all();
}

export function allAssignments() {
  return db.prepare(`
    SELECT a.id, a.class_id AS classId, a.subject_id AS subjectId, a.teacher_id AS teacherId,
           a.room_id AS roomId, a.weekly_hours AS weeklyHours, s.name AS subjectName, s.difficulty,
           t.full_name AS teacherName, r.name AS roomName, c.grade, c.letter, c.level, c.shift
    FROM assignments a
    JOIN subjects s ON s.id = a.subject_id
    JOIN classes c ON c.id = a.class_id
    LEFT JOIN teachers t ON t.id = a.teacher_id
    LEFT JOIN rooms r ON r.id = a.room_id
    ORDER BY c.grade, c.letter, s.name
  `).all();
}

export function audit(action, entity, details = {}) {
  db.prepare('INSERT INTO audit_log (created_at, action, entity, details) VALUES (?, ?, ?, ?)')
    .run(new Date().toISOString(), action, entity, JSON.stringify(details));
}

export function allAuditLog(limit = 80) {
  return db.prepare('SELECT id, created_at AS createdAt, action, entity, details FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((row) => ({ ...row, details: JSON.parse(row.details || '{}') }));
}
