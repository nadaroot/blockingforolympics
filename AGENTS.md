# LOKED — гайд для ИИ-агента (handover)

> Файл-замена для агента. `README.md` в этом проекте создавать ЗАПРЕЩЕНО (см. `neiro.txt`).
> Этот файл — единственная разрешённая «документация» рядом с кодом.

---

## 1. ЖЁСТКИЕ ПРАВИЛА (нарушение ломает проект)

1. **НЕ создавать `README.md`** (и `Readme.md`/`readme.md`). Требование владельца проекта, зафиксировано в `neiro.txt`.
2. **Не собирать Electron/дистрибутивы локально.** Сборка живёт в GitHub Actions на `windows-latest`; релиз создаётся пушем тега `v1.0.X`.
3. **Core-модули: ZERO внешних npm-зависимостей.** Только модули Node.js (`fs`, `path`, `os`, `child_process`, `crypto`) + нативный `fetch` (Node 18+).
4. **Строки UI, логов, комментариев и промптов — на русском.**
5. **Дизайн:** тёмный минималистичный стиль macOS / Claude / JetBrains. Никакого вырвиглазного оформления.
6. **Apple-брендинг запрещён** в интерфейсе: логотип Apple, «About This Mac», App Store, Sleep/Restart, Siri, Control Center в UI не используются. Стиль берём из референса `MacOS-Web-Simulator`, но без эпл-элементов.
7. **Не коммитить и не пушить без явной просьбы пользователя.**

---

## 2. Назначение

LOKED (Locked Olympiad Kiosk Environment) — защищённая олимпиадная среда для школ.
Клиент блокирует рабочий стол Windows, перехватывает системные сочетания клавиш, убивает запрещённые процессы и даёт ученику чистый рабочий стол. Панель учителя показывает экраны класса, управляет таймером, блокировкой, мышью/клавиатурой.

Репозиторий: `https://github.com/nadaroot/blockingforolympics.git` (ветка `main`).

---

## 3. Структура

```
client/                      # Клиент для участников
  native/Locker.cs|.exe      # Win32 хук клавиатуры (WH_KEYBOARD_LL)
  src/
    main.js                  # Главный процесс Electron: окна, IPC, запуск, стриминг экрана
    locker-manager.js        # Управление locker.exe через stdin/stdout
    watchdog.js              # Убийство запрещённых процессов
    network.js               # UDP Discovery (41234) + Socket.IO
    icon-cache.js            # Иконки из .exe + кэш + веб-фолбэк
    provisioner.js           # Установка/проверка олимпиадных программ
    pycharm-lockdown.js      # PyCharm без ИИ и плагинов + аудит
    ai-assistant.js          # Скрытый ИИ-помощник (freedepsek → Ollama qwen2.5-coder:1.5b)
    browser/                 # Страница безопасного браузера (резерв)
    shell/                     # Оболочка рабочего стола: index.html, shell.css, shell.js
                               # + assets/wallpaper.jpg — фото-обои (cover, через CSS .desktop-shell)
server/src/                  # Express + Socket.IO + приём стримов экранов
  public/                    # Админка учителя (веб)
admin-desktop/main.js        # Electron-оболочка админки
scripts/
  pack.js                    # Сборщик дистрибутивов (используется в CI)
  Launcher.cs                # C# лаунчер для standalone .exe
  preview.js                 # Браузерное превью оболочки (порт 4888)
  preview-shim.js            # Мок Electron IPC для превью
.github/workflows/release.yml # CI: сборка по тегу + релиз
```

---

## 4. Как запускать локально

```powershell
npm install                       # один раз (~270 МБ с Electron)

# 1) Браузерное превью оболочки (без киоска, без блокировок) — основной способ отладки
npm run start:preview             # http://127.0.0.1:4888

# 2) Реальный клиент в окне (хук клавиатур�� и watchdog ВЫКЛЮЧЕНЫ)
.\run-client-windowed.bat

# 3) Боевой киоск (перекрывает экран, блокирует Win/Alt+Tab, чистит браузеры/Telegram)
.\run-client.bat                  # выход только Ctrl+Alt+Shift+L → пароль admin

# 4) Панель учителя (порт 3000, UDP 41234)
.\run-admin-desktop.bat
```

### Тестовые режимы превью (query-параметры)

