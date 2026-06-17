import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3, BookOpen, CalendarDays, Check, ChevronRight, Database, Download, FileDown, FileSpreadsheet,
  DoorOpen, KeyRound, MoonStar, Play, Plus, Printer, Save, School,
  RefreshCw, ShieldCheck, Sparkles, Trash2, Upload, Users
} from 'lucide-react';
import './styles.css';

const API = '/api';
const APP_NAME = 'Аманат Расписание';
const APP_SUBTITLE = 'Разработка школьного расписания';
const APP_AUTHOR = 'Латипов Саид Ахмедович';
const DRAFT_KEY = 'amanat-scheduler-draft';
const LEVELS = ['НОО', 'ООО', 'СОО'];
const SHIFTS = [
  { id: 'morning', name: '1 смена', label: 'утро - обед' },
  { id: 'afternoon', name: '2 смена', label: 'обед - вечер' }
];
const STEPS = [
  ['Классы', School],
  ['Предметы', BookOpen],
  ['Учителя', Users],
  ['Кабинеты', DoorOpen],
  ['Связки', Sparkles],
  ['Ограничения', ShieldCheck],
  ['Время', CalendarDays],
  ['Система', Database],
  ['Создание', Play]
];

function App() {
  const [logged, setLogged] = useState(false);
  const [step, setStep] = useState(0);
  const [state, setState] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [selectedClasses, setSelectedClasses] = useState([]);
  const [weekMode, setWeekMode] = useState('one');
  const [notice, setNotice] = useState('');
  const [hasDraft, setHasDraft] = useState(() => Boolean(localStorage.getItem(DRAFT_KEY)));
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [runtimeStatus, setRuntimeStatus] = useState(null);

  async function refresh() {
    const data = await api('/bootstrap');
    setState(data);
    setSelectedClasses(data.classes.map((item) => item.id));
  }

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      step,
      selectedClasses,
      weekMode,
      schedule
    }));
    setHasDraft(true);
    setNotice('Черновик сохранен');
  }

  function loadDraft() {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) {
      setNotice('Черновик не найден');
      return;
    }
    const draft = JSON.parse(raw);
    setStep(Math.min(Math.max(Number(draft.step || 0), 0), STEPS.length - 1));
    setSelectedClasses(Array.isArray(draft.selectedClasses) ? draft.selectedClasses : []);
    setWeekMode(draft.weekMode || 'one');
    setSchedule(draft.schedule || null);
    setNotice('Черновик загружен');
  }

  useEffect(() => {
    refresh().catch(() => setNotice('Сервер не отвечает'));
  }, []);

  useEffect(() => {
    if (!window.schoolUpdater) return undefined;
    window.schoolUpdater.status().then(setUpdateStatus).catch(() => {});
    return window.schoolUpdater.onStatus(setUpdateStatus);
  }, []);

  useEffect(() => {
    if (!window.schoolRuntime) return undefined;
    window.schoolRuntime.status().then(setRuntimeStatus).catch(() => {});
    return window.schoolRuntime.onStatus(setRuntimeStatus);
  }, []);

  if (!state) return <main className="loading">Открываю школьный гримуар...</main>;
  if (!logged) {
    return (
      <main className="login-shell">
        <Login setLogged={setLogged} setStep={setStep} setNotice={setNotice} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div>
            <b>{APP_NAME}</b>
            <span>{APP_SUBTITLE}</span>
          </div>
        </div>
        <nav>
          {STEPS.map(([label, Icon], index) => (
            <button className={step === index ? 'active' : ''} key={label} onClick={() => setStep(index)}>
              <Icon size={18} />
              <span>{label}</span>
              {index < step && <Check size={15} />}
            </button>
          ))}
        </nav>
        <div className="vault-status">
          <span>{state.classes.length} классов</span>
          <span>{state.subjects.length} предметов</span>
          <span>{state.teachers.length} учителей</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Мастер составления</p>
            <h1>{STEPS[step][0]}</h1>
          </div>
          <div className="topbar-actions">
            {notice && <output>{notice}</output>}
            {window.schoolUpdater && <UpdateControl status={updateStatus} setNotice={setNotice} />}
            <button onClick={() => setTrainingOpen(true)}><BookOpen size={18} /> Обучение</button>
            {hasDraft && <button onClick={loadDraft}><FileDown size={18} /> Загрузить черновик</button>}
            <button onClick={() => {
              setLogged(false);
              setStep(0);
              setSchedule(null);
              setNotice('');
            }}><KeyRound size={18} /> Выход</button>
          </div>
        </header>
        {trainingOpen && <TrainingPanel onClose={() => setTrainingOpen(false)} />}

        {step === 0 && <Classes state={state} refresh={refresh} setNotice={setNotice} />}
        {step === 1 && <Subjects state={state} refresh={refresh} setNotice={setNotice} />}
        {step === 2 && <Teachers state={state} refresh={refresh} setNotice={setNotice} />}
        {step === 3 && <Rooms state={state} refresh={refresh} setNotice={setNotice} />}
        {step === 4 && <Assignments state={state} refresh={refresh} setNotice={setNotice} />}
        {step === 5 && <Constraints state={state} refresh={refresh} setNotice={setNotice} />}
        {step === 6 && <TimeSettings state={state} refresh={refresh} setNotice={setNotice} />}
        {step === 7 && <SystemPanel state={state} refresh={refresh} setNotice={setNotice} runtimeStatus={runtimeStatus} />}
        {step === 8 && (
          <Generate
            state={state}
            selectedClasses={selectedClasses}
            setSelectedClasses={setSelectedClasses}
            weekMode={weekMode}
            setWeekMode={setWeekMode}
            schedule={schedule}
            setSchedule={setSchedule}
            setNotice={setNotice}
            refresh={refresh}
          />
        )}

        {step < STEPS.length - 1 && (
          <div className="flow-actions">
            <button className="primary" onClick={() => setStep(step + 1)}>
              Далее <ChevronRight size={18} />
            </button>
          </div>
        )}
        <button className="draft-button" onClick={saveDraft}><Save size={18} /> Сохранить черновик</button>
      </section>
    </main>
  );
}

