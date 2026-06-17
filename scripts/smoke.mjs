import { db, migrate, runTransaction, allSubjects, allClasses, allTeachers, allRooms, setAdminPassword } from '../server/db.js';
import { strFromU8, unzipSync } from 'fflate';

const base = 'http://127.0.0.1:4173/api';

migrate();
setAdminPassword('admin');
runTransaction(() => {
  db.exec('DELETE FROM audit_log; DELETE FROM schedules; DELETE FROM teacher_constraints; DELETE FROM assignments; DELETE FROM class_advisors; DELETE FROM teachers; DELETE FROM rooms; DELETE FROM classes;');
});

let token = '';
const request = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : Buffer.from(await response.arrayBuffer());
};
const download = async (path) => {
  const response = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    name: response.headers.get('content-disposition') || ''
  };
};

const denied = await fetch(`${base}/backup.json`);
if (denied.status !== 401) throw new Error('Backup без токена должен быть закрыт');
const login = await request('/login', { method: 'POST', body: { password: 'admin' } });
if (!login.ok || !login.token) throw new Error('Вход администратора не выдал токен');
token = login.token;

await request('/classes', { method: 'POST', body: { classes: [
  { level: 'НОО', grade: 1, letter: 'А', shift: 'morning' },
  { level: 'ООО', grade: 5, letter: 'А', shift: 'afternoon' }
] } });
await request('/rooms', { method: 'POST', body: { rooms: [{ name: '101', roomType: 'Обычный', capacity: 30 }] } });
await request('/teachers', { method: 'POST', body: { fullName: 'Иванова Мария Петровна', subjects: ['Математика', 'Информатика'] } });

const health = await request('/health');
let boot = await request('/bootstrap');
const advisorTeacher = boot.teachers.find((item) => item.fullName === 'Иванова Мария Петровна');
await request('/class-advisors', {
  method: 'POST',
  body: { advisors: boot.classes.map((item) => ({ classId: item.id, teacherId: advisorTeacher.id })) }
});
boot = await request('/bootstrap');
const schedule = await request('/generate', { method: 'POST', body: { classIds: boot.classes.map((item) => item.id), weekMode: 'one' } });
await request(`/schedules/${schedule.id}/swap`, {
  method: 'POST',
  body: { className: '1А', week: 'single', from: { dayId: 'mon', periodNumber: 1 }, to: { dayId: 'mon', periodNumber: 2 } }
});
const reports = await request('/reports');
const backup = await request('/backup.json');
const pdf = await request(`/export/schedules/${schedule.id}.pdf`);
const gridExport = await download(`/export/schedules/${schedule.id}.grid.xlsx`);
const reportsExport = await download('/reports.xlsx');
const scheduleTemplate = await download('/templates/schedule.xlsx');
const teachersTemplate = await download('/templates/teachers.xlsx');

if (allSubjects().length < 30) throw new Error('ФГОС-предметы не загружены');
if (!health.ok || health.subjects < 30) throw new Error('Health неверный');
if (allClasses().length !== 2) throw new Error('Классы не созданы');
if (allTeachers().length !== 2) throw new Error('Учитель/предметы не созданы');
if (allRooms().length !== 1) throw new Error('Кабинет не создан');
if (!reports.classRows.length || !reports.teacherRows.length) throw new Error('Отчеты пустые');
if (!reports.advisorRows.every((item) => item.teacher === 'Иванова Мария Петровна')) throw new Error('Классные руководители не попали в отчеты');
if (backup.version !== 1) throw new Error('Backup неверный');
if (pdf.slice(0, 4).toString() !== '%PDF') throw new Error('PDF неверный');
if (!xlsxText(gridExport.body).includes('Все классы') || !xlsxText(gridExport.body).includes('1 урок')) throw new Error('Сеточный экспорт расписания неверный');
if (!xlsxText(reportsExport.body).includes('Классные руководители') || !xlsxText(reportsExport.body).includes('Учитель-классы')) throw new Error('Excel-отчеты неверные');
if (scheduleTemplate.body.slice(0, 2).toString() !== 'PK') throw new Error('Шаблон расписания неверный');
if (teachersTemplate.body.slice(0, 2).toString() !== 'PK') throw new Error('Шаблон учителей неверный');
if (!xlsxText(scheduleTemplate.body).includes('Формат ячейки') || !xlsxText(scheduleTemplate.body).includes('Все классы')) throw new Error('Шаблон расписания не в виде обычной сетки');
if (!xlsxText(teachersTemplate.body).includes('Предмет 10')) throw new Error('Шаблон учителей не рассчитан на много предметов');
if (!gridExport.name.includes(encodeURIComponent(`Все-расписание-сеткой-${schedule.id}.xlsx`))) throw new Error('Имя файла сеточного расписания неверное');
if (!reportsExport.name.includes(encodeURIComponent('Отчеты-расписание.xlsx'))) throw new Error('Имя файла отчетов неверное');
if (!scheduleTemplate.name.includes(encodeURIComponent('Шаблон-расписания-всей-школы.xlsx'))) throw new Error('Имя шаблона расписания неверное');
if (!teachersTemplate.name.includes(encodeURIComponent('Шаблон-импорта-учителей.xlsx'))) throw new Error('Имя шаблона учителей неверное');

runTransaction(() => {
  db.exec('DELETE FROM audit_log; DELETE FROM schedules; DELETE FROM teacher_constraints; DELETE FROM assignments; DELETE FROM class_advisors; DELETE FROM teachers; DELETE FROM rooms; DELETE FROM classes;');
});

console.log(JSON.stringify({ ok: true, subjects: allSubjects().length, classes: allClasses().length, teachers: allTeachers().length, rooms: allRooms().length }));

function xlsxText(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  return Object.values(files).map((file) => strFromU8(file)).join('\n');
}
