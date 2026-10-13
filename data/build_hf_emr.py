"""심부전(KCD-8 I509) 환자 102명을 EMR 번들(JSON)로 변환한다.

입력 : RAG/data/{training,tuning,held}.parquet, codes.parquet, subject_splits.parquet (MEDS 형식)
출력 : RAG/emr/public/hf/index.json (환자 목록) + hf/HFxxx.json (환자별 PatientBundle)

원칙
 - 원본 값만 사용한다. 기록(노트)은 데이터에서 계산한 요약(자동 집계)이며 임상 판단을 새로 만들지 않는다.
 - 날짜는 비식별화로 이동돼 있어 환자별로 최근 4년 안의 상대 일자로 다시 배치한다(환자 내부 간격은 보존).
 - PROCEDURE_START/END 코드 11종은 모든 환자에게 동일 시각에 중복 기록된 인공물이라 오더에서 제외한다.
 - 약품 코드는 이름 사전이 없어 코드 그대로 표시한다.

실행: python build_hf_emr.py
"""
import datetime as dt
import json
import os
import re
import shutil

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "emr", "public", "hf")
TODAY = dt.date(2026, 10, 12)  # 빌드 기준일 (EMR 의 오늘과 맞출 필요는 없다)
HOSPITAL = "익명대학교병원"
AUTHOR_DOC, AUTHOR_NUR = "자동요약", "자동요약(간호)"

# ---------------------------------------------------------------- 사전
KCD = {  # code -> (영문명(국문), 지침 질의)
    "I509": ("Heart failure, unspecified (심부전, 상세불명)", "심부전 환자의 약물치료 권고는?"),
    "I4890": ("Atrial fibrillation (심방세동)", "비판막성 심방세동 환자의 경구 항응고제 사용 기준은?"),
    "I109": ("Hypertension, unspecified (고혈압)", None),
    "K219": ("Gastro-esophageal reflux disease (위식도역류병)", None),
    "N179": ("Acute kidney failure, unspecified (급성 신부전)", "신기능이 저하된 심부전 환자의 약물 사용 시 주의사항은?"),
    "I209": ("Angina pectoris, unspecified (협심증)", None),
    "J189": ("Pneumonia, unspecified (폐렴)", None),
    "E149": ("Diabetes mellitus, unspecified (당뇨병)", "당뇨병이 동반된 심부전 환자에서 SGLT2 억제제 권고는?"),
    "E7808": ("Dyslipidemia, E78.08 (이상지질혈증)", None),
    "N189": ("Chronic kidney disease, unspecified (만성 신장병)", "신기능이 저하된 심부전 환자의 약물 사용 시 주의사항은?"),
    "N185": ("Chronic kidney disease, stage 5 (만성 신장병 5기)", "신기능이 저하된 심부전 환자의 약물 사용 시 주의사항은?"),
    "I251": ("Atherosclerotic heart disease (만성 허혈성 심장질환)", None),
    "I350": ("Aortic valve stenosis (대동맥판 협착증)", None),
    "I839": ("Varicose veins of lower extremities (하지 정맥류)", None),
    "E789": ("Disorder of lipoprotein metabolism, unspecified (지질대사장애)", None),
    "Z944": ("Liver transplant status (간 이식 상태)", None),
    "C220": ("Hepatocellular carcinoma (간세포암종)", None),
}
ICD9_PROC = {  # ICD-9-CM 시술 코드 중 이름이 확실한 것만
    "54.11": "Exploratory laparotomy (시험적 개복술)", "86.28": "Nonexcisional debridement of wound (상처 변연절제)",
    "35.2": "Replacement of heart valve (심장판막 대치술)", "36.12": "Aortocoronary bypass, two vessels (관상동맥우회술)",
    "32.4": "Lobectomy of lung (폐엽절제술)", "39.98": "Control of hemorrhage (출혈 조절)", "38.44": "Resection of abdominal aorta with replacement (복부대동맥 절제·대치)",
    "31.1": "Temporary tracheostomy (임시 기관절개술)", "1.24": "Other craniotomy (두개골 절개술)",
}
# 성인 일반 참고치 (low, high). 알 수 없는 항목은 참고치/이상 표시 없이 값만 보여 준다.
REF = {
    "WBC": (4.0, 10.0), "RBC": None, "Hb": "hb", "Hct": "hct", "PLT": (150, 400), "MCV": (80, 100), "MCH": (27, 33), "MCHC": (32, 36), "RDW": (11.5, 14.5), "MPV": (7.5, 12.0),
    "Glucose": (70, 140), "Sodium (serum)": (135, 145), "Potassium (serum)": (3.5, 5.1), "Chloride (serum)": (98, 107), "BUN": (8, 23), "Creatinine": (0.6, 1.2),
    "eGFR(CKD EPI Cr/Cystatin C)": (60, None), "Phosphorus": (2.5, 4.5), "Uric Acid": (3.5, 7.2), "Bilirubin, total": (0.2, 1.2), "Albumin": (3.5, 5.2), "Protein, total": (6.4, 8.3),
    "GOT (AST)": (0, 40), "GPT (ALT)": (0, 40), "Alkaline phosphatase": (35, 129), "Fibrinogen": (200, 400), "PT (INR)": (0.9, 1.1), "PT (sec)": (10.5, 13.5), "aPTT": (25, 40),
    "hs-CRP quantitation": (0, 0.5), "CO2, total (serum)": (22, 29), "CKMB": (0, 5), "Magnesium": (1.6, 2.6), "Cholesterol": (0, 200), "CK (CPK)": (30, 200), "Troponin I": (0, 0.04),
    "Calcium, ionized": (1.12, 1.32), "Lactate": (0.5, 2.2), "pH": (7.35, 7.45), "pCO₂": (35, 45), "pO₂": (80, 100), "HCO3-": (22, 26), "O₂SAT": (95, 100), "ANC": (1500, 8000),
    "Lymphocyte": (20, 40), "Monocyte": (2, 10), "Basophil": (0, 1), "Eosinophil": (1, 5), "Band neutrophil": (0, 5), "Segmented neutrophil": (40, 70),
}
Q_CKD, Q_MRA, Q_IRON, Q_NA = (
    "신기능이 저하된 심부전 환자의 약물 사용 시 주의사항은?",
    "미네랄로코르티코이드 수용체 길항제(MRA) 사용 중 칼륨이 상승하면 지침은 어떻게 권고하나요?",
    "심부전 환자의 철결핍과 빈혈 치료 권고는?",
    "심부전 환자의 저나트륨혈증과 이뇨제 조절에 대한 권고는?",
)
CHART = {  # 코드 접두 -> 키
    "001C_1012": "sbp", "001C_1015": "asbp", "001C_1013": "dbp", "001C_1016": "adbp", "001C_1021": "hr", "001C_1023": "rr", "001C_1026": "bt", "001C_1003": "spo2",
    "001C_1894": "fio2", "001C_1567": "peep", "001C_1728": "pip", "001C_1187_20765": "gcs_e", "001C_1187_20770": "gcs_m", "001C_1187_20775": "gcs_v", "001C_1810": "vent",
}
INS = {"National Healthcare Insurance Service": "건강보험", "medical insurance 1": "의료급여 1종", "Others": "기타"}
OUTCOME = {"Home": "귀가", "Other hospital": "타병원 전원", "Died": "사망", "Others": "기타"}