function Login({ setLogged, setStep, setNotice }) {
  const [password, setPassword] = useState('');
  async function submit(event) {
    event.preventDefault();
    const result = await api('/login', { method: 'POST', body: { password } });
    setLogged(result.ok);
    setNotice(result.ok ? 'Администратор вошел' : 'Пароль неверный');
    if (result.ok) setStep(0);
  }
  return (
    <section className="ritual-panel hero-panel">
      <div className="sigil" aria-hidden="true" />
      <div className="hero-copy">
        <h2 className="school-name">{APP_NAME}</h2>
        <p className="school-subtitle">{APP_SUBTITLE}</p>
        <form onSubmit={submit} className="login-row">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль администратора: admin" />
          <button className="primary"><KeyRound size={18} /> Войти</button>
        </form>
      </div>
    </section>
  );
}

function TrainingPanel({ onClose }) {
  const steps = [
    ['Классы', 'Создайте НОО, ООО и СОО. Для каждого класса укажите номер, литеру и смену: 1 смена утро - обед, 2 смена обед - вечер.'],
    ['Предметы', 'Выберите предмет слева. Справа отметьте параллели 1-11 и задайте часы в неделю для каждой параллели отдельно.'],
    ['Учителя', 'Импортируйте Excel с колонками ФИО и предмет или добавьте учителя вручную. При необходимости выберите учителя и добавьте ему еще предметы.'],
    ['Кабинеты', 'Добавьте кабинеты и их типы. Кабинет можно закрепить в связках, чтобы генератор не ставил два класса в одно место.'],
    ['Связки', 'Проверьте строки класс-предмет-учитель. Назначьте учителя, кабинет и недельные часы для каждого урока.'],
    ['Ограничения', 'Укажите дни, смены или уроки, когда учитель недоступен. Пустой номер урока блокирует весь день.'],
    ['Время', 'Включите учебные дни, задайте старт обеих смен, длительность уроков, перемены и лимиты СанПиН по классам.'],
    ['Создание', 'Выберите одну неделю, четную или нечетную, отметьте нужные классы и нажмите создать расписание. После генерации можно редактировать ячейки и экспортировать Excel, PDF или печать.']
  ];
  const checklist = [
    'У каждого класса выбрана смена.',
    'У предметов заполнены часы по нужным параллелям.',
    'В связках нет строк без учителя для важных предметов.',
    'Время первой и второй смены не пересекается.',
    'Ограничения учителей сохранены до генерации.'
  ];

  return (
    <section className="training-panel" role="dialog" aria-modal="true" aria-label="Обучение настройке расписания">
      <div className="training-head">
        <div>
          <p className="eyebrow">обучение</p>
          <h2>Как настроить расписание</h2>
        </div>
        <button onClick={onClose}>Закрыть</button>
      </div>
      <div className="training-layout">
        <div className="training-steps">
          {steps.map(([title, text], index) => (
            <article className="training-step" key={title}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
        <aside className="training-checklist">
          <PanelTitle icon={ShieldCheck} title="Перед кнопкой создать" />
          {checklist.map((item) => (
            <p key={item}><Check size={16} /> {item}</p>
          ))}
          <div className="training-note">
            <b>Черновик</b>
            <span>Кнопка снизу справа сохраняет выбранный шаг, классы, режим недели и текущее расписание.</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function UpdateControl({ status, setNotice }) {
  const [open, setOpen] = useState(false);
  const state = status?.state || 'idle';
  const canDownload = state === 'available';
  const canInstall = state === 'downloaded';

  async function check() {
    const result = await window.schoolUpdater.check();
    setNotice(result.message || 'Проверка обновлений запущена');
    setOpen(true);
  }

  async function download() {
    const result = await window.schoolUpdater.download();
    setNotice(result.message || 'Скачивание обновления');
  }

  async function install() {
    await window.schoolUpdater.install();
  }

  return (
    <div className="update-control">
      <button onClick={() => setOpen(!open)}><RefreshCw size={18} /> Обновления</button>
      {open && (
        <div className="update-popover">
          <b>{status?.message || 'Обновления не проверялись'}</b>
          <div className="segmented mini">
            <button onClick={check}><RefreshCw size={16} /> Проверить</button>
            {canDownload && <button onClick={download}><Download size={16} /> Скачать</button>}
            {canInstall && <button className="primary" onClick={install}><Check size={16} /> Установить</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function Classes({ state, refresh, setNotice }) {
  const [rows, setRows] = useState([{ level: 'НОО', grade: 1, letter: 'А', shift: 'morning' }]);
  function addLevel(level) {
    setRows([...rows, { level, grade: level === 'НОО' ? 1 : level === 'ООО' ? 5 : 10, letter: 'А', shift: level === 'СОО' ? 'afternoon' : 'morning' }]);
  }
  async function save() {
    await api('/classes', { method: 'POST', body: { classes: rows.map((row) => ({ ...row, grade: Number(row.grade) })) } });
    await refresh();
    setNotice('Классы созданы, предметы привязаны по параллелям');
  }
  async function remove(id) {
    await api(`/classes/${id}`, { method: 'DELETE' });
    await refresh();
    setNotice('Класс удален');
  }
  return (
    <section className="grid-two">
      <div className="panel">
        <PanelTitle icon={School} title="Создать классы" />
        <div className="segmented">{LEVELS.map((level) => <button key={level} onClick={() => addLevel(level)}><Plus size={16} /> {level}</button>)}</div>
        {rows.map((row, index) => (
          <div className="row-edit" key={index}>
            <select value={row.level} onChange={(e) => updateRows(rows, setRows, index, 'level', e.target.value)}>{LEVELS.map((level) => <option key={level}>{level}</option>)}</select>
            <input type="number" min="1" max="11" value={row.grade} onChange={(e) => updateRows(rows, setRows, index, 'grade', e.target.value)} />
            <input value={row.letter} onChange={(e) => updateRows(rows, setRows, index, 'letter', e.target.value)} />
            <select value={row.shift} onChange={(e) => updateRows(rows, setRows, index, 'shift', e.target.value)}>
              {shiftOptions(state).map((shift) => <option value={shift.id} key={shift.id}>{shift.name}</option>)}
            </select>
          </div>
        ))}
        <button className="primary" onClick={save}><Check size={18} /> Сохранить классы</button>
      </div>
      <div className="panel list-panel">
        <PanelTitle icon={FileSpreadsheet} title="Созданные классы" />
        <div>{state.classes.length ? state.classes.map((item) => (
          <p className="action-line" key={item.id}>
            <span>{item.grade}{item.letter} · {item.level} · {shiftName(state, item.shift)}</span>
            <button onClick={() => remove(item.id)} title="Удалить"><Trash2 size={16} /></button>
          </p>
        )) : <p className="hint">Пока пусто</p>}</div>
      </div>
    </section>
  );
}

function Subjects({ state, refresh, setNotice }) {
  const [name, setName] = useState('');
  const [newDifficulty, setNewDifficulty] = useState(3);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(state.subjects[0]?.id || null);
  const selected = state.subjects.find((item) => item.id === selectedId) || state.subjects[0];
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      ...selected,
      parallelHours: Object.fromEntries(Array.from({ length: 11 }, (_, i) => {
        const grade = i + 1;
        return [grade, Number(selected.parallelHours?.[grade] || 0)];
      }))
    });
  }, [selected?.id, state.subjects]);

  async function add() {
    if (!name.trim()) return;
    await api('/subjects', { method: 'POST', body: { subjects: [{ name, levels: LEVELS, grades: [], difficulty: Number(newDifficulty), weeklyHours: 1, parallelHours: {} }] } });
    setName('');
    setNewDifficulty(3);
    await refresh();
    setNotice('Предмет добавлен');
  }
  async function remove(id) {
    await api(`/subjects/${id}`, { method: 'DELETE' });
    await refresh();
    setNotice('Предмет удален');
  }
  async function save() {
    const parallelHours = Object.fromEntries(Object.entries(draft.parallelHours).filter(([, hours]) => Number(hours) > 0).map(([grade, hours]) => [grade, Number(hours)]));
    const grades = Object.keys(parallelHours).map(Number);
    await api('/subjects', { method: 'POST', body: { subjects: [{
      name: draft.name,
      levels: levelsForGrades(grades),
      grades,
      difficulty: Number(draft.difficulty),
      weeklyHours: Math.max(1, ...Object.values(parallelHours).map(Number), 1),
      parallelHours
    }] } });
    await refresh();
    setNotice('Настройки предмета сохранены');
  }
  return (
    <section className="subject-editor">
      <div className="panel subject-list-panel">
        <PanelTitle icon={BookOpen} title="Предметы" />
        <p className="hint">Список отсортирован по алфавиту. Выберите предмет и настройте часы по параллелям.</p>
        <FileUpload label="Импорт предметов" endpoint="/import/subjects" refresh={refresh} setNotice={setNotice} />
        <button className="rules-button" onClick={() => setRulesOpen(true)}><ShieldCheck size={17} /> Правила оценки сложности уроков</button>
        <div className="subject-add-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новый предмет" />
          <label>
            <span>Сложность</span>
            <input type="number" min="1" max="5" value={newDifficulty} onChange={(e) => setNewDifficulty(Number(e.target.value))} />
          </label>
          <button onClick={add}><Plus size={16} /> Добавить</button>
        </div>
        {rulesOpen && <DifficultyRulesModal onClose={() => setRulesOpen(false)} />}
        <div className="subject-list">
          {state.subjects.map((subject) => (
            <button key={subject.id} className={selected?.id === subject.id ? 'active' : ''} onClick={() => setSelectedId(subject.id)}>
              <span>{subject.name}</span>
              <small>
                <b className={`difficulty-pill difficulty-${subject.difficulty}`}>{subject.difficulty}/5 · {difficultyLabel(subject.difficulty)}</b>
                {subject.grades.length ? `${subject.grades.join(', ')} параллели` : 'не привязан'}
              </small>
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <PanelTitle icon={Sparkles} title="Настройки предмета" />
        {draft ? (
          <>
            <div className="subject-settings-head">
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <label>
                <span>Сложность по ФГОС-шкале</span>
                <input type="number" min="1" max="5" value={draft.difficulty} onChange={(e) => setDraft({ ...draft, difficulty: Number(e.target.value) })} />
              </label>
              <button onClick={() => remove(draft.id)}><Trash2 size={16} /> Удалить</button>
            </div>
            <p className="difficulty-current">
              <span className={`difficulty-pill difficulty-${draft.difficulty}`}>{draft.difficulty}/5 · {difficultyLabel(draft.difficulty)}</span>
              <span>{difficultyDescription(draft.difficulty)}</span>
            </p>
            <div className="parallel-grid">
              <b>Параллель</b><b>Часов в неделю</b><b>Привязка</b>
              {Array.from({ length: 11 }, (_, i) => i + 1).map((grade) => {
                const hours = Number(draft.parallelHours?.[grade] || 0);
                return (
                  <React.Fragment key={grade}>
                    <span>{grade}</span>
                    <input type="number" min="0" max="12" value={hours} onChange={(e) => setDraft({ ...draft, parallelHours: { ...draft.parallelHours, [grade]: Number(e.target.value) } })} />
                    <label>
                      <input type="checkbox" checked={hours > 0} onChange={(e) => setDraft({ ...draft, parallelHours: { ...draft.parallelHours, [grade]: e.target.checked ? Math.max(1, hours || 1) : 0 } })} />
                      {hours > 0 ? 'активна' : 'нет'}
                    </label>
                  </React.Fragment>
                );
              })}
            </div>
            <button className="primary" onClick={save}><Save size={18} /> Сохранить настройки</button>
          </>
        ) : <p className="hint">Выберите предмет</p>}
      </div>
    </section>
  );
}

function DifficultyRulesModal({ onClose }) {
  const rules = [
    ['1', 'Двигательная или творческая разгрузка: физкультура, музыка, ИЗО.'],
    ['2', 'Практический предмет с умеренной теорией: технология, ОРКСЭ, ОДНКНР.'],
    ['3', 'Средняя нагрузка: окружающий мир, ОБЗР, проект, второй иностранный.'],
    ['4', 'Высокая текстовая или понятийная нагрузка: литература, история, география, биология, информатика, иностранный язык.'],
    ['5', 'Максимальная абстрактная и расчетная нагрузка: русский язык, математика, алгебра, геометрия, физика, химия.']
  ];
  return (
    <section className="training-panel rules-modal" role="dialog" aria-modal="true" aria-label="Правила оценки сложности уроков">
      <div className="training-head">
        <div>
          <p className="eyebrow">сложность уроков</p>
          <h2>Правила оценки сложности</h2>
        </div>
        <button onClick={onClose}>Закрыть</button>
      </div>
      <p className="rules-lead">Шкала 1-5 нужна генератору: сложные уроки он ставит раньше, легкие ближе к концу дня.</p>
      <div className="difficulty-rules-grid">
        {rules.map(([score, text]) => (
          <article key={score}>
            <b>{score}</b>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Teachers({ state, refresh, setNotice }) {
  const teacherGroups = useMemo(() => groupTeachers(state.teachers), [state.teachers]);
  const [fullName, setFullName] = useState('');
  const [subjectText, setSubjectText] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState(teacherGroups[0]?.fullName || '');
  const [extraSubjectText, setExtraSubjectText] = useState('');

  useEffect(() => {
    if (!selectedTeacher && teacherGroups[0]) setSelectedTeacher(teacherGroups[0].fullName);
  }, [teacherGroups, selectedTeacher]);

  async function addTeacher() {
    const subjects = parseSubjectText(subjectText);
    if (!fullName.trim() || subjects.length === 0) {
      setNotice('Введите ФИО и хотя бы один предмет');
      return;
    }
    await api('/teachers', { method: 'POST', body: { fullName, subjects } });
    setFullName('');
    setSubjectText('');
    await refresh();
    setNotice('Учитель добавлен');
  }

  async function addSubjects() {
    const subjects = parseSubjectText(extraSubjectText);
    if (!selectedTeacher || subjects.length === 0) {
      setNotice('Выберите учителя и предметы');
      return;
    }
    await api(`/teachers/${encodeURIComponent(selectedTeacher)}/subjects`, { method: 'POST', body: { subjects } });
    setExtraSubjectText('');
    await refresh();
    setNotice('Дополнительные предметы добавлены');
  }
  async function removeTeacher(fullName) {
    await api(`/teachers/by-name/${encodeURIComponent(fullName)}`, { method: 'DELETE' });
    await refresh();
    setNotice('Учитель удален');
  }

  return (
    <section className="grid-two">
      <div className="panel">
        <PanelTitle icon={Users} title="Импорт сотрудников" />
        <p className="hint">Excel: первый столбец ФИО, второй столбец предмет.</p>
        <FileUpload label="Загрузить сотрудников" endpoint="/import/teachers" refresh={refresh} setNotice={setNotice} />
        <div className="manual-teacher">
          <h3>Добавить вручную</h3>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="ФИО учителя" />
          <input value={subjectText} onChange={(e) => setSubjectText(e.target.value)} placeholder="Предметы через запятую: математика, информатика" />
          <button className="primary" onClick={addTeacher}><Plus size={18} /> Добавить учителя</button>
        </div>
        <div className="manual-teacher">
          <h3>Дополнительные предметы</h3>
          <select value={selectedTeacher} onChange={(e) => setSelectedTeacher(e.target.value)}>
            <option value="">Выберите учителя</option>
            {teacherGroups.map((teacher) => <option value={teacher.fullName} key={teacher.fullName}>{teacher.fullName}</option>)}
          </select>
          <input value={extraSubjectText} onChange={(e) => setExtraSubjectText(e.target.value)} placeholder="Новые предметы через запятую" />
          <button onClick={addSubjects}><BookOpen size={18} /> Добавить предметы</button>
        </div>
      </div>
      <div className="panel list-panel">
        <PanelTitle icon={FileSpreadsheet} title="Учителя" />
        <div>{teacherGroups.length ? teacherGroups.map((item) => (
          <p className="action-line" key={item.fullName}>
            <span>{item.fullName} · {item.subjects.join(', ')}</span>
            <button onClick={() => removeTeacher(item.fullName)} title="Удалить"><Trash2 size={16} /></button>
          </p>
        )) : <p className="hint">Пока пусто</p>}</div>
      </div>
    </section>
  );
}

function Rooms({ state, refresh, setNotice }) {
  const [rows, setRows] = useState(state.rooms.length ? state.rooms : [
    { name: '101', roomType: 'Обычный', capacity: 30 },
    { name: 'Спортзал', roomType: 'Спорт', capacity: 60 },
    { name: 'Информатика', roomType: 'Компьютерный', capacity: 24 }
  ]);
  useEffect(() => setRows(state.rooms.length ? state.rooms : rows), [state.rooms]);
  async function save() {
    await api('/rooms', { method: 'POST', body: { rooms: rows.map((row) => ({ ...row, capacity: Number(row.capacity) || 30 })) } });
    await refresh();
    setNotice('Кабинеты сохранены');
  }
  async function remove(id) {
    await api(`/rooms/${id}`, { method: 'DELETE' });
    await refresh();
    setNotice('Кабинет удален');
  }
  return (
    <section className="grid-two">
      <div className="panel">
        <PanelTitle icon={DoorOpen} title="Кабинеты" />
        <p className="hint">Кабинет можно закрепить за предметом в связках. Генератор не ставит два класса в один кабинет на один урок.</p>
        <FileUpload label="Импорт кабинетов" endpoint="/import/rooms" refresh={refresh} setNotice={setNotice} />
        {rows.map((row, index) => (
          <div className="row-edit room-row" key={index}>
            <input value={row.name} onChange={(e) => updateRows(rows, setRows, index, 'name', e.target.value)} placeholder="Кабинет" />
            <input value={row.roomType} onChange={(e) => updateRows(rows, setRows, index, 'roomType', e.target.value)} placeholder="Тип" />
            <input type="number" min="1" value={row.capacity} onChange={(e) => updateRows(rows, setRows, index, 'capacity', Number(e.target.value))} />
          </div>
        ))}
        <div className="segmented">
          <button onClick={() => setRows([...rows, { name: '', roomType: 'Обычный', capacity: 30 }])}><Plus size={16} /> Добавить</button>
          <button className="primary" onClick={save}><Save size={18} /> Сохранить кабинеты</button>
        </div>
      </div>
      <div className="panel list-panel">
        <PanelTitle icon={FileSpreadsheet} title="Список кабинетов" />
        <div>{state.rooms.length ? state.rooms.map((item) => (
          <p className="action-line" key={item.id}>
            <span>{item.name} · {item.roomType} · {item.capacity} мест</span>
            <button onClick={() => remove(item.id)} title="Удалить"><Trash2 size={16} /></button>
          </p>
        )) : <p className="hint">Пока пусто</p>}</div>
      </div>
    </section>
  );
}

function Assignments({ state, refresh, setNotice }) {
  const [rows, setRows] = useState(state.assignments);
  useEffect(() => setRows(state.assignments), [state.assignments]);
  const teachersBySubject = useMemo(() => {
    const map = new Map();
    for (const teacher of state.teachers) {
      const key = teacher.subjectName.toLowerCase();
      map.set(key, [...(map.get(key) || []), teacher]);
    }
    return map;
  }, [state.teachers]);
  async function save() {
    await api('/assignments', { method: 'POST', body: { assignments: rows } });
    await refresh();
    setNotice('Связки учитель-класс-предмет сохранены');
  }
  return (
    <section className="panel">
      <PanelTitle icon={Sparkles} title="Кто ведет какой урок" />
      <div className="assignment-table">
        <b>Класс</b><b>Предмет</b><b>Учитель</b><b>Кабинет</b><b>Часы</b>
        {rows.slice(0, 120).map((row, index) => {
          const options = teachersBySubject.get(row.subjectName.toLowerCase()) || state.teachers;
          return (
            <React.Fragment key={row.id}>
              <span>{row.grade}{row.letter}</span>
              <span>{row.subjectName}</span>
              <select value={row.teacherId || ''} onChange={(e) => updateRows(rows, setRows, index, 'teacherId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Не назначен</option>
                {options.map((teacher) => <option value={teacher.id} key={teacher.id}>{teacher.fullName}</option>)}
              </select>
              <select value={row.roomId || ''} onChange={(e) => updateRows(rows, setRows, index, 'roomId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Любой</option>
                {state.rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}
              </select>
              <input type="number" min="1" max="10" value={row.weeklyHours} onChange={(e) => updateRows(rows, setRows, index, 'weeklyHours', Number(e.target.value))} />
            </React.Fragment>
          );
        })}
      </div>
      <button className="primary" onClick={save}><Check size={18} /> Сохранить связки</button>
    </section>
  );
}

function Constraints({ state, refresh, setNotice }) {
  const [rows, setRows] = useState(state.teacherConstraints.length ? state.teacherConstraints : []);
  useEffect(() => setRows(state.teacherConstraints), [state.teacherConstraints]);
  async function save() {
    await api('/teacher-constraints', {
      method: 'POST',
      body: { constraints: rows.map((row) => ({ ...row, periodNumber: row.periodNumber ? Number(row.periodNumber) : null })) }
    });
    await refresh();
    setNotice('Ограничения учителей сохранены');
  }
  return (
    <section className="grid-two">
      <div className="panel">
        <PanelTitle icon={ShieldCheck} title="Ограничения учителей" />
        <p className="hint">Пустой урок означает недоступен весь день. Генератор пропустит эти слоты.</p>
        {rows.map((row, index) => (
          <div className="row-edit constraint-row" key={index}>
            <select value={row.teacherId || ''} onChange={(e) => updateRows(rows, setRows, index, 'teacherId', Number(e.target.value))}>
              <option value="">Учитель</option>
              {state.teachers.map((teacher) => <option value={teacher.id} key={teacher.id}>{teacher.fullName}</option>)}
            </select>
            <select value={row.dayId || 'mon'} onChange={(e) => updateRows(rows, setRows, index, 'dayId', e.target.value)}>
              {state.settings.days.map((day) => <option value={day.id} key={day.id}>{day.name}</option>)}
            </select>
            <select value={row.shift || ''} onChange={(e) => updateRows(rows, setRows, index, 'shift', e.target.value)}>
              <option value="">Обе смены</option>
              {shiftOptions(state).map((shift) => <option value={shift.id} key={shift.id}>{shift.name}</option>)}
            </select>
            <input type="number" min="1" placeholder="Урок" value={row.periodNumber || ''} onChange={(e) => updateRows(rows, setRows, index, 'periodNumber', e.target.value)} />
          </div>
        ))}
        <div className="segmented">
          <button onClick={() => setRows([...rows, { teacherId: state.teachers[0]?.id || 0, dayId: 'mon', shift: '', periodNumber: null, kind: 'unavailable' }])}><Plus size={16} /> Добавить</button>
          <button className="primary" onClick={save}><Save size={18} /> Сохранить ограничения</button>
        </div>
      </div>
      <ListPanel title="Активные запреты" items={rows.map((item) => {
        const teacher = state.teachers.find((row) => row.id === item.teacherId);
        const day = state.settings.days.find((row) => row.id === item.dayId);
        return `${teacher?.fullName || 'Учитель'} · ${day?.name || item.dayId} · ${item.shift ? shiftName(state, item.shift) : 'обе смены'} · ${item.periodNumber || 'весь день'}`;
      })} />
    </section>
  );
}

function TimeSettings({ state, refresh, setNotice }) {
  const [days, setDays] = useState(state.settings.days);
  const [periods, setPeriods] = useState(state.settings.periods);
  const [shifts, setShifts] = useState(state.settings.shifts || SHIFTS.map((shift) => ({ ...shift, startsAt: shift.id === 'morning' ? '08:30' : '14:00' })));
  const [sanpin, setSanpin] = useState(state.settings.sanpin);
  async function save() {
    await api('/settings', { method: 'POST', body: { days, periods, shifts, sanpin } });
    await refresh();
    setNotice('Неделя и перемены настроены');
  }
  return (
    <section className="grid-two">
      <div className="panel">
        <PanelTitle icon={CalendarDays} title="Учебные дни" />
        <div className="toggle-list">
          {days.map((day, index) => (
            <label key={day.id}>
              <input type="checkbox" checked={day.enabled} onChange={(e) => updateRows(days, setDays, index, 'enabled', e.target.checked)} />
              {day.name}
            </label>
          ))}
        </div>
      </div>
      <div className="panel">
        <PanelTitle icon={MoonStar} title="Уроки и перемены" />
        <div className="shift-settings">
          {shifts.map((shift, index) => (
            <label key={shift.id}>
              <span>{shift.name}</span>
              <small>{shift.label}</small>
              <input type="time" value={shift.startsAt} onChange={(e) => updateRows(shifts, setShifts, index, 'startsAt', e.target.value)} />
            </label>
          ))}
        </div>
        {periods.map((period, index) => (
          <div className="row-edit compact" key={period.number}>
            <span>{period.number}</span>
            <span className="time-hint">{periodTime({ periods, shifts }, 'morning', period.number)} / {periodTime({ periods, shifts }, 'afternoon', period.number)}</span>
            <input type="number" value={period.duration} onChange={(e) => updateRows(periods, setPeriods, index, 'duration', Number(e.target.value))} />
            <input type="number" value={period.breakAfter} onChange={(e) => updateRows(periods, setPeriods, index, 'breakAfter', Number(e.target.value))} />
          </div>
        ))}
        <button className="primary" onClick={save}><Check size={18} /> Сохранить время</button>
      </div>
      <div className="panel full-span">
        <PanelTitle icon={ShieldCheck} title="СанПиН-нагрузка" />
        <div className="sanpin-grid">
          <b>Класс</b><b>Макс. уроков</b><b>Макс. сложность</b>
          {Array.from({ length: 11 }, (_, i) => i + 1).map((grade) => (
            <React.Fragment key={grade}>
              <span>{grade}</span>
              <input type="number" min="1" max="10" value={sanpin.maxLessonsByGrade[grade] || ''} onChange={(e) => setSanpin(updateNested(sanpin, 'maxLessonsByGrade', grade, Number(e.target.value)))} />
              <input type="number" min="1" max="60" value={sanpin.maxDailyDifficultyByGrade[grade] || ''} onChange={(e) => setSanpin(updateNested(sanpin, 'maxDailyDifficultyByGrade', grade, Number(e.target.value)))} />
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function SystemPanel({ state, refresh, setNotice, runtimeStatus }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [reports, setReports] = useState(null);
  const [advisorRows, setAdvisorRows] = useState([]);

  useEffect(() => {
    setAdvisorRows(state.classes.map((schoolClass) => {
      const advisor = state.classAdvisors?.find((item) => item.classId === schoolClass.id);
      return { classId: schoolClass.id, teacherId: advisor?.teacherId || '' };
    }));
  }, [state.classes, state.classAdvisors]);

  async function changePassword() {
    await api('/admin/password', { method: 'POST', body: { currentPassword, newPassword } });
    setCurrentPassword('');
    setNewPassword('');
    setNotice('Пароль изменен');
  }

  async function loadReports() {
    const data = await api('/reports');
    setReports(data);
    setNotice('Отчеты обновлены');
  }

  async function saveAdvisors() {
    await api('/class-advisors', {
      method: 'POST',
      body: { advisors: advisorRows.map((row) => ({ classId: row.classId, teacherId: row.teacherId ? Number(row.teacherId) : null })) }
    });
    await refresh();
    setNotice('Классные руководители сохранены');
  }

  async function restore(event) {
    const file = event.target.files[0];
    if (!file) return;
    const text = await file.text();
    await api('/restore', { method: 'POST', body: { backup: JSON.parse(text) } });
    await refresh();
    setNotice('Backup восстановлен');
  }

  return (
    <section className="grid-two">
      <div className="panel">
        <PanelTitle icon={Database} title="Безопасность и база" />
        <div className="manual-teacher">
          <h3>Пароль администратора</h3>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Текущий пароль" />
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Новый пароль" />
          <button className="primary" onClick={changePassword}><ShieldCheck size={18} /> Сменить пароль</button>
        </div>
        <div className="manual-teacher">
          <h3>Backup</h3>
          <a className="export-link" href={`${API}/backup.json`}><FileDown size={18} /> Скачать backup</a>
          <label className="file-button">
            <Upload size={17} /> Восстановить backup
            <input type="file" accept=".json" onChange={restore} />
          </label>
        </div>
        <div className="manual-teacher">
          <h3>О приложении</h3>
          <p className="hint"><b>{APP_NAME}</b></p>
          <p className="hint">Автор и разработчик: {APP_AUTHOR}</p>
        </div>
        <div className="manual-teacher">
          <h3>Excel-шаблоны</h3>
          <a className="export-link" href={`${API}/templates/schedule.xlsx`} download><FileSpreadsheet size={18} /> Шаблон расписания</a>
          <a className="export-link" href={`${API}/templates/teachers.xlsx`} download><Users size={18} /> Шаблон импорта учителей</a>
        </div>
        {runtimeStatus && (
          <div className="manual-teacher">
            <h3>Компоненты Windows</h3>
            <p className="hint">{runtimeStatus.message}</p>
            <div className="component-grid">
              {runtimeStatus.components?.map((component) => (
                <p key={component.id}>
                  <span>{component.ok ? 'Готово' : 'Проверка'}</span>
                  <b>{component.name}</b>
                  <small>{component.value}</small>
                </p>
              ))}
            </div>
          </div>
        )}
        <div className="manual-teacher">
          <h3>Классные руководители</h3>
          <div className="class-advisor-grid">
            {advisorRows.map((row, index) => {
              const schoolClass = state.classes.find((item) => item.id === row.classId);
              return (
                <React.Fragment key={row.classId}>
                  <span>{schoolClass ? `${schoolClass.grade}${schoolClass.letter}` : row.classId}</span>
                  <select value={row.teacherId} onChange={(e) => updateRows(advisorRows, setAdvisorRows, index, 'teacherId', e.target.value)}>
                    <option value="">Не назначен</option>
                    {groupTeachers(state.teachers).map((teacher) => {
                      const first = state.teachers.find((item) => item.fullName === teacher.fullName);
                      return <option value={first?.id || ''} key={teacher.fullName}>{teacher.fullName}</option>;
                    })}
                  </select>
                </React.Fragment>
              );
            })}
          </div>
          <button className="primary" onClick={saveAdvisors}><Save size={18} /> Сохранить руководителей</button>
        </div>
      </div>
      <div className="panel list-panel">
        <PanelTitle icon={BarChart3} title="Отчеты и журнал" />
        <div className="segmented">
          <button className="primary" onClick={loadReports}><BarChart3 size={18} /> Обновить отчеты</button>
          <a className="export-link" href={`${API}/reports.xlsx`}><FileSpreadsheet size={18} /> Скачать отчеты</a>
        </div>
        {reports && (
          <div className="report-box">
            <h3>Нагрузка учителей</h3>
            <ReportTable
              headers={['Учитель', 'Часы', 'Предметы', 'Классы']}
              rows={reports.teacherRows.map((row) => [row.teacher, row.hours, row.subjects.join(', '), row.classes.join(', ')])}
            />
            <h3>В каких классах ведет учитель</h3>
            <ReportTable
              headers={['Учитель', 'Класс', 'Предмет', 'Часы', 'Кабинет']}
              rows={reports.teacherRows.flatMap((row) => row.lessons.map((lesson) => [row.teacher, lesson.className, lesson.subject, lesson.hours, lesson.room]))}
            />
            <h3>Классы и предметы</h3>
            <ReportTable
              headers={['Класс', 'Часы', 'Предметов', 'Учителя']}
              rows={reports.classRows.map((row) => [row.className, row.hours, row.subjects, row.teachers.join(', ')])}
            />
            <h3>Классные руководители</h3>
            <ReportTable
              headers={['Класс', 'Классный руководитель']}
              rows={reports.advisorRows.map((row) => [row.className, row.teacher || 'Не назначен'])}
            />
            <h3>Кабинеты</h3>
            <ReportTable
              headers={['Кабинет', 'Тип', 'Назначений', 'Классы']}
              rows={reports.roomUse.map((row) => [row.room, row.type, row.assignments, row.classes.join(', ')])}
            />
            <h3>Проблемы</h3>
            <p>Без учителя: {reports.unassigned.length}</p>
            <p>Без кабинета: {reports.noRoom.length}</p>
            <p>Окна учителей: {reports.windows.length}</p>
            <p>Незапланированные уроки: {reports.unscheduled.length}</p>
          </div>
        )}
        <div className="report-box">
          <h3>Журнал</h3>
          {state.auditLog.slice(0, 10).map((item) => <p key={item.id}>{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.action} · {item.entity}</p>)}
        </div>
      </div>
    </section>
  );
}

function Generate({ state, selectedClasses, setSelectedClasses, weekMode, setWeekMode, schedule, setSchedule, setNotice, refresh }) {
  async function create() {
    const result = await api('/generate', { method: 'POST', body: { classIds: selectedClasses, weekMode } });
    setSchedule({ id: result.id, ...result.schedule });
    await refresh();
    setNotice('Расписание создано');
  }
  return (
    <section className="panel">
      <PanelTitle icon={Play} title="Выбор классов и генерация" />
      <div className="toolbar">
        <button onClick={() => setSelectedClasses(state.classes.map((item) => item.id))}>Все классы</button>
        <button onClick={() => setSelectedClasses([])}>Снять выбор</button>
        <select value={weekMode} onChange={(e) => setWeekMode(e.target.value)}>
          <option value="one">Одна неделя</option>
          <option value="two">Четная и нечетная</option>
        </select>
        <FileUpload label="Импорт готового расписания" endpoint="/import/schedule" refresh={refresh} setNotice={setNotice} onResult={(result) => setSchedule({ id: result.id, ...result.schedule })} />
      </div>
      <div className="class-picks">
        {state.classes.map((schoolClass) => (
          <label key={schoolClass.id} className={selectedClasses.includes(schoolClass.id) ? 'picked' : ''}>
            <input type="checkbox" checked={selectedClasses.includes(schoolClass.id)} onChange={(e) => {
              setSelectedClasses(e.target.checked ? [...selectedClasses, schoolClass.id] : selectedClasses.filter((id) => id !== schoolClass.id));
            }} />
            {schoolClass.grade}{schoolClass.letter} · {shiftName(state, schoolClass.shift)}
          </label>
        ))}
      </div>
      <button className="primary" onClick={create}><Sparkles size={18} /> Создать расписание</button>
      {schedule && <SchedulePreview schedule={schedule} setSchedule={setSchedule} state={state} setNotice={setNotice} />}
      {schedule?.id && (
        <div className="export-row">
          <a className="export-link" href={`${API}/export/schedules/${schedule.id}.xlsx`}><Download size={18} /> Экспорт в Excel</a>
          <a className="export-link primary-export" href={`${API}/export/schedules/${schedule.id}.grid.xlsx`}><FileSpreadsheet size={18} /> Скачать все расписание</a>
          <a className="export-link" href={`${API}/export/schedules/${schedule.id}.pdf`}><FileDown size={18} /> Экспорт в PDF</a>
          <a className="export-link" href={`${API}/print/schedules/${schedule.id}.html`} target="_blank" rel="noreferrer"><Printer size={18} /> Печатная форма</a>
        </div>
      )}
    </section>
  );
}

function SchedulePreview({ schedule, setSchedule, state, setNotice }) {
  const classNames = Object.keys(schedule.classes);
  const [className, setClassName] = useState(classNames[0] || '');
  const weekNames = className ? Object.keys(schedule.classes[className] || {}) : [];
  const [weekName, setWeekName] = useState(weekNames[0] || '');
  const [edit, setEdit] = useState(null);
  const [draggedCell, setDraggedCell] = useState(null);
  if (!className) return null;
  const safeWeek = schedule.classes[className]?.[weekName] ? weekName : weekNames[0];
  const grid = schedule.classes[className][safeWeek];
  const classShift = schedule.classMeta?.[className]?.shift || 'morning';
  async function saveCell() {
    const result = await api(`/schedules/${schedule.id}/cell`, {
      method: 'PATCH',
      body: {
        className,
        week: safeWeek,
        dayId: edit.dayId,
        periodNumber: edit.periodNumber,
        cell: edit.subject ? {
          subject: edit.subject,
          teacher: edit.teacher,
          teacherId: edit.teacherId || null,
          room: edit.room,
          roomId: edit.roomId || null,
          difficulty: Number(edit.difficulty) || 3
        } : null
      }
    });
    setSchedule({ id: schedule.id, ...result.schedule });
    setNotice(result.conflicts.length ? result.conflicts.join('; ') : 'Ячейка сохранена');
    setEdit(null);
  }
  async function swapCell(target) {
    if (!draggedCell) return;
    const result = await api(`/schedules/${schedule.id}/swap`, {
      method: 'POST',
      body: { className, week: safeWeek, from: draggedCell, to: target }
    });
    setSchedule({ id: schedule.id, ...result.schedule });
    setDraggedCell(null);
    setNotice('Уроки переставлены');
  }
  return (
    <div className="schedule-preview">
      <div className="preview-head">
        <h3>{className} · {shiftName({ settings: { shifts: schedule.shifts } }, classShift)} · {safeWeek === 'single' ? 'неделя' : weekLabel(safeWeek)}</h3>
        <div className="toolbar mini">
          <select value={className} onChange={(e) => {
            const nextClass = e.target.value;
            setClassName(nextClass);
            setWeekName(Object.keys(schedule.classes[nextClass] || {})[0] || '');
            setEdit(null);
          }}>
            {classNames.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={safeWeek} onChange={(e) => { setWeekName(e.target.value); setEdit(null); }}>
            {weekNames.map((item) => <option value={item} key={item}>{weekLabel(item)}</option>)}
          </select>
        </div>
      </div>
      <div className="schedule-grid" style={{ gridTemplateColumns: `120px repeat(${schedule.periods.length}, minmax(92px, 1fr))` }}>
        <b>День</b>
        {schedule.periods.map((period) => <b key={period.number}>{period.number}<small>{periodTime(schedule, classShift, period.number)}</small></b>)}
        {schedule.days.map((day) => (
          <React.Fragment key={day.id}>
            <b>{day.name}</b>
            {schedule.periods.map((period) => {
              const cell = grid[day.id]?.[period.number];
              return (
                <button className="cell-button" key={period.number} onClick={() => setEdit({
                  dayId: day.id,
                  dayName: day.name,
                  periodNumber: period.number,
                  subject: cell?.subject || '',
                  teacher: cell?.teacher || '',
                  teacherId: cell?.teacherId || '',
                  room: cell?.room || '',
                  roomId: cell?.roomId || '',
                  difficulty: cell?.difficulty || 3
                })}
                draggable
                onDragStart={() => setDraggedCell({ dayId: day.id, periodNumber: period.number })}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => swapCell({ dayId: day.id, periodNumber: period.number })}>
                  {cell ? <><strong>{cell.subject}</strong><small>{cell.teacher}</small><small>{cell.room}</small></> : '—'}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      {schedule.diagnostics?.length > 0 && (
        <div className="warning-list">
          {schedule.diagnostics.slice(0, 8).map((item, index) => <p key={index}>{item.className}: {item.message}</p>)}
        </div>
      )}
      {edit && (
        <div className="editor-panel">
          <h3>{edit.dayName}, урок {edit.periodNumber}</h3>
          <div className="editor-grid">
            <select value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })}>
              <option value="">Пусто</option>
              {state.subjects.map((subject) => <option key={subject.id}>{subject.name}</option>)}
            </select>
            <select value={edit.teacherId || ''} onChange={(e) => {
              const teacher = state.teachers.find((item) => item.id === Number(e.target.value));
              setEdit({ ...edit, teacherId: teacher?.id || '', teacher: teacher?.fullName || '' });
            }}>
              <option value="">Учитель</option>
              {state.teachers.map((teacher) => <option value={teacher.id} key={teacher.id}>{teacher.fullName}</option>)}
            </select>
            <select value={edit.roomId || ''} onChange={(e) => {
              const room = state.rooms.find((item) => item.id === Number(e.target.value));
              setEdit({ ...edit, roomId: room?.id || '', room: room?.name || '' });
            }}>
              <option value="">Кабинет</option>
              {state.rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}
            </select>
            <input type="number" min="1" max="5" value={edit.difficulty} onChange={(e) => setEdit({ ...edit, difficulty: Number(e.target.value) })} />
          </div>
          <div className="segmented">
            <button className="primary" onClick={saveCell}><Save size={18} /> Сохранить ячейку</button>
            <button onClick={() => setEdit(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileUpload({ label, endpoint, refresh, setNotice, onResult }) {
  async function upload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const dataUrl = await readFile(file);
    const result = await api(endpoint, { method: 'POST', body: { dataUrl } });
    await refresh();
    onResult?.(result);
    setNotice(`${label}: ${result.imported || 'файл принят'}`);
  }
  return (
    <label className="file-button">
      <Upload size={17} />
      {label}
      <input type="file" accept=".xlsx,.xls" onChange={upload} />
    </label>
  );
}

function ListPanel({ title, items }) {
  return (
    <div className="panel list-panel">
      <PanelTitle icon={FileSpreadsheet} title={title} />
      <div>{items.length ? items.map((item, index) => <p key={index}>{item}</p>) : <p className="hint">Пока пусто</p>}</div>
    </div>
  );
}

function ReportTable({ headers, rows }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell || '—'}</td>)}
            </tr>
          )) : (
            <tr>
              <td colSpan={headers.length}>Данных пока нет</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return <h2 className="panel-title"><Icon size={21} /> {title}</h2>;
}

function updateRows(rows, setter, index, key, value) {
  setter(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
}

function groupTeachers(teachers) {
  const map = new Map();
  for (const teacher of teachers) {
    const group = map.get(teacher.fullName) || { fullName: teacher.fullName, subjects: [] };
    if (!group.subjects.includes(teacher.subjectName)) group.subjects.push(teacher.subjectName);
    map.set(teacher.fullName, group);
  }
  return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
}

function parseSubjectText(value) {
  return [...new Set(String(value || '').split(/[,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function levelsForGrades(grades) {
  const levels = new Set();
  for (const grade of grades) {
    if (grade >= 1 && grade <= 4) levels.add('НОО');
    if (grade >= 5 && grade <= 9) levels.add('ООО');
    if (grade >= 10 && grade <= 11) levels.add('СОО');
  }
  return [...levels];
}

function difficultyLabel(value) {
  return ({
    1: 'легкая',
    2: 'ниже средней',
    3: 'средняя',
    4: 'высокая',
    5: 'сложная'
  })[Number(value)] || 'средняя';
}

function difficultyDescription(value) {
  return ({
    1: 'Разгрузочный предмет. Генератор может ставить позже в день.',
    2: 'Практический предмет с небольшой теорией. Подходит для середины или конца дня.',
    3: 'Обычная учебная нагрузка. Генератор распределяет равномерно.',
    4: 'Высокая нагрузка. Лучше ставить в первую половину смены.',
    5: 'Максимальная нагрузка. Генератор старается ставить на 1-4 уроки.'
  })[Number(value)] || 'Обычная учебная нагрузка.';
}

function updateNested(source, key, childKey, value) {
  return { ...source, [key]: { ...source[key], [childKey]: value } };
}

function weekLabel(week) {
  return ({ single: 'Одна неделя', odd: 'Нечетная', even: 'Четная' })[week] || week;
}

function shiftOptions(state) {
  return state.settings?.shifts || state.shifts || SHIFTS;
}

function shiftName(state, shiftId) {
  const shift = shiftOptions(state).find((item) => item.id === shiftId);
  return shift ? shift.name : shiftId;
}

function periodTime(source, shiftId, periodNumber) {
  const shifts = source.shifts || source.settings?.shifts || [];
  const periods = source.periods || source.settings?.periods || [];
  const shift = shifts.find((item) => item.id === shiftId) || shifts[0] || { startsAt: '08:30' };
  let minutes = timeToMinutes(shift.startsAt);
  for (const period of periods) {
    if (period.number === periodNumber) break;
    minutes += Number(period.duration || 0) + Number(period.breakAfter || 0);
  }
  return minutesToTime(minutes);
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '08:30').split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(total) {
  const normalized = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

createRoot(document.getElementById('root')).render(<App />);
