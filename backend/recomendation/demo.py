"""python demo.py E0028 [дополнительная_папка_с_профилями]"""
import sys, engine
d = engine.Data.from_dir("data")
if len(sys.argv) > 2:  # профили жюри: employees.json и/или activity_history.csv
    from pathlib import Path
    p = Path(sys.argv[2])
    if (p / "employees.json").exists(): print(d.load_employees(p / "employees.json") or "профили загружены")
    if (p / "activity_history.csv").exists(): print(d.load_history(p / "activity_history.csv") or "история загружена")
engine.calibrate(d)
r = engine.recommend(d, sys.argv[1])
e = r["employee"]
print(f"\n{e['full_name']} — {e['grade']} {e['role']} → цель {r['target']['grade']} {r['target']['role']}")
print(f"Готовность: {r['readiness']['pct']}%, критичных навыков закрыто {r['readiness']['critical_met']}/{r['readiness']['critical_total']}")
for g in r["applied_gains"]:
    print(f"  учтено после оценки: {g['event_id']} {g['skill_id']} {g['from']}→{g['to']}")
for i, x in enumerate(r["recommendations"], 1):
    print(f"\n{i}. {x['title']} [{x['format']}, {x['duration_hours']} ч] score={x['score']}")
    for l in x["reasons"]: print("   -", l)
if r["not_chosen"]: print("\nПочему не другое:", r["not_chosen"]["text"])
if r["uncovered_critical"]: print("Критичные разрывы без активности в каталоге:", ", ".join(r["uncovered_critical"]))