def lab_name(desc: str) -> str:
    return re.sub(r"\s*\(검사\s*24시간가능\)", "", str(desc)).strip()


def ref_for(name: str, sex: str):
    r = REF.get(name)
    if r == "hb":
        return (13.0, 17.0) if sex == "M" else (12.0, 16.0)
    if r == "hct":
        return (39.0, 52.0) if sex == "M" else (36.0, 48.0)
    return r


def flag_of(v, lo, hi):
    if hi is not None and v > hi:
        return "HH" if v >= hi * 2 else "H"
    if lo is not None and v < lo:
        return "LL" if lo > 0 and v <= lo * 0.6 else "L"
    return "N"


def lab_query(name, v, flag):
    if flag == "N":
        return None
    if name in ("Creatinine", "eGFR(CKD EPI Cr/Cystatin C)"):
        return Q_CKD
    if name == "Potassium (serum)" and flag in ("H", "HH"):
        return Q_MRA
    if name == "Sodium (serum)" and flag in ("L", "LL"):
        return Q_NA
    if name == "Hb" and flag in ("L", "LL"):
        return Q_IRON
    return None


def fmt_ref(lo, hi):
    if lo is not None and hi is not None:
        return f"{lo:g} - {hi:g}"
    if hi is not None:
        return f"< {hi:g}"
    if lo is not None:
        return f"≥ {lo:g}"
    return "-"


def d(x):
    return x.strftime("%Y-%m-%d")


def hm(x):
    return x.strftime("%H:%M")


def clean(v):
    """JSON 직렬화용: numpy/NaN 정리"""
    if isinstance(v, (np.floating, float)):
        return None if (isinstance(v, float) and np.isnan(v)) else round(float(v), 4)
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


SYN_TAG = "시연용 합성"
Q_LOOP = "울혈 증상이 있는 심부전 환자에서 고리이뇨제 사용 권고는?"
Q_BNP = "심부전 진단과 치료에서 나트륨이뇨펩타이드(NT-proBNP)의 역할은?"


