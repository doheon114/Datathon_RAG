"""MEDS 데이터 탐색기.

실행:
    uv run --with streamlit --with pandas --with pyarrow --with plotly streamlit run explorer.py
"""
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

DATA_DIR = Path(__file__).parent
SPLIT_FILES = {"training": "training.parquet", "tuning": "tuning.parquet", "held": "held.parquet"}

st.set_page_config(page_title="MEDS Explorer", layout="wide")


@st.cache_data
def load_codes() -> pd.DataFrame:
    codes = pd.read_parquet(DATA_DIR / "codes.parquet")
    codes["parent_codes"] = codes["parent_codes"].apply(
        lambda v: ", ".join(v) if v is not None and len(v) else ""
    )
    return codes


@st.cache_data
def load_splits() -> pd.DataFrame:
    return pd.read_parquet(DATA_DIR / "subject_splits.parquet")


@st.cache_data
def load_events(names: tuple[str, ...]) -> pd.DataFrame:
    frames = []
    for name in names:
        df = pd.read_parquet(DATA_DIR / SPLIT_FILES[name])
        df["split"] = name
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    df["category"] = df["code"].str.split("//").str[0]
    desc = load_codes().set_index("code")["description"]
    df["description"] = df["code"].map(desc)
    return df


codes = load_codes()
splits = load_splits()

st.sidebar.title("MEDS Explorer")
chosen = st.sidebar.multiselect("데이터셋", list(SPLIT_FILES), default=["training"])
if not chosen:
    st.warning("데이터셋을 하나 이상 선택하세요.")
    st.stop()
events = load_events(tuple(chosen))
st.sidebar.caption(f"{len(events):,} events · {events.subject_id.nunique():,} subjects")

tab_overview, tab_codes, tab_patient, tab_raw = st.tabs(["개요", "코드", "환자", "원본 테이블"])

# ---------------------------------------------------------------- 개요
with tab_overview:
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("이벤트", f"{len(events):,}")
    c2.metric("환자", f"{events.subject_id.nunique():,}")
    c3.metric("코드 종류", f"{events.code.nunique():,}")
    c4.metric("사망 (MEDS_DEATH)", f"{(events.code == 'MEDS_DEATH').sum():,}")

    left, right = st.columns(2)
    with left:
        st.subheader("카테고리별 이벤트 수")
        cat = events["category"].value_counts().rename_axis("category").reset_index(name="count")
        st.plotly_chart(
            px.bar(cat, x="count", y="category", orientation="h").update_yaxes(autorange="reversed"),
            width="stretch",
        )
    with right:
        st.subheader("Split 구성 (subject_splits)")
        st.dataframe(splits["split"].value_counts().rename("subjects"), width="stretch")
        st.subheader("환자당 이벤트 수")
        per_subj = events.groupby("subject_id").size().rename("events").reset_index()
        st.plotly_chart(px.histogram(per_subj, x="events", nbins=50), width="stretch")

    st.subheader("인구통계")
    d1, d2, d3 = st.columns(3)
    for col, prefix in zip((d1, d2, d3), ("GENDER", "MARITAL_STATUS", "INSURANCE")):
        vc = events.loc[events.category == prefix, "code"].str.split("//").str[1].value_counts()
        col.markdown(f"**{prefix}**")
        col.dataframe(vc, width="stretch")