| URL | Что показывает |
|---|---|
| `/?desktop=1` | рабочий стол без окон |
| `/?win=editor\|files\|calc\|browser` | открыть окно |
| `/?win=<key>&restore=1` | открыть окно и свернуть его в обычный размер |
| `/?desktop=1&menu=1` | контекстное меню рабочего стола + подменю «Создать» |
| `/?desktop=1&mbmenu=file\|view\|win\|help\|brand` | открыть пункт верхнего меню |
| `/?ai=1` | сценарий ИИ-помощника: выделение в редакторе + Ctrl+Shift+P |
| `/?langmenu=1` | клик по индикатору языка: меню выбора раскладки |

Проверка JS-ошибок без GUI:
```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --window-size=1400,600 --dump-dom --virtual-time-budget=4500 "http://127.0.0.1:4888/?desktop=1" 2>$null | Select-String "JS ERROR"
```

### Язык ввода (индикатор `#mbLang`)
Индикатор в панели обновляется по `navigator.keyboard.getLayoutMap()`. **Клик по нему открывает меню выбора раскладки**
(`lang:list` / `lang:set` в главном процессе). Переключение реальное: PowerShell (`-EncodedCommand`) с
`AttachThreadInput` + `ActivateKeyboardLayout` (таблица тег → HKL в `client/src/main.js`, `LAYOUT_HKL`).
В превью мок: `lang:list` → Русский / English, `lang:set` → success.

### Таймер олимпиады
`#examTimerContainer` скрыт (`display:none` в разметке), пока не пришло `exam-update` со статусом `running`/`paused`.

---

## 5. Ключевые механизмы

### Внешний вид (значения взяты из референса https://github.com/LikhithSP/MacOS-Web-Simulator)
Touch Bar **удалён полностью**. Текущие значения:
- Меню-бар: 28px, прозрачный (`rgba(0,0,0,.08) → transparent`), hover пунктов `rgba(255,255,255,.10)` + blur(24px), radius 4px.
- Dropdown/контекстные меню: `min-width:240px`, radius 14px, фон `rgba(18,18,18,.75)`, blur 40px, hover `#007aff`, пункт 6×12px / 13.5px.
- Окна: radius 14px, тень `0 10px 40px -10px rgba(0,0,0,.40)` + кольцо `0 0 0 1px rgba(255,255,255,.10)`; заголовок 44px с градиентом; заголовок по центру абсолютом.
- Кнопки окон: 12×12, gap 8px, `#ff5f57/#febc2e/#28c840`, hover `#ff4136/#ff9500/#1aab29`, SVG-глифы 6×6 при hover группы, цвета глифов `#820005/#9a6400/#006500`.
- Док: стекло `blur(10px) saturate(1.5)`, radius 16px, иконки radius 14px с тенью `0 2px 8px rgba(0,0,0,.2)`.
- Обои: фото `client/src/shell/assets/wallpaper.jpg` (1600×900, cover + виньетка).

### Блокировка системных клавиш (`Locker.cs`, `client/native/locker.exe`)
Хук `WH_KEYBOARD_LL` активен в режиме блокировки (не в `--windowed`). Заблокировано:
- клавиши Win (левая/правая) и **любая** комбинация с зажатой Win (Win+D/E/R/L/X/I/P/S/Tab…);
- Alt+Tab, Alt+Esc, Alt+Space, Alt+F4, Alt+PrtSc;
- Ctrl+Esc (меню «Пуск»), Ctrl+Shift+Esc (Диспетчер задач);
- PrintScreen (одиночный и с Alt) — «Ножницы»/скриншоты.
Секретная разблокировка **Ctrl+Alt+Shift+L** не затрагивается.

### Защита от закрытия приложения (main.js)
В киоск-режиме (не `--windowed`):
- окно создаётся с `closable: false` — крестик/Alt+F4 не закрывают;
- обработчик `close` вызывает `preventDefault()` и шлёт в оболочку `request-exit-unlock` → открывается
  тот же экран пароля (Ctrl+Alt+Shift+L); закрытие разрешается только после успешной разблокировки (`allowWindowClose`);
- сторож жизни (интервал 2 c): возвращает окно на передний план (`show/focus/alwaysOnTop`), восстанавливает
  свёрнутое окно и перезапускает `locker.exe`, если его убили;
- «Мои файлы»: ПКМ по файлу (`#fileBoxMenu`, `showFileBoxMenu`) — Открыть / Переименовать… / Удалить
  (через те же модалки-подсказки оболочки), ПКМ на рабочем столе и по иконкам дока работает как прежде.

