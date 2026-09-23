# Backend / Integration

Ветка: `feat/backend-core`. Контракт: приложенный «Промпт №2», v1.
При первоначальной реализации общие документы и AI engine отсутствовали.
После объединения с `main` (`f5059e1`) доступны `docs/contracts.md`,
`docs/architecture.md`, `docs/task.md`, `docs/source_notes.md`, `data/` и
`backend/recommendation/engine.py`. Замороженные файлы получены без правок.
`service.py`, `requirements-ai.txt`, frontend и README исходного engine пока отсутствуют.

## План и журнал

1. `backend/models.py`, `loading.py`, `repository.py`: Pydantic, атомарный seed,
   импорт, версии, журнал завершений в SQLite. Проверить persistence и rollback.
2. `backend/config.py`, `auth.py`, `main.py`, `schemas.py`, `integration.py`:
   JWT/Argon2, права, HTTP-контракт, независимые запросы рекомендаций.
3. `tests/backend/`: auth, импорты, повтор завершения, stale revision,
   ошибки и маршрутизация SPA. AI в тестах — явно тестовый двойник.
4. Корневые README, Dockerfile, compose.yaml, env/ignore; интеграционные инструкции.

Решение: разработку хранения и API продолжаем по приложенному контракту.
Проверку реального AI-модуля и полного Docker выполняем только после появления
файлов напарников. Отсутствующий модуль возвращает 503, не фиктивный readiness.
Старый черновик `work/karim312k1/backend/` сохранён, в новую сборку не входит.

## Граница AI-модуля (требует проверки с владельцем)

Согласованы `engine.Data`, `service.analyze_employee`,
`service.get_recommendations`, `engine.hr_view`. Backend не считает навыки.
Для корректного учёта runtime completions нужны дополнительные договорённости:
`service.data_from_snapshot(snapshot)` и
`service.validate_completion(data, employee_id, event_id, occurrence_key)`.
Это **предложенные**, ещё не подтверждённые интерфейсы. Первый получает отдельные
baseline/history/completions, второй проверяет eligibility и возвращает None
либо отклоняет операцию. До подключения обоих Complete отвечает 503 до записи.

Completion хранится отдельно с baseline_version, модельной датой, реальным
timestamp и occurrence_key. Базовые skills не изменяются. AI должен применять
текущие отметки ровно один раз, даже при last_review_date == as_of_date.
Обычное событие уникально по employee/event; EV_036 — по employee/event/session.
Повторный импорт идентичного baseline сохраняет отметки. Изменение baseline при
существующих demo-отметках отклоняется 409: без явного признака «уже включено
в новую оценку» нельзя безопасно угадать, нужно ли повторно применять gain.
Это ограничение MVP, а не молчаливое стирание прогресса; его надо согласовать.

Snapshot содержит `skills`, `profiles` с ключами `(role,grade)`, `employees`,
`events` (словари исходных JSON-объектов), `history` (исходные типизированные
строки), `completions` (отдельные отметки), `employee_versions`, `as_of` (date),
`state_revision`. Он отсоединён от SQLite и прочитан в одной read transaction.
`baseline_version` у отметки — происхождение; одинаковый повторный импорт
повышает версию профиля, но НЕ отменяет эти отметки. Все сохранённые demo-отметки
должны учитываться независимо от равенства их версии текущей версии профиля.
`replaces_record_id` означает обновление существующего in_progress/overdue
участия, а не ещё одно участие в знаменателе HR. Собственная история профиля
собирается backend с учётом этой замены и никогда не содержит чужих строк.

## Проверено в этой реализации

- Команда из корня: `./work/karim312k1/backend/.venv/Scripts/python.exe -m pytest tests/backend -q`.
  После исправления ревью: **20 passed**, Python 3.13.5.
- Реальный синтетический набор: 200 сотрудников, 60 навыков, 40 мероприятий,
  2743 строки истории; транзакционный seed, сохранение импорта и завершений
  после повторного открытия SQLite, atomic conflict/rollback.
- Auth 401/403, роль из БД, employee self, HR read-only, admin upload/preview;
  несовместимый/истёкший JWT; единый error envelope, лимиты и изоляция SPA.
- Двойной/параллельный Complete, разные сессии EV_036, неизменность baseline,
  provenance при same-day review, отказ небезопасной замены baseline.
- Timeout 504, stale revision 409, язык запроса, явный 503 без AI. Эти проверки
  используют DomainDouble; рост навыков и смена рекомендаций НЕ проверены.
- Независимое ревью: исключение могло повторно выбрасываться Starlette и
  попадать в логи Uvicorn. Регрессионный тест сначала воспроизвёл ошибку;
  SafeErrors перехватывает её до серверного логирования; весь набор прошёл.
- Есть предупреждение Starlette о будущем отказе от httpx TestClient.
  Пока используем согласованный httpx; тесты выполняются. Новую зависимость
  httpx2 без необходимости не добавляем.

## Что осталось для командной интеграции

- Общие документы, `data/` и исходный engine получены из main. Получить AI
  `service.py`, `requirements-ai.txt`, frontend и недостающие README набора/engine.
- Поля конструктора Data сверены с полученным engine; проверить сквозной вызов
  service и формы hr_view после подключения AI. Исходные AI-тесты ещё используют
  старые импорты/пути; их адаптация относится к области AI-разработчика.
- Согласовать два completion hooks выше и политику reimport с demo-отметками;
  проверить реальный gain ровно один раз, capped gain, prerequisites,
  same-day review, readiness и HR participation без дублирования.
- Проверить Python 3.12, полный install requirements с AI-файлом, frontend
  npm ci/build и Docker. Docker daemon сейчас недоступен.
- Реальное OpenAI-демо — отдельно с разрешением владельца ключа. В этой
  реализации сетевых AI-запросов не было. Fallback математику не дублируем.

Коммит, push, merge/rebase и изменение чужих/замороженных файлов не выполнялись.