# ---------------------------------------------------------------- 코드
with tab_codes:
    stats = (
        events.groupby("code")
        .agg(
            events=("code", "size"),
            subjects=("subject_id", "nunique"),
            numeric_n=("numeric_value", "count"),
            mean=("numeric_value", "mean"),
            median=("numeric_value", "median"),
            min=("numeric_value", "min"),
            max=("numeric_value", "max"),
        )
        .reset_index()
        .merge(codes, on="code", how="left")
    )
    stats["category"] = stats["code"].str.split("//").str[0]

    f1, f2 = st.columns([1, 2])
    cats = f1.multiselect("카테고리", sorted(stats.category.unique()))
    query = f2.text_input("코드/설명 검색", placeholder="예: SBP, LAB, 산소포화도")
    view = stats
    if cats:
        view = view[view.category.isin(cats)]
    if query:
        mask = view.code.str.contains(query, case=False, regex=False) | view.description.fillna("").str.contains(
            query, case=False, regex=False
        )
        view = view[mask]
    cols = ["code", "description", "category", "events", "subjects", "numeric_n", "mean", "median", "min", "max", "parent_codes"]
    st.dataframe(view[cols].sort_values("events", ascending=False), width="stretch", hide_index=True, height=400)

    numeric_codes = view.loc[view.numeric_n > 0, "code"].tolist()
    if numeric_codes:
        code = st.selectbox("수치 분포 보기", numeric_codes)
        vals = events.loc[events.code == code, "numeric_value"].dropna()
        lo, hi = vals.quantile([0.005, 0.995])
        clip = st.checkbox("상하위 0.5% 제외", value=True)
        shown = vals[(vals >= lo) & (vals <= hi)] if clip else vals
        st.plotly_chart(px.histogram(shown, nbins=80, labels={"value": code}), width="stretch")

# ---------------------------------------------------------------- 환자
with tab_patient:
    subjects = sorted(events.subject_id.unique())
    sid = st.selectbox("subject_id", subjects)
    pe = events[events.subject_id == sid].sort_values("time", na_position="first")

    static = pe[pe.time.isna()].code.tolist()
    birth = pe.loc[pe.code == "MEDS_BIRTH", "time"].min()
    death = pe.loc[pe.code == "MEDS_DEATH", "time"].min()
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("이벤트", f"{len(pe):,}")
    m2.metric("정적 정보", ", ".join(static) or "-")
    m3.metric("출생", str(birth.date()) if pd.notna(birth) else "-")
    m4.metric("사망", str(death) if pd.notna(death) else "-")

    admits = pe[pe.category.isin(["HOSPITAL_ADMISSION", "ICU_ADMISSION", "ICU_DISCHARGE", "HOSPITAL_DISCHARGE", "ED_REGISTRATION", "ED_OUT"])]
    st.markdown("**입퇴원 타임라인**")
    st.dataframe(admits[["time", "code"]], hide_index=True, width="stretch")

    num = pe.dropna(subset=["numeric_value", "time"])
    if not num.empty:
        top = num.code.value_counts().index.tolist()
        picks = st.multiselect(
            "시계열로 볼 수치 코드",
            top,
            default=top[:3],
            format_func=lambda c: f"{c}  ({codes.set_index('code').description.get(c, '') or ''})",
        )
        if picks:
            fig = px.line(
                num[num.code.isin(picks)], x="time", y="numeric_value", color="code", markers=True,
                hover_data=["description"],
            )
            fig.update_layout(legend=dict(orientation="h", y=-0.2))
            st.plotly_chart(fig, width="stretch")

    st.markdown("**전체 이벤트**")
    pcats = st.multiselect("카테고리 필터", sorted(pe.category.unique()), key="pcats")
    shown = pe[pe.category.isin(pcats)] if pcats else pe
    st.dataframe(
        shown[["time", "code", "description", "numeric_value"]], hide_index=True, width="stretch", height=500
    )

# ---------------------------------------------------------------- 원본
with tab_raw:
    st.caption("최대 50,000행까지 표시합니다. 필터로 범위를 좁혀 보세요.")
    r1, r2 = st.columns(2)
    rcats = r1.multiselect("카테고리", sorted(events.category.unique()), key="rcats")
    rq = r2.text_input("코드 포함 문자열", key="rq")
    raw = events
    if rcats:
        raw = raw[raw.category.isin(rcats)]
    if rq:
        raw = raw[raw.code.str.contains(rq, case=False, regex=False)]
    st.write(f"{len(raw):,} rows")
    st.dataframe(raw.head(50_000), hide_index=True, width="stretch", height=600)
    st.download_button("필터 결과 CSV 다운로드", raw.to_csv(index=False).encode("utf-8-sig"), "filtered.csv")
