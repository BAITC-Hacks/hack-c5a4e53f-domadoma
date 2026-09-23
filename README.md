# Career Quest — DomaDoma

FastAPI + SQLite backend для Career Quest. Python 3.12; UI и recommendation engine
разрабатываются отдельно. Полный контракт и граница интеграции: [docs/backend.md](docs/backend.md).

**Текущее состояние:** хранение, импорт, demo auth и HTTP-маршруты реализованы.
После обновления из `main` доступны общие docs, `data/` и исходный
`backend/recommendation/engine.py`. Пока отсутствуют AI `service.py`,
`requirements-ai.txt` и `frontend/`. Без AI service health возвращает `degraded`, расчётные маршруты
отвечают 503. Это не полноценное AI-демо. Старый черновик в `work/` в сборку не входит.

## Итоговый запуск после интеграции

Требуются Docker Engine/Desktop, Compose и файлы всех трёх участников:
`frontend/package.json` + lockfile с `npm run build` → `dist`,
`backend/recommendation/{engine.py,service.py,requirements-ai.txt}`,
`data/{skills.json,events.json,employees.json,activity_history.csv}`.

1. Скопировать `.env.example` в `.env`.
2. Задать случайный `JWT_SECRET` минимум 32 байта и `DEMO_PASSWORD` минимум 8 символов.
   Например, секрет можно сгенерировать локально через `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
3. Владелец ключа отдельно задаёт `OPENAI_API_KEY` и `OPENAI_MODEL` для AI-демо.
4. Запустить `docker compose up --build`.

Адрес: http://localhost:8000. Swagger: http://localhost:8000/docs.
Один контейнер раздаёт API и SPA; SQLite сохраняется в named volume.
Dockerfile пока не проверен полной сборкой: нет файлов frontend/AI и доступного Docker daemon.

## Разработка backend отдельно

Из корня репозитория, Python 3.12:

```powershell
python -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
# Общий исходный набор из main:
$env:DATA_DIR = "data"
$env:JWT_SECRET = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$env:DEMO_PASSWORD = "choose-a-private-demo-password"
.\backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

На Windows PowerShell 5.1 вместо `GetBytes(48)` можно задать секрет,
сгенерированный приведённой выше Python-командой. Секрет не коммитить.
При наличии AI-модуля установить `-r backend/requirements.txt` дополнительно.
Uvicorn в этом режиме использует переменные окружения; `.env` автоматически
читает только Compose. Для frontend dev использовать Vite proxy `/api` → `http://localhost:8000`.

## Demo-аккаунты и API

Логины: `employee`, `hr`, `admin`. На первом запуске всем задаётся `DEMO_PASSWORD`,
сохраняется только Argon2-хеш. Employee связан с `E0002` (настраивается
`DEMO_EMPLOYEE_ID` при первоначальном создании аккаунта). Смена env после seed
не перезаписывает существующие пароли. JWT действует 30 минут по реальному времени.

`POST /api/auth/login` с `{"username":"admin","password":"<ваш пароль>"}`
возвращает токен. Дальше передавать `Authorization: Bearer <token>`.

| Endpoint | Доступ |
|---|---|
| `GET /api/health` | публичный |
| `GET /api/auth/me` | любой вошедший |
| `GET /api/employees` | HR/admin |
| `GET /api/employees/{id}` | employee self, HR/admin |
| `GET /api/employees/{id}/recommendations?lang=kk` | employee self, HR/admin |
| `POST /api/employees/{id}/activities/{event_id}/complete` | employee self/admin |
| `GET /api/hr/overview` | HR/admin |
| `POST /api/admin/upload` | admin |

Upload — один multipart-запрос с `employees_file` и `history_file`.
Пример нового профиля: [employees.json](backend/examples/employees.json),
пустая история с правильным заголовком: [history.csv](backend/examples/history.csv).
Можно отправить через Swagger после добавления Bearer-заголовка клиентом или curl:

```sh
curl http://localhost:8000/api/admin/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F employees_file=@backend/examples/employees.json \
  -F history_file=@backend/examples/history.csv
```

Лимит каждого файла 5 MiB; UTF-8 и BOM поддерживаются. Оба файла валидируются
до записи. Повтор history пропускается, конфликт record_id → 409 без частичного
импорта. Профиль с прежним ID обновляет версию. При demo-завершениях замена
отличающегося baseline пока запрещена 409 до согласования reconciliation с AI.

Complete: JSON `{"occurrence_key":null}`, заголовок `Idempotency-Key` с уникальным
ключом операции. Для `EV_036` occurrence_key — дата рекомендованной сессии.
Повтор не повышает навыки снова. Ответ содержит профиль; рекомендации запрашиваются
отдельно. При `stale_revision` повторить GET рекомендаций. Grade не повышается автоматически.

SQLite загружает исходный набор только один раз. Модельная дата берётся из набора:
`2026-10-01`; JWT и системные timestamps используют реальные часы. Не удаляйте
volume/SQLite для обычного рестарта. Без working AI-модуля Complete отклоняется до записи.

## Проверки и ограничения

```powershell
.\backend\.venv\Scripts\python.exe -m pytest tests/backend -q
```

Тесты используют синтетический исходный набор из `data/` или текущего `work/karim312k1/`.
HTTP-тесты используют **тестовый DomainDouble**, не OpenAI и не реальную математику
навыков. Ни ключ, ни платные запросы для них не нужны. Проверенные версии прямых
Python-зависимостей зафиксированы в requirements; AI-зависимости принадлежат напарнику.
Локальные проверки сейчас выполняются Python 3.13.5; Python 3.12 и полный Docker
остаются интеграционными проверками.

Реальные skill gain/readiness, HR-агрегаты, baseline/LLM fallback, RU/KK-объяснения
и задержка AI будут проверяться с engine/service. Отказ внешней модели должен
обрабатываться fallback внутри AI service; backend ограничивает запрос 8 секундами.
Это demo auth, без регистрации/refresh/SSO и без заявления о production-защите.

Источники: синтетический набор Career Quest v1.0 и его README.ru.md; пользовательский
контракт Backend/Integration v1. Исходный engine получен из main вместе с общими
документами. AI service и его интеграционные проверки ещё ожидаются.
