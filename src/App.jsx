import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import {
  BarChart3, BookOpen, CalendarDays, Check, ChevronRight, Database, Download, FileDown, FileSpreadsheet,
  DoorOpen, FolderOpen, KeyRound, MoonStar, Pencil, Play, Plus, Printer, Save, SaveAll, School,
  RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Upload, Users, X
} from 'lucide-react';
import './styles.css';

const API = '/api';
const APP_NAME = 'Аманат Расписание';
const APP_SUBTITLE = 'Разработка школьного расписания';
const APP_AUTHOR = 'Латипов Саид Ахмедович';
const DRAFT_KEY = 'amanat-scheduler-draft';
const AUTH_TOKEN_KEY = 'amanat-scheduler-token';
const LEVELS = ['НОО', 'ООО', 'СОО'];
const SHIFTS = [
  { id: 'morning', name: '1 смена', label: '' },
  { id: 'afternoon', name: '2 смена', label: '' }
];
const STEPS = [
  ['Классы', School],
  ['Предметы', BookOpen],
  ['Учителя', Users],
  ['Кабинеты', DoorOpen],
  ['Связки', Sparkles],
  ['Время', CalendarDays],
  ['Ограничения', ShieldCheck],
  ['Система', Database],
  ['Создание', Play]
];

function App() {
  const [logged, setLogged] = useState(() => Boolean(localStorage.getItem(AUTH_TOKEN_KEY)));
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
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const editorCommit = useRef(null);

  async function flushEditor() {
    const commit = editorCommit.current;
    if (typeof commit !== 'function') return;
    try {
      await commit();
    } catch {
      setNotice('Не удалось сохранить текущий раздел');
    }
  }
  const registerCommit = (fn) => { editorCommit.current = fn; };

  function goStep(next) {
    flushEditor();
    setStep(next);
  }

  async function refresh() {
    const data = await api('/bootstrap');
    setState(data);
    setSelectedClasses(data.classes.map((item) => item.id));
  }

  async function saveDraft() {
    await flushEditor();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      step,
      selectedClasses,
      weekMode,
      schedule
    }));
    setHasDraft(true);
    setNotice('Раздел и черновик сохранены');
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

  async function saveProject(asNew = false) {
    if (!window.projectFile) return;
    try {
      await flushEditor();
      const contents = await apiText('/backup.json');
      const result = asNew ? await window.projectFile.saveAs(contents) : await window.projectFile.save(contents);
      if (result?.canceled) return;
      if (!result?.ok) {
        setNotice('Не удалось сохранить файл');
        return;
      }
      setProjectName(result.name);
      setNotice(`Проект сохранен: ${result.name}`);
    } catch {
      setNotice('Не удалось сохранить проект');
    }
  }

  async function openProject() {
    if (!window.projectFile) return;
    try {
      const result = await window.projectFile.open();
      if (result?.canceled) return;
      if (!result?.ok || !result.contents) {
        setNotice('Не удалось открыть файл');
        return;
      }
      const backup = JSON.parse(result.contents);
      await api('/restore', { method: 'POST', body: { backup } });
      await refresh();
      setSchedule(null);
      setProjectName(result.name);
      setNotice(`Проект открыт: ${result.name}`);
    } catch {
      setNotice('Файл проекта поврежден или неверный');
    }
  }

  useEffect(() => {
    if (!logged) return;
    refresh().catch((error) => {
      if (error.status === 401) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setLogged(false);
        setState(null);
        setNotice('Сессия истекла. Войдите снова.');
        return;
      }
      setNotice('Сервер не отвечает');
    });
  }, [logged]);

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

  useEffect(() => {
    if (!window.projectFile) return;
    window.projectFile.current().then((info) => { if (info?.ok) setProjectName(info.name); }).catch(() => {});
  }, []);

  if (!logged) {
    return (
      <main className="login-shell">
        <Login setLogged={setLogged} setStep={setStep} setNotice={setNotice} setState={setState} />
      </main>
    );
  }
  if (!state) return <main className="loading">Открываю школьный гримуар...</main>;

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
            <button className={step === index ? 'active' : ''} key={label} onClick={() => goStep(index)}>
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
            <p className="eyebrow">{projectName ? `Файл: ${projectName}` : 'Мастер составления'}</p>
            <h1>{STEPS[step][0]}</h1>
          </div>
          <div className="topbar-actions">
            {notice && <output>{notice}</output>}
            {window.schoolUpdater && <UpdateControl status={updateStatus} setNotice={setNotice} />}
            <button onClick={() => setTemplatesOpen(true)}><FileSpreadsheet size={18} /> Шаблоны импорта</button>
            {window.projectFile && (
              <>
                <button onClick={() => saveProject(false)}><Save size={18} /> Сохранить</button>
                <button onClick={() => saveProject(true)}><SaveAll size={18} /> Сохранить как</button>
                <button onClick={openProject}><FolderOpen size={18} /> Открыть</button>
              </>
            )}
            <button onClick={() => setTrainingOpen(true)}><BookOpen size={18} /> Обучение</button>
            {hasDraft && <button onClick={loadDraft}><FileDown size={18} /> Загрузить черновик</button>}
            <button onClick={async () => {
              await api('/logout', { method: 'POST' }).catch(() => {});
              localStorage.removeItem(AUTH_TOKEN_KEY);
              setLogged(false);
              setStep(0);
              setSchedule(null);
              setState(null);
              setNotice('');
            }}><KeyRound size={18} /> Выход</button>
          </div>
        </header>

        <div className="workspace-scroll">
          {trainingOpen && (
            <ModalFrame label="Обучение настройке расписания" className="training-modal" onClose={() => setTrainingOpen(false)}>
              <TrainingPanel onClose={() => setTrainingOpen(false)} />
            </ModalFrame>
          )}

          {templatesOpen && (
            <ModalFrame label="Шаблоны импорта" className="training-modal" onClose={() => setTemplatesOpen(false)}>
              <TemplatesPanel onClose={() => setTemplatesOpen(false)} setNotice={setNotice} />
            </ModalFrame>
          )}

          {step === 0 && <Classes state={state} refresh={refresh} setNotice={setNotice} />}
          {step === 1 && <Subjects state={state} refresh={refresh} setNotice={setNotice} registerCommit={registerCommit} />}
          {step === 2 && <Teachers state={state} refresh={refresh} setNotice={setNotice} />}
          {step === 3 && <Rooms state={state} refresh={refresh} setNotice={setNotice} />}
          {step === 4 && <Assignments state={state} refresh={refresh} setNotice={setNotice} registerCommit={registerCommit} />}
          {step === 5 && <TimeSettings state={state} refresh={refresh} setNotice={setNotice} registerCommit={registerCommit} />}
          {step === 6 && <Constraints state={state} refresh={refresh} setNotice={setNotice} registerCommit={registerCommit} />}
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
        </div>

        <div className="bottom-actions">
          <button className="draft-button" onClick={saveDraft}><Save size={18} /> Сохранить черновик</button>
          {step < STEPS.length - 1 && (
            <button className="primary" onClick={() => goStep(step + 1)}>
              Далее <ChevronRight size={18} />
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function Login({ setLogged, setStep, setNotice, setState }) {
  const [password, setPassword] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      const result = await api('/login', { method: 'POST', body: { password } });
      localStorage.setItem(AUTH_TOKEN_KEY, result.token);
      setState(null);
      setLogged(true);
      setNotice(result.mustChangePassword ? 'Вход выполнен. Смените стандартный пароль admin.' : 'Администратор вошел');
      setStep(result.mustChangePassword ? 7 : 0);
    } catch {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setLogged(false);
      setNotice('Пароль неверный');
    }
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

function ModalFrame({ label, className = '', onClose, children }) {
  return createPortal((
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal-window ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Закрыть окно"><X size={20} /></button>
        {children}
      </section>
    </div>
  ), document.body);
}

function TrainingPanel({ onClose }) {
  const steps = [
    ['Классы', 'Добавьте классы вручную или импортом. Для каждого класса проверьте уровень, литеру и смену.'],
    ['Предметы', 'Выберите предмет слева, включите нужные параллели 1-11 и задайте часы в неделю отдельно для каждой параллели.'],
    ['Учителя', 'Импортируйте учителей, добавьте предметы вручную, затем назначьте классных руководителей, кабинеты и смены.'],
    ['Кабинеты', 'Добавьте кабинеты и типы. Кабинет можно закрепить за предметом или классным руководителем.'],
    ['Связки', 'Проверьте строки класс-предмет-учитель. Здесь задается кто ведет урок, кабинет и недельные часы.'],
    ['Время', 'Настройте учебные дни, старт 1 и 2 смены, длительность каждого урока, перемены и лимиты нагрузки.'],
    ['Ограничения', 'Заблокируйте школьные слоты, например понедельник 1 урок. Для учителей задайте окно работы по дням: с какого урока приходит и после какого уходит, либо выходной.'],
    ['Создание', 'Выберите классы и режим недели. После генерации проверьте диагностику, отчеты учителей и полный Excel-экспорт.']
  ];
  const checklist = [
    'У каждого класса выбрана смена.',
    'У предметов заполнены часы по нужным параллелям.',
    'Классные руководители назначены с кабинетами и сменами.',
    'Связки предметов имеют учителей и кабинеты.',
    'Время первой и второй смены не пересекается.',
    'Школьные блокировки и ограничения учителей сохранены.'
  ];
  const exports = [
    'Полное расписание всей школы в одной таблице.',
    'Листы по каждому классу.',
    'Отчет расписания одного учителя.',
    'Отчеты по руководителям, кабинетам и проблемам.'
  ];

  return (
    <div className="training-panel">
      <div className="training-head">
        <div>
          <p className="eyebrow">обучение</p>
          <h2>Как настроить расписание</h2>
        </div>
        <button onClick={onClose}><X size={18} /> Закрыть</button>
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
          <div className="training-note">
            <b>Что скачать после генерации</b>
            {exports.map((item) => <span key={item}>{item}</span>)}
          </div>
        </aside>
      </div>
    </div>
  );
}

function TemplatesPanel({ onClose, setNotice }) {
  const templates = [
    ['Классы', '/templates/classes.xlsx', School],
    ['Предметы', '/templates/subjects.xlsx', BookOpen],
    ['Учителя', '/templates/teachers.xlsx', Users],
    ['Кабинеты', '/templates/rooms.xlsx', DoorOpen],
    ['Классные руководители', '/templates/class-advisors.xlsx', Users],
    ['Расписание всей школы', '/templates/schedule.xlsx', FileSpreadsheet]
  ];
  async function grab(path) {
    await downloadFile(path);
    setNotice('Шаблон скачан');
  }
  return (
    <div className="training-panel">
      <div className="training-head">
        <div>
          <p className="eyebrow">импорт</p>
          <h2>Шаблоны импорта</h2>
        </div>
      </div>
      <p className="rules-lead">Скачайте нужный шаблон Excel, заполните его и загрузите кнопкой импорта на соответствующем шаге.</p>
      <div className="templates-grid">
        {templates.map(([label, path, Icon]) => (
          <button key={path} className="export-link" onClick={() => grab(path)}><Icon size={18} /> {label}</button>
        ))}
      </div>
    </div>
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
  const [gradeFilter, setGradeFilter] = useState('all');
  const presentGrades = useMemo(() => [...new Set(state.classes.map((item) => item.grade))].sort((a, b) => a - b), [state.classes]);
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
        <div className="segmented">
          <FileUpload label="Импорт классов" endpoint="/import/classes" refresh={refresh} setNotice={setNotice} />
        </div>
        <div className="segmented">{LEVELS.map((level) => <button key={level} onClick={() => addLevel(level)}><Plus size={16} /> {level}</button>)}</div>
        <div className="row-edit class-row header-row">
          <b>Уровень образования</b>
          <b>Параллель</b>
          <b>Литерал</b>
          <b>Смена</b>
        </div>
        {rows.map((row, index) => (
          <div className="row-edit class-row" key={index}>
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
        <div className="filter-bar">
          <label>Параллель</label>
          <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">Все параллели</option>
            {presentGrades.map((grade) => <option value={grade} key={grade}>{grade} параллель</option>)}
          </select>
          <span className="filter-count">{state.classes.filter((item) => gradeFilter === 'all' || item.grade === gradeFilter).length} классов</span>
        </div>
        <div>{state.classes.length ? state.classes.filter((item) => gradeFilter === 'all' || item.grade === gradeFilter).map((item) => (
          <p className="action-line" key={item.id}>
            <span>{item.grade}{item.letter} · {item.level} · {shiftName(state, item.shift)}</span>
            <button onClick={() => remove(item.id)} title="Удалить"><Trash2 size={16} /></button>
          </p>
        )) : <p className="hint">Пока пусто</p>}</div>
      </div>
    </section>
  );
}

function Subjects({ state, refresh, setNotice, registerCommit }) {
  const [name, setName] = useState('');
  const [newDifficulty, setNewDifficulty] = useState(3);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(state.subjects[0]?.id || null);
  const selected = state.subjects.find((item) => item.id === selectedId) || state.subjects[0];
  const [draft, setDraft] = useState(null);
  const filteredSubjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? state.subjects.filter((s) => s.name.toLowerCase().includes(q)) : state.subjects;
  }, [state.subjects, query]);

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
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setNotice('Введите название предмета');
      return;
    }
    try {
      if (selected && trimmedName !== selected.name) {
        await api('/subjects/rename', { method: 'POST', body: { id: selected.id, name: trimmedName } });
      }
      const parallelHours = Object.fromEntries(Object.entries(draft.parallelHours).filter(([, hours]) => Number(hours) > 0).map(([grade, hours]) => [grade, Number(hours)]));
      const grades = Object.keys(parallelHours).map(Number);
      await api('/subjects', { method: 'POST', body: { subjects: [{
        name: trimmedName,
        levels: levelsForGrades(grades),
        grades,
        difficulty: Number(draft.difficulty),
        weeklyHours: Math.max(1, ...Object.values(parallelHours).map(Number), 1),
        parallelHours,
        unlocked: !!draft.unlocked
      }] } });
      await refresh();
      setNotice('Настройки предмета сохранены');
    } catch (error) {
      setNotice(String(error?.message || '').includes('уже есть') ? 'Предмет с таким названием уже есть' : 'Не удалось сохранить предмет');
    }
  }
  async function selectSubject(id) {
    if (id === selectedId) return;
    if (subjectDirty(draft, selected)) await save();
    setSelectedId(id);
  }
  useEffect(() => {
    registerCommit?.(draft ? save : null);
    return () => registerCommit?.(null);
  }, [draft]);
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
        {rulesOpen && (
          <ModalFrame label="Правила оценки сложности уроков" className="rules-modal" onClose={() => setRulesOpen(false)}>
            <DifficultyRulesModal onClose={() => setRulesOpen(false)} />
          </ModalFrame>
        )}
        <div className="search-field">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск предмета..." />
          {query && <button onClick={() => setQuery('')} title="Очистить"><X size={15} /></button>}
        </div>
        <div className="subject-list">
          {filteredSubjects.map((subject) => (
            <button key={subject.id} className={selected?.id === subject.id ? 'active' : ''} onClick={() => selectSubject(subject.id)}>
              <span>{subject.name}</span>
              <small>
                <b className={`difficulty-pill difficulty-${subject.difficulty}`}>{subject.difficulty}/5 · {difficultyLabel(subject.difficulty)}</b>
                {subject.grades.length ? `${subject.grades.join(', ')} параллели` : 'не привязан'}
              </small>
            </button>
          ))}
          {!filteredSubjects.length && <p className="hint">Ничего не найдено</p>}
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
            {(draft.allowedGrades?.length > 0) && (
              <label className="unlock-toggle">
                <input type="checkbox" checked={!!draft.unlocked} onChange={(e) => setDraft({ ...draft, unlocked: e.target.checked })} />
                <span>
                  {draft.unlocked
                    ? 'Разблокировано: можно привязать любую параллель'
                    : `Разрешены параллели: ${draft.allowedGrades.join(', ')}. Остальные заблокированы — включите, чтобы разблокировать.`}
                </span>
              </label>
            )}
            <div className="parallel-grid">
              <b>Параллель</b><b>Часов в неделю</b><b>Привязка</b>
              {Array.from({ length: 11 }, (_, i) => i + 1).map((grade) => {
                const rawHours = draft.parallelHours?.[grade] ?? 0;
                const hours = Number(rawHours) || 0;
                const restricted = (draft.allowedGrades?.length > 0) && !draft.allowedGrades.includes(grade);
                const locked = restricted && !draft.unlocked;
                return (
                  <React.Fragment key={grade}>
                    <span>{grade}{restricted && <small className="grade-flag">{locked ? ' 🔒' : ' вне ФГОС'}</small>}</span>
                    <input type="number" min="0" max="12" step="0.5" value={locked ? 0 : rawHours} disabled={locked} onChange={(e) => setDraft({ ...draft, parallelHours: { ...draft.parallelHours, [grade]: e.target.value } })} />
                    <label>
                      <input type="checkbox" disabled={locked} checked={hours > 0} onChange={(e) => setDraft({ ...draft, parallelHours: { ...draft.parallelHours, [grade]: e.target.checked ? (hours || 1) : 0 } })} />
                      {locked ? 'заблокировано' : hours > 0 ? 'активна' : 'нет'}
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
    <div className="training-panel">
      <div className="training-head">
        <div>
          <p className="eyebrow">сложность уроков</p>
          <h2>Правила оценки сложности</h2>
        </div>
        <button onClick={onClose}><X size={18} /> Закрыть</button>
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
    </div>
  );
}

function Teachers({ state, refresh, setNotice }) {
  const teacherGroups = useMemo(() => groupTeachers(state.teachers), [state.teachers]);
  const [fullName, setFullName] = useState('');
  const [subjectText, setSubjectText] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState(teacherGroups[0]?.fullName || '');
  const [extraSubjectText, setExtraSubjectText] = useState('');
  const [advisorRows, setAdvisorRows] = useState([]);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (!selectedTeacher && teacherGroups[0]) setSelectedTeacher(teacherGroups[0].fullName);
  }, [teacherGroups, selectedTeacher]);

  useEffect(() => {
    setAdvisorRows((state.classAdvisors || []).map((advisor) => ({
      classId: advisor.classId,
      teacherId: advisor.teacherId || '',
      roomId: advisor.roomId || '',
      shift: advisor.shift || '',
      note: advisor.note || ''
    })));
  }, [state.classes, state.classAdvisors]);

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

  async function saveAdvisors() {
    await api('/class-advisors', {
      method: 'POST',
      body: { advisors: advisorRows.map((row) => ({
        classId: Number(row.classId),
        teacherId: row.teacherId ? Number(row.teacherId) : null,
        roomId: row.roomId ? Number(row.roomId) : null,
        shift: row.shift || '',
        note: row.note || ''
      })) }
    });
    await refresh();
    setNotice('Классные руководители сохранены');
  }

  function addAdvisorRow() {
    setAdvisorRows([...advisorRows, { classId: state.classes[0]?.id || '', teacherId: '', roomId: '', shift: '', note: '' }]);
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
            <span className="line-actions">
              <button onClick={() => setEditing(item.fullName)} title="Редактировать"><Pencil size={16} /></button>
              <button onClick={() => removeTeacher(item.fullName)} title="Удалить"><Trash2 size={16} /></button>
            </span>
          </p>
        )) : <p className="hint">Пока пусто</p>}</div>
        <div className="manual-teacher">
          <h3>Классные руководители</h3>
          <div className="segmented">
            <FileUpload label="Импорт руководителей" endpoint="/import/class-advisors" refresh={refresh} setNotice={setNotice} />
          </div>
          <div className="class-advisor-grid">
            {advisorRows.map((row, index) => {
              return (
                <React.Fragment key={`${row.classId}-${index}`}>
                  <select value={row.classId} onChange={(e) => updateRows(advisorRows, setAdvisorRows, index, 'classId', e.target.value)}>
                    {state.classes.map((schoolClass) => <option value={schoolClass.id} key={schoolClass.id}>{schoolClass.grade}{schoolClass.letter} · {shiftName(state, schoolClass.shift)}</option>)}
                  </select>
                  <select value={row.teacherId} onChange={(e) => updateRows(advisorRows, setAdvisorRows, index, 'teacherId', e.target.value)}>
                    <option value="">Не назначен</option>
                    {teacherGroups.map((teacher) => {
                      const first = state.teachers.find((item) => item.fullName === teacher.fullName);
                      return <option value={first?.id || ''} key={teacher.fullName}>{teacher.fullName}</option>;
                    })}
                  </select>
                  <select value={row.roomId || ''} onChange={(e) => updateRows(advisorRows, setAdvisorRows, index, 'roomId', e.target.value)}>
                    <option value="">Кабинет</option>
                    {state.rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}
                  </select>
                  <select value={row.shift || ''} onChange={(e) => updateRows(advisorRows, setAdvisorRows, index, 'shift', e.target.value)}>
                    <option value="">Смена класса</option>
                    {shiftOptions(state).map((shift) => <option value={shift.id} key={shift.id}>{shift.name}</option>)}
                  </select>
                  <input value={row.note || ''} onChange={(e) => updateRows(advisorRows, setAdvisorRows, index, 'note', e.target.value)} placeholder="Примечание" />
                  <button onClick={() => setAdvisorRows(advisorRows.filter((_, rowIndex) => rowIndex !== index))} title="Удалить"><Trash2 size={16} /></button>
                </React.Fragment>
              );
            })}
          </div>
          <button onClick={addAdvisorRow}><Plus size={18} /> Добавить строку</button>
          <button className="primary" onClick={saveAdvisors}><Save size={18} /> Сохранить руководителей</button>
        </div>
      </div>
      {editing && (
        <ModalFrame label="Редактирование учителя" className="rules-modal" onClose={() => setEditing(null)}>
          <TeacherEditModal fullName={editing} state={state} refresh={refresh} setNotice={setNotice} onClose={() => setEditing(null)} onRenamed={setEditing} />
        </ModalFrame>
      )}
    </section>
  );
}

