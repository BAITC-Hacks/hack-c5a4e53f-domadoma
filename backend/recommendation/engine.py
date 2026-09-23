"""
Career Quest — ядро рекомендаций.
Детерминированный многофакторный скоринг: каждый фактор сохраняется с числом,
чтобы объяснение (шаблонное или через LLM) опиралось на реальный расчёт.
"""
from __future__ import annotations
import csv, json, math
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

GRADES = ["Junior", "Middle", "Senior", "Lead"]
NEG = {"no_show", "declined", "dropped"}          # отрицательные сигналы вовлечённости
RECURRING = {"EV_036"}                            # можно проходить повторно (README)

# Веса — подбираются на тестовых профилях-ловушках
W_CRITICAL = 2.0      # вес критичного навыка целевого грейда
W_CURRENT_DEFICIT = 1.5  # навык не дотягивает даже до ТЕКУЩЕГО грейда
PRIOR_STRENGTH = 2.0  # сила сглаживания вероятности участия
MIN_LIKELIHOOD = 0.15
UNLOCK_SHARE = 0.5    # доля ценности заблокированной активности, которую получает шаг-разблокировщик # нижняя граница: не исключаем навык полностью, только понижаем


def _d(s):
    return date.fromisoformat(s) if s else None


# ---------------------------------------------------------------- загрузка
@dataclass
class Data:
    skills: dict = field(default_factory=dict)        # skill_id -> skill
    profiles: dict = field(default_factory=dict)      # (role, grade) -> role_profile
    employees: dict = field(default_factory=dict)     # employee_id -> employee
    events: dict = field(default_factory=dict)        # event_id -> event
    history: list = field(default_factory=list)       # list[dict]
    as_of: date = date(2026, 10, 1)
    prior: float = 0.7

    # --- загрузка файлов в формате датасета; повторные вызовы дополняют данные
    def load_skills(self, path):
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        for s in raw["skills"]:
            self.skills[s["skill_id"]] = s
        for p in raw["role_profiles"]:
            self.profiles[(p["role"], p["grade"])] = p
        if raw.get("meta", {}).get("as_of_date"):
            self.as_of = _d(raw["meta"]["as_of_date"])

    def load_events(self, path):
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        for e in raw["events"] if isinstance(raw, dict) else raw:
            self.events[e["event_id"]] = e

    def load_employees(self, path):
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        items = raw["employees"] if isinstance(raw, dict) else raw
        if isinstance(items, dict):
            items = [items]
        errors = []
        for e in items:
            if (e.get("role"), e.get("grade")) not in self.profiles:
                errors.append(f"{e.get('employee_id')}: нет role_profile для {e.get('role')}/{e.get('grade')}")
                continue
            e.setdefault("skills", {})
            self.employees[e["employee_id"]] = e       # новый профиль заменяет старый
        return errors

    def load_history(self, path):
        seen = {r["record_id"] for r in self.history}
        errors = []
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["record_id"] in seen:
                    continue
                if r["event_id"] not in self.events:
                    errors.append(f"{r['record_id']}: неизвестное событие {r['event_id']}")
                    continue
                self.history.append(r)
        self.history.sort(key=lambda r: (r["date"], r["employee_id"], r["event_id"]))
        return errors

    @classmethod
    def from_dir(cls, d):
        d = Path(d); data = cls()
        data.load_skills(d / "skills.json")
        data.load_events(d / "events.json")
        data.load_employees(d / "employees.json")
        data.load_history(d / "activity_history.csv")
        return data

    def history_of(self, emp_id):
        return [r for r in self.history if r["employee_id"] == emp_id]


# ---------------------------------------------------------------- состояние сотрудника
def effective_skills(data: Data, emp, extra_completed=()):
    """Уровни из оценки + прирост от завершённых после last_review_date (README:
    они ещё не учтены) + отмеченных в приложении. Возвращает (skills, лог приростов)."""
    skills = {s: emp["skills"].get(s, 0) for s in data.skills}
    review = _d(emp.get("last_review_date")) or date.min
    log = []
    done = [(r["date"], r["event_id"]) for r in data.history_of(emp["employee_id"])
            if r["status"] == "completed" and _d(r["date"]) > review]
    done += [(str(data.as_of), ev) for ev in extra_completed]
    for dt, ev_id in sorted(done):
        for ds in data.events[ev_id]["develops_skills"]:
            before = skills.get(ds["skill_id"], 0)
            after = max(before, min(before + ds["gain"], ds["max_level"]))
            if after > before:
                skills[ds["skill_id"]] = after
                log.append({"event_id": ev_id, "skill_id": ds["skill_id"], "from": before, "to": after, "date": dt})
    return skills, log


