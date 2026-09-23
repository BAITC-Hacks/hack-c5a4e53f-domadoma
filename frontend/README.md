# Career Quest frontend demo

## Запуск связки локально

1. В соседнем терминале запусти backend на `http://127.0.0.1:8000`.
2. В этом каталоге установи зависимости и запусти Vite:

```powershell
npm install
npm run dev
```

3. Открой `http://127.0.0.1:5173`.

Vite проксирует запросы `/api` на backend. Frontend не содержит OpenAI-ключей и JWT-секретов.

## Демо-сценарии

- `employee`: профиль, readiness, AI-рекомендации и Complete;
- `hr`: командный обзор через `/api/hr/overview`;
- `admin`: режим жюри, выбор профиля и загрузка `employees.json` + `history.csv` через `/api/admin/upload`.

Пароли задаются переменными окружения backend. Production-сборка проверяется командой `npm run build`.