function TeacherEditModal({ fullName, state, refresh, setNotice, onClose, onRenamed }) {
  const group = groupTeachers(state.teachers).find((item) => item.fullName === fullName);
  const [name, setName] = useState(fullName);
  const [extra, setExtra] = useState('');

  async function rename() {
    const nextName = name.trim();
    if (nextName.length < 3 || nextName === fullName) {
      setNotice('Введите новое ФИО');
      return;
    }
    try {
      await api('/teachers/rename', { method: 'POST', body: { oldName: fullName, newName: nextName } });
      await refresh();
      setNotice('ФИО обновлено');
      onRenamed(nextName);
    } catch (error) {
      setNotice(error.status === 409 ? 'Учитель с таким ФИО уже есть' : 'Не удалось переименовать');
    }
  }

  async function removeSubject(subjectName) {
    const row = state.teachers.find((item) => item.fullName === fullName && item.subjectName === subjectName);
    if (!row) return;
    await api(`/teachers/${row.id}`, { method: 'DELETE' });
    await refresh();
    setNotice('Предмет убран');
  }

  async function addSubjects() {
    const subjects = parseSubjectText(extra);
    if (!subjects.length) return;
    await api(`/teachers/${encodeURIComponent(fullName)}/subjects`, { method: 'POST', body: { subjects } });
    setExtra('');
    await refresh();
    setNotice('Предметы добавлены');
  }

  return (
    <div className="training-panel">
      <div className="training-head">
        <div>
          <p className="eyebrow">учитель</p>
          <h2>Редактирование учителя</h2>
        </div>
      </div>
      <div className="manual-teacher">
        <h3>ФИО</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ФИО учителя" />
        <button className="primary" onClick={rename}><Save size={18} /> Переименовать</button>
      </div>
      <div className="manual-teacher">
        <h3>Предметы</h3>
        {group ? (
          <div className="chip-list">
            {group.subjects.map((subject) => (
              <span className="chip" key={subject}>{subject}
                <button onClick={() => removeSubject(subject)} title="Убрать предмет"><X size={14} /></button>
              </span>
            ))}
          </div>
        ) : <p className="hint">Учитель без предметов</p>}
        <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Добавить предметы через запятую" />
        <button onClick={addSubjects}><Plus size={18} /> Добавить предметы</button>
      </div>
    </div>
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
        <div className="row-edit room-row header-row">
          <b>Номер кабинета</b>
          <b>Назначение</b>
          <b>Количество мест</b>
        </div>
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
        <div className="row-edit room-row header-row">
          <b>Номер кабинета</b>
          <b>Назначение</b>
          <b>Количество мест</b>
        </div>
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

function Assignments({ state, refresh, setNotice, registerCommit }) {
  const [rows, setRows] = useState(state.assignments);
  const [classFilter, setClassFilter] = useState(state.classes[0]?.id ?? 'all');
  useEffect(() => setRows(state.assignments), [state.assignments]);
  useEffect(() => {
    if (classFilter !== 'all' && !state.classes.some((item) => item.id === classFilter)) {
      setClassFilter(state.classes[0]?.id ?? 'all');
    }
  }, [state.classes]);
  const teachersBySubject = useMemo(() => {
    const map = new Map();
    for (const teacher of state.teachers) {
      const key = teacher.subjectName.toLowerCase();
      map.set(key, uniqueTeachersByName([...(map.get(key) || []), teacher]));
    }
    return map;
  }, [state.teachers]);
  async function save() {
    const payload = rows.map((row) => ({
      classId: Number(row.classId),
      subjectId: Number(row.subjectId),
      teacherId: row.teacherId ? Number(row.teacherId) : null,
      roomId: row.roomId ? Number(row.roomId) : null,
      weeklyHours: Math.min(10, Math.max(0.5, Number(row.weeklyHours) || 0.5)),
      paired: row.paired ? 1 : 0
    }));
    try {
      await api('/assignments', { method: 'POST', body: { assignments: payload } });
      await refresh();
      setNotice('Связки учитель-класс-предмет сохранены');
    } catch (error) {
      setNotice(`Не удалось сохранить связки: ${error.message || 'ошибка'}`);
      throw error;
    }
  }
  useEffect(() => {
    registerCommit?.(rows.length ? save : null);
    return () => registerCommit?.(null);
  }, [rows]);
  return (
    <section className="panel">
      <PanelTitle icon={Sparkles} title="Кто ведет какой урок" />
      <p className="hint">Столбец «Подряд»: если в один день выпадает 2+ урока предмета (например, 2 технологии), генератор поставит их спаренно, друг за другом.</p>
      <div className="filter-bar">
        <label>Класс</label>
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">Все классы</option>
          {state.classes.map((item) => <option value={item.id} key={item.id}>{item.grade}{item.letter} · {shiftName(state, item.shift)}</option>)}
        </select>
        <span className="filter-count">{rows.filter((row) => classFilter === 'all' || row.classId === classFilter).length} строк</span>
      </div>
      <div className="assignment-table">
        <b>Класс</b><b>Предмет</b><b>Учитель</b><b>Кабинет</b><b>Часы</b><b>Подряд</b>
        {rows.map((row, index) => {
          if (classFilter !== 'all' && row.classId !== classFilter) return null;
          const options = teachersBySubject.get(row.subjectName.toLowerCase()) || uniqueTeachersByName(state.teachers);
          return (
            <React.Fragment key={row.id}>
              <span>{row.grade}{row.letter}</span>
              <span>{row.subjectName}</span>
              <TeacherPicker value={row.teacherId || null} teachers={options} onChange={(id) => updateRows(rows, setRows, index, 'teacherId', id)} placeholder="Не назначен" />
              <select value={row.roomId || ''} onChange={(e) => updateRows(rows, setRows, index, 'roomId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Любой</option>
                {state.rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}
              </select>
              <input type="number" min="0.5" max="10" step="0.5" value={row.weeklyHours} onChange={(e) => updateRows(rows, setRows, index, 'weeklyHours', e.target.value)} />
              <span className="paired-cell">
                <input type="checkbox" checked={!!row.paired} onChange={(e) => updateRows(rows, setRows, index, 'paired', e.target.checked)} title="Ставить уроки этого предмета подряд в один день" />
              </span>
            </React.Fragment>
          );
        })}
      </div>
      <button className="primary" onClick={save}><Check size={18} /> Сохранить связки</button>
    </section>
  );
}

function Constraints({ state, refresh, setNotice, registerCommit }) {
  const [blocks, setBlocks] = useState(state.scheduleBlocks || []);
  const [availability, setAvailability] = useState(state.teacherAvailability || []);
  const uniqueTeachers = useMemo(() => uniqueTeachersByName(state.teachers), [state.teachers]);
  const [availTeacherId, setAvailTeacherId] = useState(uniqueTeachers[0]?.id || '');
  const days = useMemo(() => state.settings.days.filter((day) => day.enabled), [state.settings.days]);
  const maxLessons = useMemo(() => {
    const tt = state.settings.timetables || {};
    let m = 0;
    for (const lv of Object.keys(tt)) for (const sh of Object.keys(tt[lv] || {})) m = Math.max(m, (tt[lv][sh]?.periods || []).length);
    return m || (state.settings.periods?.length || 7);
  }, [state.settings]);
  const lessonNumbers = useMemo(() => Array.from({ length: maxLessons }, (_, i) => i + 1), [maxLessons]);
  const periods = useMemo(() => lessonNumbers.map((n) => ({ number: n })), [lessonNumbers]);

  useEffect(() => setBlocks(state.scheduleBlocks || []), [state.scheduleBlocks]);
  useEffect(() => setAvailability(state.teacherAvailability || []), [state.teacherAvailability]);
  useEffect(() => {
    if ((!availTeacherId || !uniqueTeachers.some((t) => t.id === availTeacherId)) && uniqueTeachers[0]) setAvailTeacherId(uniqueTeachers[0].id);
  }, [uniqueTeachers]);

  async function save() {
    await Promise.all([
      api('/schedule-blocks', {
        method: 'POST',
        body: { blocks: blocks.map((row) => ({ ...row, classId: row.classId ? Number(row.classId) : null, periodNumber: Number(row.periodNumber) || 1 })) }
      }),
      api('/teacher-availability', {
        method: 'POST',
        body: { availability: availability.map((row) => ({ teacherId: Number(row.teacherId), dayId: row.dayId, dayOff: !!row.dayOff, fromPeriod: row.fromPeriod ?? null, toPeriod: row.toPeriod ?? null, windows: row.windows || [] })) }
      })
    ]);
    await refresh();
    setNotice('Ограничения сохранены');
  }
  useEffect(() => {
    registerCommit?.(save);
    return () => registerCommit?.(null);
  }, [blocks, availability]);

  function windowFor(dayId) {
    return availability.find((item) => item.teacherId === availTeacherId && item.dayId === dayId) || { dayOff: false, fromPeriod: null, toPeriod: null, windows: [] };
  }
  function setWindow(dayId, patch) {
    setAvailability((prev) => {
      const others = prev.filter((item) => !(item.teacherId === availTeacherId && item.dayId === dayId));
      const current = prev.find((item) => item.teacherId === availTeacherId && item.dayId === dayId) || { teacherId: availTeacherId, dayId, dayOff: false, fromPeriod: null, toPeriod: null, windows: [] };
      const next = { ...current, ...patch };
      const empty = !next.dayOff && next.fromPeriod == null && next.toPeriod == null && !(next.windows || []).length;
      return empty ? others : [...others, next];
    });
  }
  function toggleWindow(dayId, lesson) {
    const current = windowFor(dayId);
    const set = new Set(current.windows || []);
    if (set.has(lesson)) set.delete(lesson); else set.add(lesson);
    setWindow(dayId, { windows: [...set].sort((a, b) => a - b) });
  }
  const timeOf = (n) => periodTime(state.settings, null, 'morning', n);

  function addTalksBlock() {
    setBlocks([...blocks, { dayId: 'mon', shift: '', classId: null, periodNumber: 1, reason: 'Разговоры о важном' }]);
  }
  function blockLabel(item) {
    const schoolClass = state.classes.find((row) => row.id === Number(item.classId));
    return schoolClass ? `${schoolClass.grade}${schoolClass.letter}` : 'все классы';
  }
  function windowText(item) {
    if (item.dayOff) return 'выходной';
    const parts = [];
    if (item.fromPeriod != null) parts.push(`с ${item.fromPeriod} урока`);
    if (item.toPeriod != null) parts.push(`до ${item.toPeriod} урока включительно`);
    if (item.windows?.length) parts.push(`окна: ${item.windows.join(', ')} урок`);
    return parts.length ? parts.join(', ') : 'весь день';
  }

  return (
    <section className="constraints-layout">
      <div className="panel wide-panel">
        <PanelTitle icon={ShieldCheck} title="Блокировка уроков школы" />
        <p className="hint">Блокируйте слот для всей школы или только для выбранного класса. Пример: понедельник, 1 урок, Разговоры о важном.</p>
        <div className="segmented">
          <button onClick={addTalksBlock}><Plus size={16} /> Разговоры о важном</button>
          <button onClick={() => setBlocks([...blocks, { dayId: 'mon', shift: '', classId: null, periodNumber: 1, reason: '' }])}><Plus size={16} /> Добавить блокировку</button>
        </div>
        <div className="row-edit block-row header-row">
          <b>День</b><b>Смена</b><b>Класс</b><b>Урок</b><b>Причина</b><b></b>
        </div>
        {blocks.map((row, index) => (
          <div className="row-edit block-row" key={index}>
            <select value={row.dayId || 'mon'} onChange={(e) => updateRows(blocks, setBlocks, index, 'dayId', e.target.value)}>
              {state.settings.days.map((day) => <option value={day.id} key={day.id}>{day.name}</option>)}
            </select>
            <select value={row.shift || ''} onChange={(e) => updateRows(blocks, setBlocks, index, 'shift', e.target.value)}>
              <option value="">Обе смены</option>
              {shiftOptions(state).map((shift) => <option value={shift.id} key={shift.id}>{shift.name}</option>)}
            </select>
            <select value={row.classId || ''} onChange={(e) => updateRows(blocks, setBlocks, index, 'classId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Все классы</option>
              {state.classes.map((item) => <option value={item.id} key={item.id}>{item.grade}{item.letter}</option>)}
            </select>
            <input type="number" min="1" placeholder="Урок" value={row.periodNumber || 1} onChange={(e) => updateRows(blocks, setBlocks, index, 'periodNumber', Number(e.target.value))} />
            <input value={row.reason || ''} onChange={(e) => updateRows(blocks, setBlocks, index, 'reason', e.target.value)} placeholder="Причина" />
            <button onClick={() => setBlocks(blocks.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>

      <div className="panel wide-panel">
        <PanelTitle icon={CalendarDays} title="Доступность учителей" />
        <p className="hint">Выберите учителя и задайте на каждый день окно работы: с какого урока приходит и после какого уходит (необязательно). «Выходной» — весь день свободен. «Окна» — отметьте уроки, на которые генератор НЕ поставит урок (например, пришёл на 1, ушёл на 8, но 3 урок — окно).</p>
        {uniqueTeachers.length ? (
          <>
            <div className="filter-bar">
              <label>Учитель</label>
              <TeacherPicker value={availTeacherId} teachers={uniqueTeachers} allowEmpty={false} onChange={(id) => { if (id) setAvailTeacherId(id); }} />
            </div>
            <div className="availability-grid">
              <b>День</b><b>Режим</b><b>Приходит</b><b>Уходит</b><b>Окна (нет урока)</b>
              {days.map((day) => {
                const w = windowFor(day.id);
                const off = !!w.dayOff;
                const wins = w.windows || [];
                return (
                  <React.Fragment key={day.id}>
                    <span className="day-name">{day.name}</span>
                    <label className="off-toggle">
                      <input type="checkbox" checked={off} onChange={(e) => setWindow(day.id, e.target.checked ? { dayOff: true, fromPeriod: null, toPeriod: null, windows: [] } : { dayOff: false })} />
                      выходной
                    </label>
                    <div className={`availability-cell ${off ? 'disabled' : ''}`}>
                      <select value={w.fromPeriod ?? ''} disabled={off} onChange={(e) => setWindow(day.id, { fromPeriod: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">приходит: любой урок</option>
                        {periods.map((p) => <option value={p.number} key={p.number}>с {p.number} урока · {timeOf(p.number)}</option>)}
                      </select>
                      <small>раньше этого урока не поставим</small>
                    </div>
                    <div className={`availability-cell ${off ? 'disabled' : ''}`}>
                      <select value={w.toPeriod ?? ''} disabled={off} onChange={(e) => setWindow(day.id, { toPeriod: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">уходит: любой урок</option>
                        {periods.map((p) => <option value={p.number} key={p.number}>после {p.number} урока · {timeOf(p.number)}</option>)}
                      </select>
                      <small>позже этого урока не поставим</small>
                    </div>
                    <div className={`window-chips ${off ? 'disabled' : ''}`}>
                      {lessonNumbers.map((n) => (
                        <button
                          type="button"
                          key={n}
                          className={wins.includes(n) ? 'win-chip active' : 'win-chip'}
                          disabled={off}
                          title={wins.includes(n) ? `Убрать окно на ${n} уроке` : `Окно на ${n} уроке`}
                          onClick={() => toggleWindow(day.id, n)}
                        >{n}</button>
                      ))}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="segmented">
              <button className="primary" onClick={save}><Save size={18} /> Сохранить ограничения</button>
            </div>
          </>
        ) : <p className="hint">Сначала добавьте учителей на шаге «Учителя».</p>}
      </div>

      <div className="panel list-panel constraints-active">
        <PanelTitle icon={ShieldCheck} title="Активные запреты" />
        <div>
          {blocks.map((item, index) => {
            const day = state.settings.days.find((row) => row.id === item.dayId);
            return (
              <p className="action-line" key={`block-${index}`}>
                <span>Школа · {blockLabel(item)} · {day?.name || item.dayId} · {item.shift ? shiftName(state, item.shift) : 'обе смены'} · {item.periodNumber} урок · {item.reason || 'блокировка'}</span>
                <button onClick={() => setBlocks(blocks.filter((_, rowIndex) => rowIndex !== index))} title="Удалить блокировку"><Trash2 size={16} /></button>
              </p>
            );
          })}
          {availability.map((item, index) => {
            const teacher = state.teachers.find((row) => row.id === Number(item.teacherId));
            const day = state.settings.days.find((row) => row.id === item.dayId);
            return (
              <p className="action-line" key={`avail-${index}`}>
                <span>{teacher?.fullName || 'Учитель'} · {day?.name || item.dayId} · {windowText(item)}</span>
                <button onClick={() => setAvailability(availability.filter((_, rowIndex) => rowIndex !== index))} title="Удалить окно"><Trash2 size={16} /></button>
              </p>
            );
          })}
          {!blocks.length && !availability.length && <p className="hint">Запретов нет</p>}
        </div>
      </div>
    </section>
  );
}

function TimeSettings({ state, refresh, setNotice, registerCommit }) {
  const [days, setDays] = useState(state.settings.days);
  const [timetables, setTimetables] = useState(() => normalizeTimetables(state.settings));
  const [sanpin, setSanpin] = useState(state.settings.sanpin);
  const [level, setLevel] = useState('НОО');
  const [shift, setShift] = useState('morning');
  const current = timetables[level]?.[shift] || { start: '08:00', periods: [] };

  async function save() {
    const representative = timetables['НОО']?.morning?.periods || [];
    const levelStarts = Object.fromEntries(LEVELS.map((lv) => [lv, { morning: timetables[lv]?.morning?.start, afternoon: timetables[lv]?.afternoon?.start }]));
    await api('/settings', { method: 'POST', body: { days, timetables, periods: representative, levelStarts, sanpin } });
    await refresh();
    setNotice('Расписание звонков сохранено');
  }

  useEffect(() => {
    registerCommit?.(save);
    return () => registerCommit?.(null);
  }, [days, timetables, sanpin]);

  function patchCurrent(nextPeriods, nextStart) {
    setTimetables({
      ...timetables,
      [level]: {
        ...timetables[level],
        [shift]: {
          start: nextStart != null ? nextStart : current.start,
          periods: nextPeriods != null ? nextPeriods : current.periods
        }
      }
    });
  }
  function updateRow(index, key, value) {
    patchCurrent(current.periods.map((p, i) => i === index ? { ...p, [key]: value } : p));
  }
  function addRow() {
    const nextNumber = Math.max(0, ...current.periods.map((p) => Number(p.number) || 0)) + 1;
    patchCurrent([...current.periods, { number: nextNumber, duration: 40, breakAfter: 10 }]);
  }
  function removeRow(index) {
    patchCurrent(current.periods.filter((_, i) => i !== index).map((p, i) => ({ ...p, number: i + 1 })));
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
      <div className="panel full-span">
        <PanelTitle icon={MoonStar} title="Расписание звонков — своё для каждого уровня и смены" />
        <p className="hint">Выберите уровень образования и смену — задайте старт и звонки (длительность урока и перемену после него) именно для этой связки. У НОО, ООО и СОО, у 1 и 2 смены могут быть полностью разные звонки.</p>
        <div className="tt-tabs">
          <div className="segmented">
            {LEVELS.map((lv) => <button key={lv} className={level === lv ? 'active' : ''} onClick={() => setLevel(lv)}>{lv}</button>)}
          </div>
          <div className="segmented">
            <button className={shift === 'morning' ? 'active' : ''} onClick={() => setShift('morning')}>1 смена</button>
            <button className={shift === 'afternoon' ? 'active' : ''} onClick={() => setShift('afternoon')}>2 смена</button>
          </div>
        </div>
        <label className="tt-start">
          <span>Начало ({level} · {shift === 'morning' ? '1 смена' : '2 смена'})</span>
          <input type="time" value={current.start || ''} onChange={(e) => patchCurrent(null, e.target.value)} />
        </label>
        <div className="tt-grid">
          <b>Урок</b><b>Длит., мин</b><b>Перемена, мин</b><b>Звонок</b><b></b>
          {current.periods.map((period, index) => (
            <React.Fragment key={index}>
              <input type="number" min="1" max="14" value={period.number} onChange={(e) => updateRow(index, 'number', Number(e.target.value))} />
              <input type="number" min="20" max="90" value={period.duration} onChange={(e) => updateRow(index, 'duration', Number(e.target.value))} />
              <input type="number" min="0" max="60" value={period.breakAfter} onChange={(e) => updateRow(index, 'breakAfter', Number(e.target.value))} />
              <span className="time-hint">{periodTime({ timetables }, level, shift, period.number)}</span>
              <button onClick={() => removeRow(index)} title="Удалить урок"><Trash2 size={16} /></button>
            </React.Fragment>
          ))}
        </div>
        <div className="segmented">
          <button onClick={addRow}><Plus size={16} /> Добавить урок</button>
          <button className="primary" onClick={save}><Check size={18} /> Сохранить звонки</button>
        </div>
      </div>
      <div className="panel full-span">
        <PanelTitle icon={ShieldCheck} title="СанПиН-нагрузка" />
        <div className="sanpin-grid">
          <b>Класс</b><b>Макс. уроков</b><b>Макс. сложность</b>
          {Array.from({ length: 11 }, (_, i) => i + 1).map((grade) => (
            <React.Fragment key={grade}>
              <span>{grade}</span>
              <input type="number" min="1" max="14" value={sanpin.maxLessonsByGrade[grade] || ''} onChange={(e) => setSanpin(updateNested(sanpin, 'maxLessonsByGrade', grade, Number(e.target.value)))} />
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

  async function restore(event) {
    const file = event.target.files[0];
    if (!file) return;
    const text = await file.text();
    await api('/restore', { method: 'POST', body: { backup: JSON.parse(text) } });
    await refresh();
    setNotice('Backup восстановлен');
  }

  async function downloadBackup() {
    await downloadFile('/backup.json');
    setNotice('Backup скачан');
  }

  async function downloadReports() {
    await downloadFile('/reports.xlsx');
    setNotice('Отчеты скачаны');
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
          <button className="export-link" onClick={downloadBackup}><FileDown size={18} /> Скачать backup</button>
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
      </div>
      <div className="panel list-panel">
        <PanelTitle icon={BarChart3} title="Отчеты и журнал" />
        <div className="segmented">
          <button className="primary" onClick={loadReports}><BarChart3 size={18} /> Обновить отчеты</button>
          <button className="export-link" onClick={downloadReports}><FileSpreadsheet size={18} /> Скачать отчеты</button>
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
            <h3>Классы по сменам</h3>
            <ReportTable
              headers={['Смена', 'Класс', 'Уровень образования', 'Параллель', 'Литерал']}
              rows={(reports.classesByShiftRows || []).map((row) => [row.shift, row.className, row.level, row.grade, row.letter])}
            />
            <h3>Классные руководители</h3>
            <ReportTable
              headers={['Класс', 'Уровень', 'Смена', 'Классный руководитель', 'Кабинет', 'Примечание']}
              rows={reports.advisorRows.map((row) => [row.className, row.level, row.shift, row.teacher || 'Не назначен', row.room, row.note])}
            />
            <h3>Расписание одного учителя</h3>
            <ReportTable
              headers={['Учитель', 'Класс', 'Смена', 'Неделя', 'День', 'Урок', 'Время', 'Предмет', 'Кабинет']}
              rows={(reports.teacherScheduleRows || []).map((row) => [row.teacher, row.className, row.shift, row.week, row.day, row.period, row.time, row.subject, row.room])}
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
  async function downloadSchedule(path) {
    await downloadFile(path);
    setNotice('Файл расписания скачан');
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
          <button className="export-link" onClick={() => downloadSchedule(`/export/schedules/${schedule.id}.xlsx`)}><Download size={18} /> Экспорт в Excel</button>
          <button className="export-link primary-export" onClick={() => downloadSchedule(`/export/schedules/${schedule.id}.grid.xlsx`)}><FileSpreadsheet size={18} /> Скачать все расписание</button>
          <button className="export-link" onClick={() => downloadSchedule(`/export/schedules/${schedule.id}.pdf`)}><FileDown size={18} /> Экспорт в PDF</button>
          <button className="export-link" onClick={() => openProtectedFile(`/print/schedules/${schedule.id}.html`)}><Printer size={18} /> Печатная форма</button>
          <button className="export-link" onClick={() => downloadSchedule(`/export/schedules/${schedule.id}.log.txt`)}><FileDown size={18} /> Журнал логов (ошибки)</button>
        </div>
      )}
      {schedule?.diagnostics?.length > 0 && (
        <p className="hint">⚠ Генератор не смог поставить {schedule.diagnostics.length} уроков — скачайте «Журнал логов» для деталей.</p>
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
  const classLevel = schedule.classMeta?.[className]?.level;
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
        {schedule.periods.map((period) => <b key={period.number}>{period.number}<small>{periodTime(schedule, classLevel, classShift, period.number)}</small></b>)}
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

// Searchable teacher input backed by a native datalist (type to filter, not clipped by scroll containers).
function TeacherPicker({ value, onChange, teachers, allowEmpty = true, placeholder = 'Поиск учителя...' }) {
  const listId = useId();
  const selected = teachers.find((t) => t.id === value);
  return (
    <>
      <input
        list={listId}
        key={value ?? 'none'}
        defaultValue={selected ? selected.fullName : ''}
        placeholder={placeholder}
        onChange={(e) => {
          const name = e.target.value.trim();
          if (!name) { if (allowEmpty) onChange(null); return; }
          const match = teachers.find((t) => t.fullName === name);
          if (match) onChange(match.id);
        }}
      />
      <datalist id={listId}>
        {teachers.map((t) => <option value={t.fullName} key={t.id} />)}
      </datalist>
    </>
  );
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

function uniqueTeachersByName(teachers) {
  const map = new Map();
  for (const teacher of teachers) {
    const key = teacher.fullName.trim().toLowerCase();
    if (!map.has(key)) map.set(key, teacher);
  }
  return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
}

function subjectDirty(draft, selected) {
  if (!draft || !selected) return false;
  if (draft.name.trim() !== selected.name) return true;
  if (Number(draft.difficulty) !== Number(selected.difficulty)) return true;
  if (Boolean(draft.unlocked) !== Boolean(selected.unlocked)) return true;
  const norm = (source) => JSON.stringify(
    Object.entries(source || {}).map(([grade, hours]) => [Number(grade), Number(hours)]).filter(([, hours]) => hours > 0).sort((a, b) => a[0] - b[0])
  );
  return norm(draft.parallelHours) !== norm(selected.parallelHours);
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

function normalizeTimetables(settings) {
  const src = settings.timetables || {};
  const levelStarts = settings.levelStarts || {};
  const defaultPeriods = (settings.periods && settings.periods.length ? settings.periods : [
    { number: 1, duration: 40, breakAfter: 10 }, { number: 2, duration: 40, breakAfter: 15 },
    { number: 3, duration: 40, breakAfter: 15 }, { number: 4, duration: 40, breakAfter: 10 },
    { number: 5, duration: 40, breakAfter: 10 }, { number: 6, duration: 40, breakAfter: 10 },
    { number: 7, duration: 40, breakAfter: 0 }
  ]);
  const cleanPeriods = (list) => list.map((p, i) => ({ number: Number(p.number) || i + 1, duration: Number(p.duration || 40), breakAfter: Number(p.breakAfter || 0) }));
  const defStart = (lv, sh) => levelStarts?.[lv]?.[sh] || (sh === 'afternoon' ? '13:10' : '08:30');
  const out = {};
  for (const lv of LEVELS) {
    out[lv] = {};
    for (const sh of ['morning', 'afternoon']) {
      const t = src?.[lv]?.[sh];
      out[lv][sh] = (t && Array.isArray(t.periods) && t.periods.length)
        ? { start: t.start || defStart(lv, sh), periods: cleanPeriods(t.periods) }
        : { start: defStart(lv, sh), periods: cleanPeriods(defaultPeriods) };
    }
  }
  return out;
}

function normalizePeriodsForEditor(periods = [], shifts = []) {
  return [...periods]
    .sort((a, b) => Number(a.number) - Number(b.number))
    .map((period) => ({
      number: Number(period.number) || 1,
      duration: Number(period.duration) || 40,
      breakAfter: Number(period.breakAfter) || 0,
      startsAt: {
        ...(period.startsAt || {}),
        ...Object.fromEntries((shifts || []).map((shift) => [
          shift.id,
          period.startsAt?.[shift.id] || calculatedPeriodStart(periods, shifts, shift.id, Number(period.number) || 1)
        ]))
      }
    }));
}

function normalizePeriodsForSave(periods = []) {
  return [...periods]
    .map((period) => ({
      number: Number(period.number) || 1,
      duration: Math.max(1, Number(period.duration) || 40),
      breakAfter: Math.max(0, Number(period.breakAfter) || 0),
      startsAt: period.startsAt || {}
    }))
    .sort((a, b) => a.number - b.number)
    .map((period, index) => ({ ...period, number: index + 1 }));
}

function calculatedPeriodStart(periods = [], shifts = [], shiftId, periodNumber) {
  const shift = shifts.find((item) => item.id === shiftId) || shifts[0] || { startsAt: '08:30' };
  let minutes = timeToMinutes(shift.startsAt);
  for (const period of [...periods].sort((a, b) => Number(a.number) - Number(b.number))) {
    if (Number(period.number) === Number(periodNumber)) break;
    minutes += Number(period.duration || 0) + Number(period.breakAfter || 0);
  }
  return minutesToTime(minutes);
}

function nextPeriodStart(periods = [], shifts = [], shiftId) {
  const sorted = [...periods].sort((a, b) => Number(a.number) - Number(b.number));
  const last = sorted[sorted.length - 1];
  if (!last) {
    const shift = shifts.find((item) => item.id === shiftId) || shifts[0] || { startsAt: shiftId === 'afternoon' ? '14:00' : '08:30' };
    return shift.startsAt;
  }
  const lastStart = last.startsAt?.[shiftId] || calculatedPeriodStart(sorted, shifts, shiftId, last.number);
  return minutesToTime(timeToMinutes(lastStart) + Number(last.duration || 40) + Number(last.breakAfter || 0));
}

function timetableFor(source, level, shiftId) {
  const timetables = source.timetables || source.settings?.timetables;
  const t = timetables?.[level]?.[shiftId];
  if (t && Array.isArray(t.periods) && t.periods.length) return t;
  const shifts = source.shifts || source.settings?.shifts || [];
  const levelStarts = source.levelStarts || source.settings?.levelStarts || {};
  const start = levelStarts?.[level]?.[shiftId]
    || shifts.find((item) => item.id === shiftId)?.startsAt
    || shifts[0]?.startsAt
    || (shiftId === 'afternoon' ? '14:00' : '08:30');
  return { start, periods: source.periods || source.settings?.periods || [] };
}

function periodTime(source, level, shiftId, periodNumber) {
  const tt = timetableFor(source, level, shiftId);
  let minutes = timeToMinutes(tt.start);
  for (const item of [...tt.periods].sort((a, b) => Number(a.number) - Number(b.number))) {
    if (Number(item.number) === Number(periodNumber)) return minutesToTime(minutes);
    minutes += Number(item.duration || 0) + Number(item.breakAfter || 0);
  }
  return '';
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
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const response = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const error = new Error(await response.text());
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function apiText(path) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const response = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    const error = new Error(await response.text());
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function downloadFile(path) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const response = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    const error = new Error(await response.text());
    error.status = response.status;
    throw error;
  }
  const blob = await response.blob();
  const name = fileNameFromDisposition(response.headers.get('content-disposition')) || 'download';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function openProtectedFile(path) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const response = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) throw new Error(await response.text());
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function fileNameFromDisposition(value) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value || '')?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return /filename="?([^"]+)"?/i.exec(value || '')?.[1] || '';
}

createRoot(document.getElementById('root')).render(<App />);