def target_profile(data: Data, emp):
    """Цель: career_goal, иначе следующий грейд своей роли. Для Lead без цели — текущий грейд."""
    g = emp.get("career_goal")
    if g and (g["target_role"], g["target_grade"]) in data.profiles:
        return data.profiles[(g["target_role"], g["target_grade"])], "career_goal"
    i = GRADES.index(emp["grade"])
    if i + 1 < len(GRADES):
        return data.profiles[(emp["role"], GRADES[i + 1])], "next_grade"
    return data.profiles[(emp["role"], emp["grade"])], "current_grade"


def skill_gaps(data, emp, skills):
    tgt, source = target_profile(data, emp)
    cur = data.profiles[(emp["role"], emp["grade"])]
    gaps = {}
    for s, req in tgt["required_skills"].items():
        have = skills.get(s, 0)
        if have < req:
            cur_req = cur["required_skills"].get(s, 0)
            w = 1.0
            if s in tgt["critical_skills"]: w *= W_CRITICAL
            if have < cur_req: w *= W_CURRENT_DEFICIT
            gaps[s] = {"have": have, "required": req, "gap": req - have, "weight": w,
                       "critical": s in tgt["critical_skills"], "below_current_grade": have < cur_req}
    return gaps, tgt, source


def readiness(data, emp, skills):
    tgt, _ = target_profile(data, emp)
    req = tgt["required_skills"]
    total = sum(req.values()) or 1
    got = sum(min(skills.get(s, 0), v) for s, v in req.items())
    crit_ok = sum(skills.get(s, 0) >= req[s] for s in tgt["critical_skills"])
    return {"pct": round(100 * got / total), "critical_met": crit_ok, "critical_total": len(tgt["critical_skills"])}


# ---------------------------------------------------------------- вовлечённость по истории
def _rate(pos, n, prior):
    return (pos + PRIOR_STRENGTH * prior) / (n + PRIOR_STRENGTH)


def engagement(data, emp_id):
    """Статистика по добровольным активностям: общая, по навыкам, по формату, по типу."""
    stats = {"all": [0, 0], "skill": {}, "format": {}, "type": {}, "event": {}}
    for r in data.history_of(emp_id):
        ev = data.events[r["event_id"]]
        if ev["mandatory"] or r["status"] == "in_progress":
            continue
        ok = r["status"] == "completed"
        keys = [("all", None)] + [("skill", d["skill_id"]) for d in ev["develops_skills"]] + \
               [("format", ev["format"]), ("type", ev["type"]), ("event", ev["event_id"])]
        for kind, k in keys:
            bucket = stats[kind] if kind == "all" else stats[kind].setdefault(k, [0, 0, []])
            bucket[0] += ok; bucket[1] += 1
            if kind != "all" and not ok:
                bucket[2].append(r["status"])
    return stats


GLOBAL_PRIOR = 0.7   # legacy default for direct likelihood() callers


def calibrate(data):
    vol = [r for r in data.history if not data.events[r["event_id"]]["mandatory"] and r["status"] != "in_progress"]
    if vol:
        data.prior = sum(r["status"] == "completed" for r in vol) / len(vol)


def likelihood(stats, ev, prior=None):
    """Вероятность, что сотрудник реально пройдёт активность. Иерархия: общий уровень →
    навыки → формат/тип → само событие. Отказы по похожим активностям снижают оценку."""
    base = _rate(stats["all"][0], stats["all"][1], GLOBAL_PRIOR if prior is None else prior)
    parts, reasons = [], []
    for d in ev["develops_skills"]:
        b = stats["skill"].get(d["skill_id"])
        if b and b[1]:
            parts.append(_rate(b[0], b[1], base))
            if b[2]:
                reasons.append({"skill_id": d["skill_id"], "negatives": b[2], "attempts": b[1], "completed": b[0]})
    p_skill = min(parts) if parts else base
    fb = stats["format"].get(ev["format"]); p_fmt = _rate(fb[0], fb[1], base) if fb else base
    tb = stats["type"].get(ev["type"]); p_type = _rate(tb[0], tb[1], base) if tb else base
    eb = stats["event"].get(ev["event_id"])
    p = 0.5 * p_skill + 0.25 * p_fmt + 0.25 * p_type
    if eb and eb[2]:                           # это же событие уже срывалось
        p *= 0.6 ** len(eb[2])
    return max(MIN_LIKELIHOOD, min(1.0, p)), {
        "overall_rate": round(base, 2), "skill_rate": round(p_skill, 2),
        "format_rate": round(p_fmt, 2), "type_rate": round(p_type, 2),
        "same_event_negatives": eb[2] if eb else [], "skill_negatives": reasons}