def make_synth(srng, sex, sdays):
    """익명 데이터셋에 없는 체액상태·이뇨제 투여를 환자별로 임의 설정한다(합성). 환자 번호로 시드를 고정해 재빌드해도 같다."""
    over = bool(srng.random() < 0.65)
    sev = str(srng.choice(["경도", "중등도", "중증"], p=[0.35, 0.45, 0.2])) if over else None
    dry = round(float(np.clip(srng.normal(71, 9) if sex == "M" else srng.normal(57, 8), 42, 105)), 1)
    height = int(round(float(srng.normal(171, 6) if sex == "M" else srng.normal(158, 5))))
    gain = round(float({"경도": srng.uniform(1.5, 3.0), "중등도": srng.uniform(3.0, 5.5), "중증": srng.uniform(5.5, 9.0)}[sev]) if over else float(srng.uniform(-0.5, 0.8)), 1)
    given = bool(srng.random() < (0.78 if over else 0.12))
    sched = []  # (day, route, dose_mg, freq, n_doses)
    if given:
        if over:
            route = str(srng.choice(["IV", "IV", "IV", "PO"]))
            dose = int({"경도": srng.choice([20, 40]), "중등도": 40, "중증": srng.choice([40, 80])}[sev]) if route == "IV" else int(srng.choice([40, 80]))
            start = int(srng.choice([0, 1, 2], p=[0.65, 0.25, 0.1]))
            dur = int(srng.integers(2, 6))
            freq = "q12h" if route == "IV" and dose <= 40 and srng.random() < 0.7 else "qd"
            nd = 2 if freq == "q12h" else 1
            for i in range(start, min(start + dur, len(sdays))):
                sched.append((sdays[i], route, dose, freq, nd))
        else:  # 체액과다가 아닌데 투여된 경우(유지용/불필요 투여)
            dose = int(srng.choice([20, 40]))
            for i in range(0, min(int(srng.integers(1, 4)), len(sdays))):
                sched.append((sdays[i], "PO", dose, "qd", 1))
    first_given = sched[0][0] if sched else None
    weights, w = {}, round(dry + gain, 1)
    for day in sdays:
        if first_given and day > first_given and w > dry:
            w = round(max(dry, w - float(srng.uniform(0.6, 1.6))), 1)
        elif not first_given:
            w = round(w + float(srng.uniform(-0.2, 0.4)), 1)
        weights[day] = w
    sevx = {"경도": (1500, 4000), "중등도": (4000, 12000), "중증": (12000, 35000)}
    bnp0 = float(srng.uniform(*sevx[sev])) if over else float(srng.uniform(150, 1200))
    bnp1 = bnp0 * (float(srng.uniform(0.4, 0.8)) if given else float(srng.uniform(0.9, 1.1)))
    edema = int({"경도": 1, "중등도": 2, "중증": 3}[sev]) if over else 0
    orth = bool(over and sev != "경도" and srng.random() < 0.7)
    return {"over": over, "sev": sev, "dry": dry, "height": height, "gain": gain, "given": given, "sched": sched, "weights": weights, "bnp": (round(bnp0), round(bnp1)),
            "edema": edema, "orth": orth, "w0": round(dry + gain, 1)}