### Ctrl+Alt+Del
Само окно CAD удалить нельзя (уровень Winlogon), но из него убираются **все функции** — остаётся только «Отмена»:
- HKCU-политики при блокировке: `DisableTaskMgr`, `DisableLockWorkstation`, `DisableChangePassword`,
  `NoLogoff`, `HideFastUserSwitching`, `NoWinKeys`, `NoRun`, `NoClose`;
- кнопка «Специальные возможности» и hotkeys (5×Shift и т.п.) — через IFEO (`Debugger` → несуществующий
  `%windir%\system32\loked-disabled.exe` для `utilman/sethc/osk/narrator/magnify.exe`) и флаги `Accessibility\*`;
- при разблокировке всё возвращается обратно (и для IFEO удаляются только LOKED-заглушки).
Проверено: при `LOCK` политики стоят, при `EXIT/UNLOCK` — снимаются, панель задач возвращается.

### Секретная разблокировка
- Комбинация: `Ctrl + Alt + Shift + L` (+ русская раскладка `Д`).
- Пароль по умолчанию: `Extybr` (`currentConfig.masterPassword`).
- **Нигде не отображается в интерфейсе** — ни в меню, ни в подсказках. Только обработчик клавиш и `openSecretUnlock()`.

### Окна
- Открываются **плавающими** (как обычные окна macOS), НЕ на весь экран.
- Полный экран — только зелёная кнопка (`toggleMaximizeWindow`), класс `.maximized`.
- **Бар в полноэкранном режиме**: пока окно развёрнуто (`.desktop-shell.has-fullscreen-window`), меню-бар спрятан
  (`translateY(-100%)`) и выезжает при наведении курсора на верхнюю кромку (`clientY <= 4`, класс `reveal`).
- **Калькулятор не может быть полноэкранным**: в `toggleMaximizeWindow('calc')` стоит ранний `return`, в HTML у `#winCalc` есть класс `.no-fullscreen` (зелёная кнопка скрыта).
- Ссылки/Контест открываются **встроенным окном оболочки** (`webview` в `winBrowser`), а не отдельным kiosk-окном Electron. Главный процесс шлёт событие `open-url`.

### Док
- Только запущенные приложения (`openWindows` / `runningExternalApps`); пустой док скрыт (`.docker.empty`).
- Левый клик: не запущено — запустить; свёрнуто — показать; активно — **свернуть** (повторный клик сворачивает, `handleDockItemClick`).
- **Правый клик — меню «Показать / Скрыть / Закрыть»**, а не закрытие.

### Рабочий стол- Рамка выделения левой кнопкой (`.selection-box`), множественное выделение (`selectedIds`).
- **Сетка (`DESKTOP_GRID`, шаг 94×80, начало 14,14)**: иконки встают ТОЛЬКО в узлы сетки — «случайного» размещения нет.
  При переносе на освободившееся место вставляется заглушка `.desktop-item-placeholder` (остальные не съезжают),
  при drop позиция приводится к узлу, при занятости ищется ближайший свободный. Позиции в `localStorage: loked.desktop.layout.v1`.
- На рабочем столе только нужные программы (`BUILTIN_DESKTOP_APPS`): **Яндекс Контест** и **Мои файлы**.
  Редактор и калькулятор доступны из меню «Переход», но на рабочий стол не выведены. Ярлыки учителя: `pycharm`, `pascal`, `codeblocks`, `calc` (+ `contest`).
- ПКМ «Создать ▸» как в Windows; шаблон файла подбирается **по расширению, которое ввёл пользователь** (`FILE_TEMPLATES`): `.py .pyw .cpp .cc .cxx .c .h .hpp .pas .java .cs .js .json .html .css .md .txt`. Если расширение не введено — добавляется само.
- Рабочая папка `~/Desktop/LOKED_Workspace` создаётся **пустой** (образцовых файлов больше нет).

### Иконки
- Встроенные — векторные macOS-squircle (`BASE_ICONS`, `makeAppTile`).
- Реальные иконки программ: `ipcRenderer.invoke('icons:resolve')` → `icon-cache.js` (иконка из `.exe` через `System.Drawing.Icon.ExtractAssociatedIcon`, кэш `%LOCALAPPDATA%\LOKED\icons`, веб-фолбэк `favicon.im` → `icon.horse` → `favicone.com`).
- Файлы/папки: документ с бейджем расширения; для папок используется `BASE_ICONS.files` (отдельной «синей папки» больше нет).

