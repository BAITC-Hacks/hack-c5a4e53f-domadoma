# Что проверено при подготовке архитектуры

Источники: загруженные пользователем career_quest_dataset.zip и files.zip. GitHub-репозиторий команды не подключался и не проверялся: план основан на переданных архивах, не на последних удалённых коммитах.

В files.zip: engine.py, README.md, demo.py, test_engine.py, make_fixtures.py. README ожидает tests/, но в архиве тесты и генератор лежат в корне.

Для отдельной проверки в рабочем контейнере был создан каталог:
- engine.py и demo.py в корне;
- исходный набор в data/;
- неизменённые test_engine.py и make_fixtures.py скопированы в tests/.

Команды:
```
python tests/make_fixtures.py
python -m pytest -q tests
```
Результат: `6 passed in 0.32s`.

Это проверка предоставленных тестов детерминированного ядра в восстановленной структуре. Она НЕ подтверждает готовность FastAPI, UI, SQLite, auth, LLM, защитных правил или прохождение скрытых тестов жюри. В новом package layout импорты тестов нужно адаптировать и снова запускать.

Фактические существующие API:
- Data.from_dir(path), Data.load_employees(path), Data.load_history(path);
- effective_skills(data, emp, extra_completed=());
- target_profile(data, emp), skill_gaps(data, emp, skills), readiness(data, emp, skills);
- calibrate(data), engagement(data, emp_id), likelihood(stats, ev);
- recommend(data, emp_id, k=3, extra_completed=());
- hr_view(data, min_group=5).

Особенности при интеграции:
- recommend возвращает readiness как объект с pct, а не число;
- impact у рекомендации — число, closes — массив изменений;
- вероятность/скорость участия вычисляется сглаженной эвристикой; нельзя выдавать её за наблюдаемую частоту без пояснения;
- GLOBAL_PRIOR — глобальная переменная исходного модуля; при нескольких snapshot её нужно изолировать;
- исходные loader'ы не являются полноценным атомарным import API; SQLite-валидация/transaction — отдельная задача backend;
- effective_skills учитывает историю после last_review_date, поэтому дублирование прибавки в backend недопустимо;
- функция recommend(k=5) уже существует, но выбор имеет поправку на разнообразие и output округляет score. Для защиты лидера нужен неокруглённый базовый score, а не сравнение округлённых output-значений.

В README датасета условное сегодня — 2026-10-01. Это дата модели, НЕ календарная дата проведения хакатона.
