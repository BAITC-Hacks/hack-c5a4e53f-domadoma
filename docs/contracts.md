# Career Quest — общий контракт v1

Одинаков для всех трёх Codex. Имена полей в этом документе фиксированы. Данные в примерах иллюстрируют ФОРМАТ, а не вычисленный результат конкретного сотрудника. Зависимости реализации не должны потребовать изменять контракт без согласования.

## Внутренний Python-интерфейс

AI владеет `backend/recommendation/service.py`:

```python
from backend.recommendation.engine import Data

def analyze_employee(data: Data, employee_id: str) -> dict:
    """Детерминированный профиль в формате ProfileResponse ниже; без I/O/LLM."""

async def get_recommendations(
    data: Data,
    employee_id: str,
    *,
    language: str,
    state_revision: int,
) -> dict:
    """RecommendationResponse; переданный snapshot не изменять."""
```

Существующие `recommend(data, emp_id, k=3, extra_completed=())`, `effective_skills`, `readiness`, `hr_view` сохраняются совместимыми. AI добавляет адаптер, не переписывает API старого модуля.

Backend создаёт `engine.Data` из SQLite: skills, profiles с ключом (role,grade), employees, events, history и as_of. AI документирует любые минимальные дополнительные поля для отметок текущей сессии; изменение согласуется до использования. Backend добавляет state_revision в ProfileResponse. Материализация Data — временный snapshot, не отдельное состояние. GLOBAL_PRIOR нельзя независимо менять между запросами с разными snapshot; AI изолирует prior в данных/контексте, сохраняя результаты baseline.

## HTTP

Общий префикс /api. Защищённые запросы: Authorization: Bearer <token>. Все ошибки, включая валидацию и auth, в одном формате `{"error":{"code":"...","message":"...","details":[]}}`; details — список объектов с file/row/field/message по применимости. Пароли/токены туда не включать.

| Метод / путь | Запрос | Ответ / доступ |
|---|---|---|
| GET /api/health | — | status; без секретов |
| POST /api/auth/login | JSON username, password | access_token, token_type=bearer, user |
| GET /api/auth/me | — | user_id, role, employee_id (или null) |
| GET /api/employees | — | {employees:[{employee_id,full_name,role,grade}]}; HR/admin |
| GET /api/employees/{id} | — | ProfileResponse; employee только self, HR/admin для проверки |
| GET /api/employees/{id}/recommendations | lang=kk/ru/en, необязательно | RecommendationResponse; тот же доступ |
| POST /api/employees/{id}/activities/{event_id}/complete | JSON occurrence_key (или null), заголовок Idempotency-Key | {status:completed или already_completed, profile:ProfileResponse}; employee self/admin |
| GET /api/hr/overview | — | HRResponse; HR/admin |
| POST /api/admin/upload | multipart employees_file JSON и history_file CSV | ImportResponse; admin |

Администратор может открыть импортированного сотрудника без создания этому синтетическому профилю отдельного аккаунта. Это ограниченный server-authorized preview, не переключатель роли для всех.

### ProfileResponse

```json
{
  "employee": {
    "employee_id": "EXAMPLE",
    "full_name": "Demo Employee",
    "department": "Backend Development",
    "role": "Backend Engineer",
    "grade": "Middle",
    "preferred_language": "ru"
  },
  "target": {"role": "Backend Engineer", "grade": "Senior", "source": "career_goal"},
  "readiness": {"pct": 50, "critical_met": 0, "critical_total": 1},
  "skills": [
    {"skill_id": "SK_SYSTEM_DESIGN", "name": "System Design", "current": 2, "required": 4, "gap": 2, "critical": true}
  ],
  "history": [],
  "state_revision": 1
}
```

employee — безопасный поднабор исходного профиля; при необходимости дополнительные несекретные поля объявить в схемах. target.source: career_goal/next_grade/current_grade. required может быть null для навыка, не входящего в требования цели; gap тогда 0, critical=false. history содержит строки исходной истории с title, типизированными числовыми/null полями; никогда не чужую историю. Не путать `full_name` с `name`, `employee_id` с `id`.

### RecommendationResponse