# ---------------------------------------------------------------- рекомендации
def recommend(data: Data, emp_id, k=3, extra_completed=()):
    emp = data.employees[emp_id]
    skills, gain_log = effective_skills(data, emp, extra_completed)
    gaps, tgt, source = skill_gaps(data, emp, skills)
    total_gap = sum(g["weight"] * g["gap"] for g in gaps.values()) or 1
    stats = engagement(data, emp_id)
    hist = data.history_of(emp_id)
    completed = {r["event_id"] for r in hist if r["status"] == "completed"} | set(extra_completed)
    in_progress = {r["event_id"] for r in hist if r["status"] == "in_progress"}
    roles = {emp["role"], tgt["role"]}; grades = {emp["grade"], tgt["grade"]}

    cands, blocked = [], []
    for ev in data.events.values():
        if ev["mandatory"] or not ev["develops_skills"]:
            continue
        if ev["event_id"] in completed and ev["event_id"] not in RECURRING:
            continue
        if not (roles & set(ev["target_roles"])) or not (grades & set(ev["target_grades"])):
            continue
        future = [s for s in ev["upcoming_sessions"] if _d(s) >= data.as_of]
        if ev["format"] != "self_paced" and not future:
            continue
        closes = []
        for d in ev["develops_skills"]:
            g = gaps.get(d["skill_id"])
            if not g: continue
            c = min(d["gain"], d["max_level"] - g["have"], g["gap"])
            if c > 0:
                closes.append({**g, "skill_id": d["skill_id"], "closes": c,
                               "name": data.skills[d["skill_id"]]["name"]})
        if not closes:
            continue
        missing = {s: v for s, v in ev["prerequisites"].items() if skills.get(s, 0) < v}
        if missing:
            blocked.append({"event_id": ev["event_id"], "title": ev["title"], "missing_prereq": missing,
                            "skills": [c["skill_id"] for c in closes],
                            "value": sum(c["weight"] * c["closes"] for c in closes)})
            continue
        impact = sum(c["weight"] * c["closes"] for c in closes) / total_gap
        p, pinfo = likelihood(stats, ev, data.prior)
        cands.append({"event": ev, "closes": closes, "impact": impact, "likelihood": p,
                      "likelihood_detail": pinfo, "score": impact * p,
                      "in_progress": ev["event_id"] in in_progress,
                      "next_session": future[0] if future else None})

    # бонус за разблокировку: шаг поднимает пререквизит активности, которая закрывает важный разрыв
    for c in cands:
        c["unlocks"] = []
        for b in blocked:
            ok = all(any(d["skill_id"] == s and min(skills.get(s, 0) + d["gain"], d["max_level"]) >= lvl
                         for d in c["event"]["develops_skills"]) or skills.get(s, 0) >= lvl
                     for s, lvl in b["missing_prereq"].items())
            if ok:
                c["unlocks"].append(b)
                c["impact"] += UNLOCK_SHARE * b["value"] / total_gap
        c["score"] = c["impact"] * c["likelihood"]

    # жадный отбор с разнообразием: второй шаг по тому же навыку ценится меньше
    picked, covered = [], {}
    pool = sorted(cands, key=lambda c: -c["score"])
    while pool and len(picked) < k:
        for c in pool:
            overlap = sum(covered.get(x["skill_id"], 0) for x in c["closes"])
            c["adj"] = c["score"] * (0.5 ** overlap)
        pool.sort(key=lambda c: -c["adj"])
        best = pool.pop(0); picked.append(best)
        for x in best["closes"]:
            covered[x["skill_id"]] = covered.get(x["skill_id"], 0) + 1

    recs = [explain(data, emp, c, gaps, tgt, source, total_gap) for c in picked]
    return {
        "employee": emp, "skills": skills, "applied_gains": gain_log,
        "target": {"role": tgt["role"], "grade": tgt["grade"], "source": source},
        "readiness": readiness(data, emp, skills), "gaps": gaps,
        "recommendations": recs,
        "not_chosen": why_not(data, gaps, cands, picked, stats),
        "blocked": blocked,
        # критичные разрывы, которые не закрывает ни одна доступная активность
        "uncovered_critical": [s for s, g in gaps.items() if g["critical"] and
                               not any(x["skill_id"] == s for c in cands for x in c["closes"])],
    }


# ---------------------------------------------------------------- объяснение
SOURCE_RU = {"career_goal": "карьерная цель", "next_grade": "следующий грейд", "current_grade": "текущий грейд"}