### Provisioning окружения
`provisioner.js`, канал `ipcMain.handle('env:ensure', { autoInstall, hardenPyCharm, blockNetwork })`.

| id | Программа | Проверка | Установка |
|---|---|---|---|
| `python38` | Python 3.8 | `python --version` / `%LOCALAPPDATA%\Programs\Python\Python38` | winget `Python.Python.3.8` |
| `fpc` | Free Pascal 3.x | `fpc.exe` в `%FPCDIR%` / `C:\FPC\3.2.2` | winget, иначе URL fpc-3.2.2 |
| `codeblocks` | Code::Blocks 17.12+ | `C:\Program Files\CodeBlocks\codeblocks.exe` | winget `CodeBlocks.CodeBlocks` |
| `pascalabc` | PascalABC.NET 3.x | `PascalABCNET.exe` в Program Files | только URL pascalabc.net |
| `pycharm` | PyCharm Community | `pycharm-lockdown.findPyCharmInstall()` | winget `JetBrains.PyCharmCommunity` |

При старте клиента выполняется только **детект** (лог `[Env]` + `config.provisioning = {checkedAt, missing}` и событие `env-status` в рендерер). Установка запускается только по IPC.

### PyCharm без ИИ и плагинов (`pycharm-lockdown.js`)
Только официальные механизмы JetBrains, **бинарники не патчатся**:
- `%APPDATA%\JetBrains\PyCharm<ver>\disabled_plugins.txt` — id всех плагинов (это отключает и AI Assistant).
- Пользовательский vmoptions `-Djb.consents.endurance.enabled=false`, `-Djb.privacy.policy.text=##0.0.0.0`, `-Didea.trust.all.projects=true`.
- Опционально `blockNetwork` — блокировка `plugins.jetbrains.com`, `www.jetbrains.com`, `download.jetbrains.com`, `data.services.jetbrains.com` на `0.0.0.0` через `hosts` (только при правах администратора, идемпотентно, маркеры `# LOKED-START/END`).
- `auditPyCharm()` — проверка при каждом запуске: все ли плагины отключены, нет ли AI-плагинов.

### Скрытый ИИ-помощник (`ai-assistant.js` + индикатор `#mbAiIndicator`)
Скрыт полностью: меню, модалки и подсказок нет. Единственный вход — **Ctrl+Shift+P при выделенном тексте** (или выделении в редакторе).
Порядок работы: выделил текст → Ctrl+Shift+P → запрос сразу уходит ИИ → в верхней панели (перед часами) появляется кружок-индикатор:
жёлтый пульсирующий — запрос выполняется, зелёный — решение сохранено (гаснет через ~4 с), красный — ошибка (~6 с).
Ответ ИИ сохраняется в новый файл `ии-решение.<ext>` в `~/Desktop/LOKED_Workspace` (расширение угадывается по языку выделенного кода:
`.py/.cpp/.pas/.java/.cs/.js`, иначе `.txt`) и открывается в редакторе.
Бэкенды (`config.ai` в `server/src/config.js`, можно переопределить в `loked-config.json`):
1. **freedepsek** (приоритетный, OpenAI-совместимый POST): `freedepsekUrl` (по умолчанию `http://127.0.0.1:8317/v1/chat/completions`), `freedepsekModel`, `freedepsekApiKey`. Если ответил — идём в него.
2. **Локальная Ollama** (фолбэк, офлайн): `ollamaUrl` (`http://127.0.0.1:11434`), модель `qwen2.5-coder:1.5b`. Если сервер не запущен — поднимается `ollama serve`.
Ставятся при `env:ensure` с `autoInstall: true`: winget `Ollama.Ollama`, веса — в `E:\LOKED\Ollama\models` (`setx OLLAMA_MODELS`), затем `ollama pull qwen2.5-coder:1.5b`.
IPC: `ai:ask { prompt, code }` → `{ success, text, backend }`, `ai:status` → `{ freedepsek, ollama, activeBackend }`.
Системный промпт требует максимально простого и короткого кода.

---

## 6. Контракт CSS ↔ JS (не ломать)