```json
{
  "employee_id": "EXAMPLE",
  "language": "ru",
  "state_revision": 1,
  "source": "llm",
  "fallback_reason": null,
  "leader_override": false,
  "duration_ms": 800,
  "recommendations": [
    {
      "event_id": "EXAMPLE_EVENT",
      "title": "Example activity",
      "type": "workshop",
      "format": "online",
      "duration_hours": 2,
      "next_session": "2026-10-05",
      "score": 0.25,
      "impact": 0.5,
      "likelihood": 0.5,
      "closes": [
        {"skill_id": "SK_SYSTEM_DESIGN", "name": "System Design", "from": 2, "to": 3, "required": 4, "critical": true}
      ],
      "unlocks": [],
      "reasons": [
        "Навык требуется для целевого грейда Senior.",
        "Текущий уровень 2, требуемый — 4.",
        "Выполнение закрывает один уровень разрыва."
      ],
      "reason_factors": [
        {"fact_id": "f1", "type": "target", "values": {"target_grade": "Senior"}},
        {"fact_id": "f2", "type": "skill_gap", "values": {"skill_id": "SK_SYSTEM_DESIGN", "current": 2, "required": 4}},
        {"fact_id": "f3", "type": "event_gain", "values": {"skill_id": "SK_SYSTEM_DESIGN", "from": 2, "to": 3}}
      ]
    }
  ],
  "not_chosen": null,
  "uncovered_critical": [],
  "empty_reason": null
}
```

Сохраняем семантику `impact` как ЧИСЛА существующего движка; изменения навыков — массив `closes`. Не использовать объект impact в одном модуле и массив в другом. `closes.to` в исходном engine — закрытие разрыва до цели (может быть ограничено required), а не обязательный полный итоговый уровень после всех gain; UI подписывает это «закрытие разрыва», фактическое изменение берёт из Complete/profile. Score/likelihood не показывать как научно валидированную вероятность. Нет confidence=0.9 из воздуха.

not_chosen — null или {skill_id,text}, локализованный и пересчитанный для ФИНАЛЬНОГО списка, а не старого baseline. uncovered_critical — массив skill_id. empty_reason: null либо target_covered/no_eligible_events/missing_prerequisites/catalog_gap. source: llm/fallback. При валидационном отказе fallback_reason — короткий машинный код, без текста исключения и секретов.

LLM-схема намеренно меньше HTTP-схемы:
```json
{"choices":[{"event_id":"EXAMPLE_EVENT","fact_ids":["f1","f2","f3"],"explanation":"..."}]}
```

Модель не создаёт `values`, score, readiness и gain: сервер извлекает их из реестра фактов. Минимум 3 категории реально доступных фактов. Недостаточную историю отражать явно, не выдумывать прошлые завершения.

### Завершение

Для обычного события occurrence_key=null означает единственное прохождение. Для EV_036 ключ — next_session рекомендованной сессии. Повтор того же employee/event/occurrence и того же idempotency key не даёт нового прироста. Следующая отличная сессия регулярного клуба не блокируется навсегда. Доменная логика отличает журнал исходного набора от новых demo-отметок и учитывает эффект ровно один раз.

Ответ содержит обновлённый profile, не LLM-рекомендации. Затем frontend отдельно запрашивает GET recommendations. Нельзя задерживать обновление навыков ожиданием внешней модели. UI игнорирует устаревший ответ со старой state_revision.

### HRResponse

```json
{
  "state_revision": 1,
  "weak_skills": [],
  "no_recommendation": [],
  "participation": []
}
```

Форма элементов совпадает с текущим `engine.hr_view`: weak_skills [{skill_id,name,employees,critical_for}], no_recommendation [{employee_id,role,grade,open_gaps,blocked_by_prereq}], participation [{title,completed,total,no_show,declined,dropped}]. Backend может добавить event_id для устойчивого ключа строки. completed/total показывать с явно названным знаменателем; не смешивать обязательные и добровольные события. Не выдавать этот маршрут employee.

### ImportResponse

```json
{"employee_ids":["NEW_TEST_ID"],"employees_upserted":1,"history_imported":3,"history_duplicates_skipped":0,"state_revision":2}
```

JSON принимает оригинальную оболочку {meta,employees:[...]}; дополнительно допустимы массив и один объект профиля. CSV использует реальные заголовки датасета. Исходные employees/history можно отправить вместе; не требовать skills/events для каждого нового профиля. Неизвестные event_id/skill_id не создавать автоматически.
