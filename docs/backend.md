# Backend / Integration

Ветка `feat/backend-core`. AI подключён из `3f45c46`
(`feat/recommendation-engine`). Содержимое `backend/recommendation/**`,
`tests/ai/**` и `docs/ai.md` совпадает с коммитом напарника.
Frontend и замороженный `docs/contracts.md` не изменялись.

## Вызовы AI и состояние

SQLite — единственный источник состояния. Адаптер `backend/integration.py`
создаёт отдельный `engine.Data`: skills, profiles с ключами (role, grade),
employees, events, history, as_of. Каждый snapshot калибруется через
`engine.calibrate(data)`; prior не переносится между версиями состояния.

Профиль вызывает `service.analyze_employee(data, employee_id)`, backend
добавляет state_revision и типизированную собственную историю с title.
Рекомендации вызывают `await service.get_recommendations(data, employee_id,
language=language, state_revision=revision)`. Язык: query lang или
preferred_language. Поля service-ответа, в том числе duration_ms/source/
fallback_reason, сохраняются; ответ проверяется DTO и соответствием запросу.
После ожидания проверяется revision: устаревший результат отклоняется 409.

OPENAI_API_KEY/OPENAI_MODEL доступны только серверу. Без ключа service
возвращает source=fallback, fallback_reason=llm_unavailable при наличии
кандидатов. Backend не реализует отдельный LLM или scoring.
Крайний таймаут backend — 8 секунд; при превышении возвращается 504.
Успешный source=llm проверен только с тестовым селектором. Реального сетевого
LLM-вызова здесь не было по прямому указанию пользователя.

## Complete и отсутствие двойного прироста

В write transaction проверяются права, employee/event, Idempotency-Key и
логическая уникальность. Допустимость определяется существующим
`engine.recommend(..., k=len(data.events))`: только доступные добровольные
шаги развития, с проверенными prerequisites. Недоступный шаг → 409.
Новые backend/AI hooks не требуются.

Backend сохраняет completion-запись, затем revision++, commit. Только после
commit читается новый snapshot и строится профиль. LLM внутри Complete нет.
Baseline skills, last_review_date и grade в SQLite не изменяются.

В исходном движке история учитывается строго после last_review_date.
Для runtime-отметок в день оценки адаптер использует существующий
`engine.effective_skills(..., extra_completed=[event_id])`:

1. В отсоединённом Data движок применяет исходную историю.
2. Только в вычислительной копии employee устанавливается checkpoint
   last_review_date=as_of и полученные от движка skills.
3. Движок применяет runtime-отметки по одной в порядке их записи.
4. Отметки добавляются в Data.history для участия/исключения завершённых
   событий. Повторный расчёт service игнорирует уже учтённые даты checkpoint.

Это временное представление для расчёта, не обновление оценки в SQLite и не
новая формула gain. Модельные даты сохраняются настоящими; выдуманных будущих
дат завершения нет. Тесты проверяют same-day review, верхние границы навыков,
повтор Complete, повторный импорт и рестарт без повторного начисления.

Для EV_036 ключ occurrence — следующая доступная сессия. Копия каталога для
конкретного employee исключает его завершённые сессии; общие события и
рекомендации других сотрудников не меняются. HR использует engine.hr_view;
для сотрудников с использованными будущими сессиями клубов список
no_recommendation уточняется тем же engine.recommend по личному каталогу.

`replaces_record_id` заменяет in_progress/overdue участие, чтобы HR total
не увеличивался второй раз. `baseline_version` — происхождение отметки,
а не фильтр её действия. Идентичный импорт сохраняет прогресс и повышает
версию профиля. Изменение baseline с runtime-отметками или импорт истории,
перекрывающей такую отметку, отклоняется 409 до явного согласования
reconciliation: не угадываем, включены ли уже завершения в новую оценку.

## Проверки

Команды из корня в текущем окружении:

```powershell
.\work\karim312k1\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\work\karim312k1\backend\.venv\Scripts\python.exe -m pip check
.\work\karim312k1\backend\.venv\Scripts\python.exe -m pytest tests/backend tests/ai -q
```

Результат: **40 passed**, Python 3.13.5; pip check: No broken requirements.
SDK из requirements AI: openai 1.109.1. Предупреждение Starlette о будущем
отказе от httpx TestClient не мешает текущим тестам.

- 20 прежних backend-тестов: auth/роли, импорт/rollback, SQLite, повторы,
  stale revision, timeout, лимиты файлов, ошибки и изоляция SPA.
- 10 интеграционных тестов: настоящий engine/service, калибровка, профиль,
  fallback RU/KK, Complete/progress, same-day review, prerequisites, HR,
  сессии клуба, отсутствие снижения навыка, повторный импорт и рестарт.
- 10 тестов AI-ветки. Оригиналы не изменялись.
- Успешный LLM-путь тестируется подменой только внешнего селектора. Это
  проверка HTTP-контракта, не live LLM и не доказательство качества текстов.

Дополнительный offline HTTP smoke через FastAPI TestClient с временной
SQLite: profile/recommendations/complete/new recommendations → четыре 200.
E0002 + EV_005: System Design 1 → 2, readiness 62 → 66, revision 1 → 2.
В следующей рекомендации EV_005 отсутствует; source=fallback.

Независимое ревью backend-адаптера конкретных дефектов не обнаружило.

## Подтверждённые вопросы к AI-владельцу

Все три относятся к неизменённому service.py из 3f45c46:

- `not_chosen` берётся от пяти кандидатов, а не финального набора. Для E0028
  fallback выдаёт EV_038/EV_037/EV_010, не покрывающие минимальный SK_CLOUD,
  но not_chosen=null. Нужно пересчитать после финального выбора.
- Неизвестные fact_ids принимаются, если рядом передано достаточно валидных.
  Нужна проверка каждого ID на принадлежность реестру выбранного события.
- Свободный explanation попадает в reasons без фактологической проверки:
  тестовый текст «Readiness is now 100%.» передаётся буквально. Для проверяемых
  объяснений нужны шаблоны из серверных фактов либо согласованная валидация.

Эти проблемы воспроизведены офлайн при ревью. Самостоятельно service.py
не меняли согласно ограничению владельца. Проверка language=kk подтверждает
выбор языка в контракте, но не полноценную локализацию: baseline reasons
исходного engine остаются на русском.

## Оставшиеся внешние проверки

Frontend отсутствует в этой ветке: финальная Docker-сборка и браузерный сценарий
не проверены. Целевой Python 3.12 тоже ещё не проверен локально.
Live OpenAI не выполнялся: пользователь выбрал отсутствие платных операций.
Старые файлы в work/ и временная копия AI-ветки в runtime/ не входят в сборку.