def why_not(data, gaps, cands, picked, stats):
    """Почему не выбран навык, который выбрало бы наивное правило «самый низкий уровень»."""
    if not gaps:
        return None
    s, g = min(gaps.items(), key=lambda x: (x[1]["have"], -x[1]["gap"]))
    if any(x["skill_id"] == s for c in picked for x in c["closes"]):
        return None
    name = data.skills[s]["name"]
    parts = [f"{name} — самый низкий навык ({g['have']} из {g['required']})"]
    if not g["critical"]:
        parts.append("но он не критичен для цели")
    b = stats["skill"].get(s)
    if b and b[2]:
        parts.append(f"по похожим активностям {len(b[2])} срыв(а) из {b[1]}")
    if not any(x["skill_id"] == s for c in cands for x in c["closes"]):
        parts.append("и доступной активности сейчас нет")
    return {"skill_id": s, "text": ", ".join(parts)}


def explain(data, emp, c, gaps, tgt, source, total_gap):
    ev = c["event"]; main = max(c["closes"], key=lambda x: x["weight"] * x["closes"])
    share = round(100 * sum(x["weight"] * x["closes"] for x in c["closes"]) / total_gap)
    lines = [f"Цель: {tgt['grade']} {tgt['role']} ({SOURCE_RU[source]}); "
             f"шаг закрывает ~{share}% взвешенного разрыва до цели"]
    lines.append(f"{main['name']}: {main['have']} при требуемых {main['required']}"
                 + (" — критичный навык для цели" if main["critical"] else "")
                 + (", ниже уровня текущего грейда" if main["below_current_grade"] else ""))
    others = [x for x in c["closes"] if x is not main]
    if others:
        lines.append("Также развивает: " + ", ".join(f"{x['name']} (+{x['closes']})" for x in others))
    li = c["likelihood_detail"]
    fmt_n = data.events[ev["event_id"]]["format"]
    lines.append(f"История участия: завершает {round(li['overall_rate']*100)}% добровольных активностей, "
                 f"в формате {fmt_n} — {round(li['format_rate']*100)}%")
    for neg in li["skill_negatives"]:
        lines.append(f"Внимание: по навыку {data.skills[neg['skill_id']]['name']} "
                     f"{len(neg['negatives'])} срыв(а) из {neg['attempts']} ({', '.join(neg['negatives'])})")
    for b in c.get("unlocks", []):
        lines.append(f"Открывает доступ к «{b['title']}» (нужно: " + ", ".join(
            f"{data.skills[s]['name']} ≥ {v}" for s, v in b["missing_prereq"].items()) + ")")
    if c["in_progress"]:
        lines.append("Уже начато — стоит завершить")
    return {
        "event_id": ev["event_id"], "title": ev["title"], "type": ev["type"], "format": ev["format"],
        "duration_hours": ev["duration_hours"], "next_session": c["next_session"],
        "score": round(c["score"], 3), "raw_score": c["score"], "impact": round(c["impact"], 3),
        "likelihood": round(c["likelihood"], 2),
        "closes": [{"skill_id": x["skill_id"], "name": x["name"], "from": x["have"],
                    "to": x["have"] + x["closes"], "required": x["required"],
                    "critical": x["critical"]} for x in c["closes"]],
        "unlocks": [b["event_id"] for b in c.get("unlocks", [])],
        "factors": {"gap": main["gap"], "critical": main["critical"], "likelihood": li},
        "reasons": lines,
    }


# ---------------------------------------------------------------- HR
def hr_view(data: Data, min_group=5):
    gap_count, no_rec, part = {}, [], {}
    for emp_id in data.employees:
        r = recommend(data, emp_id, k=1)
        for s, g in r["gaps"].items():
            gap_count.setdefault(s, [0, 0]); gap_count[s][0] += 1
            gap_count[s][1] += g["critical"]
        if not r["recommendations"] and r["gaps"]:
            no_rec.append({"employee_id": emp_id, "role": r["employee"]["role"],
                           "grade": r["employee"]["grade"], "open_gaps": list(r["gaps"]),
                           "blocked_by_prereq": r["blocked"]})
    for row in data.history:
        ev = data.events[row["event_id"]]
        if ev["mandatory"]: continue
        p = part.setdefault(ev["event_id"], {"title": ev["title"], "completed": 0, "total": 0, "no_show": 0, "declined": 0, "dropped": 0})
        p["total"] += 1
        if row["status"] in p: p[row["status"]] += 1
    top = sorted(({"skill_id": s, "name": data.skills[s]["name"], "employees": v[0], "critical_for": v[1]}
                  for s, v in gap_count.items() if v[0] >= min_group), key=lambda x: -x["employees"])
    return {"weak_skills": top, "no_recommendation": no_rec,
            "participation": sorted(part.values(), key=lambda x: x["completed"] / max(x["total"], 1))}