def build():
    codes = pd.read_parquet(os.path.join(HERE, "codes.parquet"))
    desc = codes.set_index("code")["description"].to_dict()
    splits = pd.read_parquet(os.path.join(HERE, "subject_splits.parquet")).set_index("subject_id")["split"]
    hf = pd.read_parquet(os.path.join(HERE, "hf_patients.parquet"))
    ids = list(hf.subject_id)
    ev = pd.concat([pd.read_parquet(os.path.join(HERE, f"{n}.parquet")) for n in ("training", "tuning", "held")], ignore_index=True)
    ev = ev[ev.subject_id.isin(set(ids))].copy()
    ev["subject_id"] = ev["subject_id"].astype("int64")
    groups = {sid: g.sort_values("time", na_position="first") for sid, g in ev.groupby("subject_id")}

    # 환자별 상대 일자 배치: 최근 3일 ~ 약 3.8년 전 사이에 겹치지 않게 흩뿌린다
    rng = np.random.default_rng(7)
    offsets = np.sort(rng.choice(np.arange(4, 1400), size=len(ids), replace=False))
    order = rng.permutation(len(ids))
    anchor_off = {ids[order[i]]: int(offsets[i]) for i in range(len(ids))}
    ranked = sorted(ids, key=lambda s: anchor_off[s])  # 가까운 날짜일수록 앞 번호
    pid_of = {sid: f"HF{i + 1:03d}" for i, sid in enumerate(ranked)}

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    index = []

    for sid in ranked:
        g = groups[sid]
        pid = pid_of[sid]
        row = hf[hf.subject_id == sid].iloc[0]
        sex = row.sex
        t = g[g.time.notna()]
        # 입원 시작 기준(응급실 등록 > 입원 > 첫 이벤트)
        reg = t[t.code == "ED_REGISTRATION"].time
        ed_out = t[t.code == "ED_OUT"].time
        adm = t[t.code.str.startswith("HOSPITAL_ADMISSION//")]
        dis = t[t.code.str.startswith("HOSPITAL_DISCHARGE//")]
        icu_in = t[t.code.str.startswith("ICU_ADMISSION//")]
        icu_out = t[t.code.str.startswith("ICU_DISCHARGE//")]
        t_adm = adm.time.min() if len(adm) else t[t.code != "MEDS_BIRTH"].time.min()
        t_start = min([x for x in [reg.min() if len(reg) else None, t_adm] if x is not None])
        t_end = dis.time.max() if len(dis) else t.time.max()
        shift = pd.Timestamp(TODAY - dt.timedelta(days=anchor_off[sid])).normalize() - t_start.normalize()

        def sh(x):
            return x + shift

        unit = icu_in.code.iloc[0].split("//")[1] if len(icu_in) else "ICU"
        outcome = OUTCOME.get(dis.code.iloc[-1].split("//")[1], "기타") if len(dis) else "미상"
        died = bool((g.code == "MEDS_DEATH").any())
        dx_codes = [c.split("//")[2] for c in g[g.code.str.startswith("DIAGNOSIS//KCD8//")].code.unique()]
        dx_codes = [c for c in dx_codes if c != "Others"]
        dx_codes = ["I509"] + [c for c in dx_codes if c != "I509"]
        age = row.age_at_hf_dx
        age_label = f"{int(round(age))}세" if pd.notna(age) else "연령 미상"
        sex_k = "남성" if sex == "M" else "여성"
        ins_raw = g[g.code.str.startswith("INSURANCE//")].code
        insurance = INS.get(ins_raw.iloc[0].split("//")[1], "기타") if len(ins_raw) else "-"
        adm_type = row.admission_type if isinstance(row.admission_type, str) else "-"
        route = {"Emergency department": "응급실 경유", "Outpatient department": "외래 경유", "Admission": "입원(직접)"}.get(adm_type, "-")

        dept_icu = f"{unit} 중환자실"
        has_ed = len(reg) > 0
        enc = []
        if has_ed:
            e_end = ed_out.max() if len(ed_out) else reg.min()
            enc.append({"id": f"{pid}-E01", "type": "응급", "date": d(sh(reg.min())), "endDate": d(sh(e_end)) if d(sh(e_end)) != d(sh(reg.min())) else None,
                        "dept": "응급실", "doctor": "-", "title": "응급실 내원", "summary": f"응급실 체류 {int((e_end - reg.min()).total_seconds() // 60)}분 후 입원"})
        stay_id = f"{pid}-E{len(enc) + 1:02d}"
        enc.append({"id": stay_id, "type": "입원", "date": d(sh(t_adm)), "endDate": d(sh(t_end)) if d(sh(t_end)) != d(sh(t_adm)) else None, "dept": dept_icu, "doctor": "-",
                    "title": f"입원 — 심부전({unit} 입실)", "summary": f"{route} · 퇴원: {outcome}" + (" · 사망" if died else "")})

        ed_range = (reg.min(), ed_out.max() if len(ed_out) else reg.min()) if has_ed else None

        def enc_of(ts):
            if ed_range and ed_range[0] <= ts <= ed_range[1] and ts < t_adm:
                return f"{pid}-E01"
            return stay_id

        # ---- 활력징후/차트 ----
        ch = g[g.code.str.startswith("CHARTEVENT//")].copy()
        ch["key"] = ch.code.map(lambda c: next((v for k, v in CHART.items() if c.split("//")[1].startswith(k) and (k != "001C_1187" or True)), None))
        ch = ch[ch.key.notna()]
        ch["key"] = [
            (CHART.get(c.split("//")[1]) or next((v for k, v in CHART.items() if c.split("//")[1].startswith(k)), None)) for c in ch.code
        ]
        ch["ts"] = ch.time.map(sh)
        ch["day"] = ch.ts.dt.strftime("%Y-%m-%d")

        # ---- 검사 ----
        lb = g[g.code.str.startswith("LAB//")].copy()
        labs, lab_orders = [], []
        for k, (ts, grp) in enumerate(lb.groupby("time")):
            tsx = sh(ts)
            eid = enc_of(ts)
            names = []
            for _, r in grp.iterrows():
                name = lab_name(desc.get(r.code, r.code))
                parts = r.code.split("//")
                unit_s = parts[2] if len(parts) > 2 else ""
                ref = ref_for(name, sex)
                lo, hi = (ref if ref else (None, None))
                val = round(float(r.numeric_value), 3)  # 부동소수 잡음(1.1000001)으로 경계값이 이상으로 찍히지 않게 먼저 반올림
                fl = flag_of(val, lo, hi) if ref else "N"
                labs.append({"id": f"{pid}-L{len(labs) + 1:04d}", "patientId": pid, "encounterId": eid, "date": d(tsx), "datetime": f"{d(tsx)} {hm(tsx)}", "name": name, "unit": unit_s,
                             "refLow": lo, "refHigh": hi, "refText": fmt_ref(lo, hi) if ref else "-", "value": round(val, 3), "flag": fl, "dept": dept_icu, "mine": False,
                             "guidelineQuery": lab_query(name, val, fl)})
                names.append(name)
            lab_orders.append({"ts": tsx, "eid": eid, "names": names})

        # ---- 오더 ----
        orders = []

        def add_order(day, eid, visit, cat, name, detail, status="시행", exec_date=None, q=None):
            orders.append({"id": f"{pid}-O{len(orders) + 1:04d}", "patientId": pid, "encounterId": eid, "date": day, "visit": visit, "dept": dept_icu, "doctor": "-", "category": cat, "name": name,
                           "detail": detail, "status": status, "execDate": exec_date or day, "mine": False, "guidelineQuery": q})

        for lo_ in lab_orders:
            names = lo_["names"]
            more = f" 외 {len(names) - 6}항목" if len(names) > 6 else ""
            add_order(d(lo_["ts"]), lo_["eid"], "입원" if lo_["eid"] == stay_id else "응급", "혈액검사", f"혈액검사 {hm(lo_['ts'])} ({len(names)}항목)", ", ".join(names[:6]) + more, "결과확인")
        med = g[g.code.str.startswith("MEDICATION//")].copy()
        med["ts"] = med.time.map(sh)
        for (day, code), grp in med.groupby([med.ts.dt.strftime("%Y-%m-%d"), "code"]):
            c = code.split("//")[1]
            add_order(day, stay_id, "입원", "약물", f"약품코드 {c}", f"{len(grp)}회 투여 · 첫 투여 {hm(grp.ts.min())}")
        for pref, label, cat in (("INPUT_START//", "입력", None), ("OUTPUT//", "출력", None)):
            x = g[g.code.str.startswith(pref)].copy()
            x["ts"] = x.time.map(sh)
            for (day, code), grp in x.groupby([x.ts.dt.strftime("%Y-%m-%d"), "code"]):
                dsc = str(desc.get(code, code))
                nm = dsc.split(">")[-1].strip() if ">" in dsc else dsc
                total = float(grp.numeric_value.sum())
                if pref == "INPUT_START//":
                    cat = "주사" if "정맥" in nm else "처치"
                    add_order(day, stay_id, "입원", cat, f"{nm} (섭취)", f"{len(grp)}회 · 합계 {total:,.0f} cc")
                else:
                    add_order(day, stay_id, "입원", "처치", f"{nm} (배설)", f"{len(grp)}회 · 합계 {total:,.0f} cc")
        # ICD-9 시술
        pr = g[g.code.str.startswith("PROCEDURE_ICD//ICD9CM//") & ~g.code.str.endswith("Others")]
        for _, r in pr.iterrows():
            c = r.code.split("//")[2]
            nm = ICD9_PROC.get(c, f"ICD-9-CM 시술 {c}")
            day = d(sh(r.time))
            enc.append({"id": f"{pid}-E{len(enc) + 1:02d}", "type": "수술", "date": day, "dept": dept_icu, "doctor": "-", "title": nm, "summary": f"ICD-9-CM {c}"})
            add_order(day, enc[-1]["id"], "입원", "수술", nm, f"ICD-9-CM {c} · 시행일 기준(시각 미상)")
        orders.sort(key=lambda o: (o["date"], o["id"]), reverse=True)

        # ---- 활력징후 (일별 첫 측정) ----
        vitals = []
        for day, grp in ch.groupby("day"):
            def first(*keys):
                s = grp[grp.key.isin(keys)].sort_values("ts")
                return float(s.numeric_value.iloc[0]) if len(s) else 0
            vitals.append({"encounterId": stay_id, "date": day, "sbp": round(first("asbp", "sbp")), "dbp": round(first("adbp", "dbp")), "hr": round(first("hr")), "bt": round(first("bt"), 1),
                           "spo2": round(first("spo2")), "weightKg": 0})
        vitals.sort(key=lambda v: v["date"])

        # ---- 합성: 체액상태·furosemide·체중·NT-proBNP·흉부 X선 (익명 데이터에 없는 값을 시연용으로 환자마다 임의 설정) ----
        gio = g[g.code.str.startswith(("INPUT_START//", "OUTPUT//"))]
        sdays = sorted(set(ch.day) | {l["date"] for l in labs if l["encounterId"] == stay_id} | set(gio.time.map(sh).dt.strftime("%Y-%m-%d"))) or [d(sh(t_adm))]
        syn = make_synth(np.random.default_rng(20261012 + int(pid[2:])), sex, sdays)
        for v in vitals:
            v["weightKg"] = syn["weights"].get(v["date"], syn["w0"])
        by_day = {}
        for day, rt, dz, fq, nd in syn["sched"]:  # route 는 입원 경로 변수와 겹치지 않게 다른 이름을 쓴다
            by_day[day] = (rt, dz, fq, nd)
            if rt == "IV":
                add_order(day, stay_id, "입원", "주사", f"Furosemide inj {dz}mg (IV)", f"{dz} mg IV {fq} · {nd}회 투여 ({SYN_TAG})")
            else:
                add_order(day, stay_id, "입원", "약물", f"Furosemide tab {dz}mg (PO)", f"{dz} mg PO {fq} · {nd}회 투여 ({SYN_TAG})")
        bnp_day = [sdays[0]] + ([sdays[min(2, len(sdays) - 1)]] if len(sdays) >= 3 else [])
        for k, (day, val) in enumerate(zip(bnp_day, syn["bnp"])):
            hh = "08:10" if k == 0 else "06:30"
            fl = flag_of(float(val), 0, 125)
            labs.append({"id": f"{pid}-L{len(labs) + 1:04d}", "patientId": pid, "encounterId": stay_id, "date": day, "datetime": f"{day} {hh}", "name": "NT-proBNP", "unit": "pg/mL",
                         "refLow": 0, "refHigh": 125, "refText": "< 125", "value": val, "flag": fl, "dept": dept_icu, "mine": False, "guidelineQuery": Q_BNP if fl != "N" else None})
            add_order(day, stay_id, "입원", "혈액검사", f"혈액검사 {hh} (1항목)", f"NT-proBNP ({SYN_TAG})", "결과확인")
        if syn["over"]:
            cxr = f"Cardiomegaly with pulmonary vascular congestion and interstitial edema{', bilateral pleural effusions (moderate)' if syn['sev'] != '경도' else ', trace bilateral pleural effusion'}. ({SYN_TAG})"
        else:
            cxr = f"Mild cardiomegaly. No pulmonary congestion or pleural effusion. ({SYN_TAG})"
        imaging = [{"id": f"{pid}-I001", "patientId": pid, "encounterId": stay_id, "date": sdays[0], "study": "Chest X-ray (portable)", "report": cxr, "dept": dept_icu, "guidelineQuery": Q_LOOP if syn["over"] else None}]
        add_order(sdays[0], stay_id, "입원", "영상검사", "Chest X-ray (portable)", f"영상의학과 시행 · 판독 완료 ({SYN_TAG})", "결과확인")
        orders.sort(key=lambda o: (o["date"], o["id"]), reverse=True)
        if syn["over"]:
            exam = (f"체액상태: 체액과다(울혈) — {syn['sev']}. 폐 청진 양측 하엽 수포음, 하지 함요부종 {syn['edema']}+, 경정맥 확장(JVP 상승)" + (", 기좌호흡 있음" if syn["orth"] else "") +
                    f". 입원 체중 {syn['w0']}kg (추정 건체중 {syn['dry']}kg 대비 +{syn['gain']}kg).")
        else:
            exam = f"체액상태: 정상체액(euvolemic). 폐 청진 깨끗, 하지부종 없음, 경정맥 확장 없음. 입원 체중 {syn['w0']}kg."
        fur_first = syn["sched"][0] if syn["sched"] else None
        fur_txt = (f"Furosemide {fur_first[2]}mg {fur_first[1]} {fur_first[3]}, {fur_first[0]} 시작, 총 {len(syn['sched'])}일 투여." if fur_first else "입원 중 furosemide(이뇨제) 투여 기록 없음.")

        # ---- 노트(자동 요약) ----
        notes = []

        def note(day, time, kind, visit, eid, title, sections, plan=None, author=AUTHOR_DOC, dept=None):
            notes.append({"id": f"{pid}-N{len(notes) + 1:03d}", "patientId": pid, "encounterId": eid, "date": day, "time": time, "kind": kind, "visit": visit, "dept": dept or dept_icu, "author": author,
                          "own": False, "hospital": HOSPITAL, "title": title, "sections": sections, "plan": plan or [], "inserts": []})

        dx_lines = "\n".join(f"{c[:3]}.{c[3:]} {KCD.get(c, (c, None))[0]}" if c in KCD else f"{c}" for c in dx_codes)
        first_labs = [l for l in labs if l["encounterId"] == stay_id][:0]
        lab_sorted = sorted((l for l in labs if l["name"] != "NT-proBNP"), key=lambda l: l["datetime"])  # 합성 NT-proBNP 는 입실 후 첫 측정 묶음에서 제외
        first_dt = lab_sorted[0]["datetime"] if lab_sorted else None
        first_set = [l for l in lab_sorted if l["datetime"] == first_dt] if first_dt else []
        key_names = ["Hb", "WBC", "PLT", "Creatinine", "BUN", "Sodium (serum)", "Potassium (serum)", "Troponin I", "Lactate", "pH", "hs-CRP quantitation", "eGFR(CKD EPI Cr/Cystatin C)"]
        key_lines = [f"{l['name']} {l['value']:g} {l['unit']}".strip() + (f" ({l['flag']})" if l['flag'] != 'N' else '') for l in first_set if l["name"] in key_names]
        icu_t = sh(icu_in.time.min()) if len(icu_in) else None
        first_v = ch.sort_values("ts").groupby("key").numeric_value.first() if len(ch) else pd.Series(dtype=float)
        vline = ", ".join(f"{lab} {first_v[k]:g}{u}" for k, lab, u in (("asbp", "SBP", ""), ("adbp", "DBP", ""), ("hr", "HR", ""), ("rr", "RR", ""), ("bt", "BT", "℃"), ("spo2", "SpO2", "%")) if k in first_v and pd.notna(first_v[k]))
        if not vline and len(first_v):
            vline = ", ".join(f"{lab} {first_v[k]:g}" for k, lab in (("sbp", "SBP"), ("dbp", "DBP")) if k in first_v)
        plan = []
        for c in dx_codes:
            q = KCD.get(c, (None, None))[1]
            if q:
                plan.append({"text": f"{c[:3]}.{c[3:]} {KCD[c][0].split(' (')[0]} — 관련 지침 근거 확인", "query": q})
        if syn["over"]:
            plan.insert(0, {"text": "체액과다 — 이뇨제(furosemide) 사용 지침 확인", "query": Q_LOOP})
        plan = plan[:4]
        note(d(sh(t_adm)), hm(sh(t_adm)), "입원", "입원", stay_id, f"입원 기록 (데이터 요약) — {route}", [
            {"title": "입원 경로", "body": f"{route}. 보험: {insurance}. 성별/나이: {sex_k} {age_label}." + (f" 응급실 체류 {int((ed_range[1] - ed_range[0]).total_seconds() // 60)}분." if ed_range else "")},
            {"title": "진단 (KCD-8)", "body": dx_lines},
            {"title": "중환자실 입실", "body": (f"{unit} 입실 {d(icu_t)} {hm(icu_t)}" if icu_t is not None else "입실 정보 없음") + "."},
            {"title": f"신체진찰·체액상태 ({SYN_TAG})", "body": exam + "\n" + fur_txt},
            {"title": "입실 후 첫 측정", "body": (("활력징후: " + vline + "\n") if vline else "") + ("검사: " + ", ".join(key_lines) if key_lines else "검사: 해당 시점 결과 없음")},
            {"title": "Plan (지침 확인 제안)", "body": "\n".join(p["text"] for p in plan) or "-"},
        ], plan)
        if has_ed:
            note(d(sh(reg.min())), hm(sh(reg.min())), "회신", "외래", f"{pid}-E01", "응급실 내원 기록 (데이터 요약)", [{"title": "응급실 체류", "body": f"등록 {hm(sh(reg.min()))} → 응급실 퇴실 {hm(sh(ed_range[1]))} ({int((ed_range[1] - ed_range[0]).total_seconds() // 60)}분). 이후 입원."}], dept="응급실")

        # 일별 경과 요약 + 간호기록
        io_in = g[g.code.str.startswith("INPUT_START//")].copy(); io_in["ts"] = io_in.time.map(sh)
        io_out = g[g.code.str.startswith("OUTPUT//")].copy(); io_out["ts"] = io_out.time.map(sh)
        days = sorted(set(ch.day) | set(l["date"] for l in labs if l["encounterId"] == stay_id) | set(io_in.ts.dt.strftime("%Y-%m-%d")) | set(io_out.ts.dt.strftime("%Y-%m-%d")))
        first_day = days[0] if days else d(sh(t_adm))
        for k, day in enumerate(days):
            gd = ch[ch.day == day]

            def rng_s(*keys, unit_=""):
                s = gd[gd.key.isin(keys)].numeric_value
                return f"{s.min():g}~{s.max():g}{unit_} (평균 {s.mean():.1f})" if len(s) else None
            vit = [("SBP", rng_s("asbp", "sbp")), ("DBP", rng_s("adbp", "dbp")), ("HR", rng_s("hr")), ("RR", rng_s("rr")), ("SpO2", rng_s("spo2", unit_="%")), ("BT", rng_s("bt", unit_="℃"))]
            vit_txt = "\n".join(f"{a}: {b}" for a, b in vit if b) or "해당 일자 활력징후 기록 없음"
            vent = [("FiO2", rng_s("fio2", unit_="%")), ("PEEP", rng_s("peep")), ("PIP", rng_s("pip"))]
            vent_txt = "\n".join(f"{a}: {b}" for a, b in vent if b)
            gcs = gd[gd.key.isin(["gcs_e", "gcs_v", "gcs_m"])]
            gcs_txt = ", ".join(f"{lab} {gd[gd.key == kk].numeric_value.mean():.1f}" for kk, lab in (("gcs_e", "E"), ("gcs_v", "V"), ("gcs_m", "M")) if len(gd[gd.key == kk])) if len(gcs) else ""
            dl = [l for l in labs if l["date"] == day and l["encounterId"] == stay_id]
            abn = [l for l in dl if l["flag"] != "N"]
            abn_txt = "\n".join(f"{l['name']} {l['value']:g} {l['unit']}".strip() + f" ({l['flag']}) — {l['datetime'][11:]}" for l in abn[:10]) + (f"\n… 외 {len(abn) - 10}건" if len(abn) > 10 else "")
            secs = [{"title": "활력징후 요약 (자동 집계)", "body": vit_txt}]
            if vent_txt:
                secs.append({"title": "인공호흡기/산소 설정", "body": vent_txt})
            if gcs_txt:
                secs.append({"title": "의식수준 (GCS 평균)", "body": gcs_txt})
            secs.append({"title": f"체중·이뇨제 ({SYN_TAG})", "body": f"체중 {syn['weights'].get(day, syn['w0'])}kg (추정 건체중 {syn['dry']}kg)" + (f"\nFurosemide {by_day[day][1]}mg {by_day[day][0]} {by_day[day][2]} ×{by_day[day][3]}회" if day in by_day else "\n이뇨제 투여 없음")})
            secs.append({"title": "검사", "body": f"{len(dl)}건 측정, 참고치 이탈 {len(abn)}건" + (("\n" + abn_txt) if abn_txt else "")})
            note(day, "23:30", "경과", "입원", stay_id, f"중환자실 일별 경과 요약 ({k + 1}일차, 자동 집계)", secs)
            # 간호: 섭취·배설·투약
            ii = io_in[io_in.ts.dt.strftime("%Y-%m-%d") == day]
            oo = io_out[io_out.ts.dt.strftime("%Y-%m-%d") == day]
            mm = med[med.ts.dt.strftime("%Y-%m-%d") == day]
            if len(ii) or len(oo) or len(mm):
                def sums(x):
                    if not len(x):
                        return "기록 없음"
                    return "\n".join(f"{str(desc.get(c, c)).split('>')[-1].strip()}: {x[x.code == c].numeric_value.sum():,.0f} cc ({len(x[x.code == c])}회)" for c in x.code.unique())
                note(day, "22:00", "간호", "입원", stay_id, f"간호기록 — 섭취·배설·투약 ({k + 1}일차, 자동 집계)", [
                    {"title": "섭취", "body": sums(ii)}, {"title": "배설", "body": sums(oo)},
                    {"title": "투약", "body": (f"{len(mm)}회 투여 기록 (약품코드 {len(mm.code.unique())}종)" if len(mm) else "투약 기록 없음") + (f"\nFurosemide {by_day[day][1]}mg {by_day[day][0]} {by_day[day][2]} ×{by_day[day][3]}회 ({SYN_TAG})" if day in by_day else "")},
                    {"title": "총 수액 균형(참고)", "body": f"섭취 {ii.numeric_value.sum():,.0f} cc / 배설 {oo.numeric_value.sum():,.0f} cc"},
                ], author=AUTHOR_NUR, dept="간호부")
        if len(dis):
            los = (t_end - t_adm).total_seconds() / 86400
            icu_los = ((icu_out.time.max() - icu_in.time.min()).total_seconds() / 3600) if len(icu_in) and len(icu_out) else None
            note(d(sh(t_end)), hm(sh(t_end)), "퇴원", "입원", stay_id, f"퇴원 요약 — {outcome}", [
                {"title": "입원 경과", "body": f"입원 {los:.1f}일" + (f", 중환자실({unit}) 재원 {icu_los:.1f}시간" if icu_los is not None else "") + f". 퇴원 형태: {outcome}."},
                {"title": "동반 진단", "body": ", ".join(KCD[c][0].split(' (')[-1].rstrip(')') for c in dx_codes[1:] if c in KCD) or "없음"},
            ] + ([{"title": "사망", "body": f"사망 시각 {d(sh(g[g.code == 'MEDS_DEATH'].time.min()))} {hm(sh(g[g.code == 'MEDS_DEATH'].time.min()))}"}] if died else []), dept=dept_icu)
        notes.sort(key=lambda n: (n["date"], n["time"]))

        # ---- 환자/문제목록 ----
        problems = [{"code": f"{c[:3]}.{c[3:]}", "name": KCD[c][0] if c in KCD else c, "since": d(sh(t_adm)), "active": True, "guidelineQuery": KCD.get(c, (None, None))[1]} for c in dx_codes]
        meds = ([{"name": "Furosemide", "dose": f"{syn['sched'][0][2]} mg", "sig": f"{syn['sched'][0][1]} {syn['sched'][0][3]}", "since": syn["sched"][0][0]}] if syn["sched"] else []) + [{"name": f"약품코드 {c.split('//')[1]}", "dose": "-", "sig": "-", "since": d(sh(med[med.code == c].time.min()))} for c in med.code.unique()]
        co_txt = ", ".join(KCD[c][0].split(" (")[-1].rstrip(")") for c in dx_codes[1:] if c in KCD)
        profile = f"{age_label if age_label != '연령 미상' else '성인'} {sex_k}, 심부전(I50.9)으로 입원하여 중환자실({unit}) 입실" + (f", 동반 진단: {co_txt}" if co_txt else "") + (f", 입원 시 체액과다(울혈, {syn['sev']}) 소견" if syn["over"] else ", 입원 시 정상체액")
        state = "사망" if died else {"귀가": "퇴원", "타병원 전원": "퇴원"}.get(outcome, "완료")
        patient = {"id": pid, "mrn": str(sid), "name": f"HF-{pid[2:]}", "sex": sex, "ageLabel": age_label, "ageYears": int(round(age)) if pd.notna(age) else 0, "birth": "", "heightCm": syn["height"], "weightKg": syn["w0"],
                   "bloodType": "-", "infection": [], "allergy": [], "dept": dept_icu, "attending": "-", "status": "입원", "ward": unit,
                   "queue": {"time": d(sh(t_adm))[5:].replace("-", "/"), "state": state}, "problems": problems, "meds": meds, "profile": profile, "group": "hf",
                   "outcome": outcome, "admitDate": d(sh(t_adm)),
                   "synthetic": {"fluidOverload": syn["over"], "severity": syn["sev"], "furosemide": bool(syn["sched"]), "note": "체액상태·furosemide·체중·NT-proBNP·흉부X선은 시연용 합성값"}}
        enc.sort(key=lambda e: (e["date"], e["id"]))
        bundle = {"patient": patient, "encounters": enc, "notes": notes, "orders": orders, "labs": labs, "vitals": vitals, "imaging": imaging}
        with open(os.path.join(OUT, f"{pid}.json"), "w", encoding="utf-8") as fh:
            json.dump(bundle, fh, ensure_ascii=False, separators=(",", ":"), default=clean)
        slim = dict(patient)
        slim["problems"] = []
        slim["meds"] = []
        slim["counts"] = {"notes": len(notes), "orders": len(orders), "labs": len(labs)}
        index.append(slim)

    index.sort(key=lambda p: p["id"])
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"source": "MEDS 심부전(KCD-8 I509) 코호트 + 체액상태·furosemide 시연용 합성", "count": len(index), "patients": index}, fh, ensure_ascii=False, separators=(",", ":"))
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"환자 {len(index)}명 → {OUT} ({size / 1e6:.1f} MB, 파일 {len(os.listdir(OUT))}개)")


if __name__ == "__main__":
    build()