| Событие JS | Что обязан сделать CSS |
|---|---|
| открытие окна | класс `window-in` на `.mac-window`, снять через ~240 мс |
| закрытие окна | класс `window-out`, затем `display:none` через ~160 мс |
| сворачивание | класс `minimized` |
| запуск программы | класс `bounce` на `.nav-item` (~750 мс) |
| перетаскивание иконки | класс `dragging` на `.desktop-item` |
| нажатие кнопки калькулятора | класс `active` на `.calc-btn` (120 мс) |
| открытое меню | `open` на `.mb-dropdown` + `.mb-item` |

ID и классы, которые ищет `shell.js` через `getElementById`/`querySelector`, перечислены в `neiro.txt` и в комментариях `shell.js`. Перед правкой HTML сверяйся со списком классов в `shell.css`.

---

## 7. Проверки перед коммитом

```powershell
git ls-files -co --exclude-standard "*.js" | ForEach-Object { node --check $_; if ($LASTEXITCODE) { "FAIL $_" } }
node scripts\pack.js --verify      # preflight сборки без Electron и без dist/
node scripts\preview.js            # превью, затем проверка "JS ERROR" через headless Edge
```

## 8. Сборка и релиз

```powershell
git add -A
git commit -m "..."
git push origin main
git tag v1.0.1
git push origin v1.0.1        # триггер CI: push tags v*
```

Артефакты релиза: `LOKED-Client-win-x64.zip`, `LOKED-Admin-win-x64.zip`, `LOKED-Client.exe`, `LOKED-Admin.exe`.
Workflow: `.github/workflows/release.yml` — `node --check` → компиляция `Locker.cs` через `csc.exe` → `npm run pack` → проверка содержимого архивов → `gh release` (идемпотентно).

---

---

## 9. Известные проблемы

1. ~~`scripts/Launcher.cs`~~ — **ИСПРАВЛЕНО:** добавлен трекинг тиков/таймстемпа файла сборщика в `.version` (`savedTicks != launcherTicks`), standalone `.exe` автоматически обновляет распакованную копию при обновлении бинарника или версии.
2. ~~`admin-desktop/main.js`~~ — **ИСПРАВЛЕНО:** добавлена безопасная проверка `fs.existsSync(iconPath)` перед передачей в `BrowserWindow`.
3. ~~`scripts/pack.js`~~ — **ИСПРАВЛЕНО:** переменные `clientAppFiles` и `adminAppFiles` переведены из `const` в `let` (устранена ошибка `Assignment to constant variable`).
4. `scripts/preview-shim.js` — мок-данные рабочей папки частично упрощены (нет полноценного состояния файлов); на работу Electron-клиента не влияет.
5. ZIP от `ZipFile.CreateFromDirectory` содержит записи с обратными слэшами — Windows распаковывает нормально, на Linux/macOS имена будут кривыми.
6. `window.LOKED_ICON_DOMAINS` объявляется в `shell.js`, а инъекция из `main.js` выполняется через `executeJavaScript` после загрузки страницы.

---

## 10. Что уже сделано (сводка последней сессии)

- Синхронизированы обновления с флешки (`G:\blockingforolympics` → `E:\проекты\loked`).
- Исправлены критические баги сборщика `scripts/pack.js` (`const` reassignment).
- Исправлен `scripts/Launcher.cs` (автоматическая распаковка при обновлении билда).
- Исправлен `admin-desktop/main.js` (безопасная проверка иконки).
- Браузерное превью оболочки на 4888 (`scripts/preview.js` + `preview-shim.js`, `npm run start:preview`).
- Окна плавающие, полный экран по зелёной кнопке; калькулятор — никогда.
- Прозрачные окна, читаемый фон обоев, широкий стеклянный док.
- Верхнее меню в стиле MacOS-Web-Simulator без Apple-элементов (Файл/Правка/Вид/Переход/Окно/Справка + меню знака LOKED).
- Анимации macOS: `window-in`, `window-out`, `minimized`, `dock-bounce`, `dragging`.
- Рамка выделения левой кнопкой + перетаскивание иконок с сохранением позиций.
- ПКМ «Создать ▸» с авто-шаблонами по расширению.
- Иконки macOS-squircle + реальные иконки из `.exe` с кэшем и веб-фолбэком.
- Provisioner + PyCharm-lockdown + аудит при запуске.
- Индикатор языка ввода в верхней панели.
- Секретная разблокировка убрана из интерфейса.
- CI переведён на сборку по тегу с проверками; `pack.js` с preflight-режимом.