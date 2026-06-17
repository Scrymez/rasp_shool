# ОЧУ "ЦО Интеллект"

Локальное веб-приложение для автоматического создания школьного расписания.

## Запуск

```bash
npm install
npm run dev
```

Открыть: `http://127.0.0.1:5173`

Пароль администратора: `admin`.

## Windows

Нужен Node.js 22+.

```powershell
npm install
npm run dev
```

Production-запуск после сборки:

```powershell
npm run build
npm start
```

Открыть: `http://127.0.0.1:4173`

## Desktop-приложение для Windows

Установленная desktop-версия не требует ручной установки Node.js, Chrome, SQLite или сервера.
Все нужные компоненты входят в installer:

- Electron desktop-оболочка;
- встроенный Node.js runtime;
- встроенный Chromium;
- локальный Express API;
- SQLite-база через встроенный Node runtime;
- React frontend;
- система обновлений.

При первом запуске приложение автоматически создает папки:

```text
%APPDATA%/ОЧУ ЦО Интеллект - Расписание/data
%APPDATA%/ОЧУ ЦО Интеллект - Расписание/exports
%APPDATA%/ОЧУ ЦО Интеллект - Расписание/logs
%APPDATA%/ОЧУ ЦО Интеллект - Расписание/updates
```

Статус встроенных компонентов виден во вкладке `Система` → `Компоненты Windows`.

Для проверки desktop-версии на компьютере разработчика:

```powershell
npm install
npm run desktop
```

Для сборки Windows-установщика:

```powershell
npm install
npm run dist:win
```

Готовый установщик появится в папке `release`:

```text
school-scheduler-setup-0.1.0.exe
```

После установки Windows создаст ярлык на рабочем столе:

```text
ОЧУ ЦО Интеллект - Расписание
```

При запуске ярлыка база SQLite и фронт запускаются вместе внутри одного desktop-окна.
База desktop-версии хранится в `%APPDATA%/ОЧУ ЦО Интеллект - Расписание/data/scheduler.db`.

Портативная сборка без установки:

```powershell
npm run dist:win:portable
```

## Обновления через GitHub

Репозиторий: `https://github.com/Scrymez/rasp_shool.git`.

В приложении есть кнопка `Обновления` справа сверху:

- `Проверить` — ручная проверка новой версии.
- `Скачать` — скачивание найденной версии.
- `Установить` — перезапуск и установка скачанного обновления.

Установленная версия также автоматически проверяет обновления через 5 секунд после запуска.
В режиме разработки `npm run desktop` проверка обновлений не скачивает релизы.

### Сборка релиза вручную

```powershell
npm version patch
git push
git push --tags
```

После push тега `v*` GitHub Actions соберет Windows installer и прикрепит файлы к GitHub Release.

Локальная публикация в GitHub Releases:

```powershell
$env:GH_TOKEN="github_token_with_repo_access"
npm run release:win
```

### Важное про приватный репозиторий

GitHub Actions может публиковать installer в приватный repo через `GITHUB_TOKEN`.
Но установленное приложение на ноуте не должно хранить GitHub token внутри `.exe`.

Для безопасных автообновлений есть 2 рабочих варианта:

- сделать отдельный публичный repo только для релизов;
- сделать небольшой update-server/proxy, который читает private GitHub Releases и отдает приложению `latest.yml` + installer.

Без этого приватные GitHub Releases могут быть недоступны приложению на ноуте без авторизации.

## Данные

- База SQLite: `data/scheduler.db`
- База desktop-версии Windows: `%APPDATA%/ОЧУ ЦО Интеллект - Расписание/data/scheduler.db`
- Документы Obsidian: `docs/`
- Экспорт расписания: кнопка `Экспорт в Excel` после генерации

## Импорт Excel

- Сотрудники: 1 столбец `ФИО`, 2 столбец `предмет`.
- Предметы: `Предмет`, `Уровни`, `Классы`, `Сложность`, `Часы`.
- Готовое расписание: `Класс`, `День`, `Урок`, `Предмет`, `Учитель`.
