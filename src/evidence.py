"""답변이 실제로 근거로 삼은 '결정적 문장'(표는 행)을 고른다.

답변의 각 주장(인용 [n]이 붙은 문장/표 행)을 인용된 발췌문의 문장 단위와 Reranker 점수로 맞춰 보고,
주장마다 가장 잘 맞는 문장을 뽑는다. 모델은 점수 함수(score_fn)로 주입받아 단독 테스트할 수 있다.
"""
import re

import numpy as np

SEP_ROW = re.compile(r"^\|(\s*:?-{3,}:?\s*\|)+\s*$")
ABBR = re.compile(r"(?:\bet al|\bvs|\be\.g|\bi\.e|\bFigs?|\bNos?|\bDr|\bapprox|\bca)\.$", re.I)
# 문장 경계: 마침표 뒤(각주 번호 "37–40" 가 붙을 수 있음) 공백, 또는 줄바꿈
BOUNDARY = re.compile(r"(?<=[.?!])(?P<fn>\d+(?:[–,\-]\d+)*)?(?P<ws>[ \t]+)(?=\S)|(?P<nl>\n+)")
MIN_UNIT = 25  # 이보다 짧은 조각은 이웃 문장에 붙인다
CITE_ONLY = re.compile(r"^(?:\s*\[\d+\])+\s*[.。]?\s*$")


def split_units(text: str, kind: str) -> list[tuple[int, int]]:
    """발췌문을 (시작, 끝) 문자 오프셋 단위로 나눈다. 본문은 문장, 표는 행(0번=머리글 행)."""
    if kind == "table":
        # 0번 단위 = 머리글 행, 1번부터 본문 행. 머리글이 따로 없는 표는 첫 데이터 행이 머리글이 되므로 후보에 포함한다.
        units, pos = [], 0
        for ln in text.split("\n"):
            if ln.startswith("|") and not SEP_ROW.match(ln):
                units.append((pos, pos + len(ln)))
            pos += len(ln) + 1
        return units

    units, start = [], 0
    for m in BOUNDARY.finditer(text):
        if m.group("ws") is not None:
            if ABBR.search(text[max(0, m.start() - 10):m.start()]):
                continue
            end = m.start() + len(m.group("fn") or "")
        else:
            end = m.start()
        if text[start:end].strip():
            units.append((start, end))
        start = m.end()
    if text[start:].strip():
        units.append((start, len(text)))

    merged = []
    for u in units:
        if merged and merged[-1][1] - merged[-1][0] < MIN_UNIT:
            merged[-1] = (merged[-1][0], u[1])
        else:
            merged.append(u)
    if len(merged) > 1 and merged[-1][1] - merged[-1][0] < MIN_UNIT:
        last = merged.pop()
        merged[-1] = (merged[-1][0], last[1])
    return merged


def answer_claims(answer: str) -> list[tuple[str, list[int]]]:
    """답변 -> [(주장 텍스트, 인용 번호들)]. 표 행은 행 하나가 주장 하나.

    인용은 문장 안("…한다[1].")에도, 문장 뒤("…한다. [1] 다음 문장")에도 붙을 수 있다.
    번호 없이 끝난 문장은 바로 뒤에 인용만 떨어져 나온 경우에 한해 그 번호를 받는다."""
    claims: list[tuple[str, list[int]]] = []
    for line in answer.split("\n"):
        if not line.strip() or SEP_ROW.match(line.strip()):
            continue
        parts = [" ".join(c.strip() for c in line.strip().strip("|").split("|"))] if line.lstrip().startswith("|") \
            else re.split(r"(?<=\])\s+|(?<=[.!?。])\s+", line)
        pending = None  # 인용 없이 끝난 직전 문장
        for part in parts:
            nums = [int(x) for x in re.findall(r"\[(\d+)\]", part)]
            if CITE_ONLY.match(part):
                if pending is not None:
                    claims.append((pending, nums))
                elif claims:
                    claims[-1][1].extend(nums)
                pending = None
                continue
            text = re.sub(r"\s+", " ", re.sub(r"\[\d+\]|\*\*", "", part)).strip(" -•*:")
            if nums and len(text) >= 8:
                claims.append((text, nums))
                pending = None
            else:
                pending = text if len(text) >= 8 else None
    return claims


def u16(text: str, i: int) -> int:
    """파이썬 문자 오프셋 -> JS(UTF-16) 오프셋."""
    return len(text[:i].encode("utf-16-le")) // 2


def select_evidence(answer: str, passages: list[dict], cited: list[int], score_fn) -> dict:
    """인용된 발췌문마다 결정적 문장(표는 행)을 고른다. 주장마다 가장 잘 맞는 문장 1개의 합집합.

    score_fn(pairs) 는 (주장, 문장) 쌍의 점수를 돌려준다. sigmoid 로 포화된 값이 아니라 logit 을 줘야
    비슷하게 관련 있는 문장들끼리 순위가 구분된다.
    반환: {n: {"kind", "units": [단위 인덱스...], "spans": [[시작, 끝]...] (본문만, UTF-16 오프셋)}}
    """
    claims = answer_claims(answer)
    marks = {}
    for n in cited:
        if not 1 <= n <= len(passages):
            continue
        p = passages[n - 1]
        units = split_units(p["text"], p["kind"])
        mine = [c for c, ns in claims if n in ns]
        if not units or not mine:
            continue
        pairs = [(c, p["text"][a:b]) for c in mine for a, b in units]
        sc = np.asarray(score_fn(pairs), dtype=float).reshape(len(mine), len(units))
        idx = sorted({int(row.argmax()) for row in sc})[: 8 if p["kind"] == "table" else 4]
        m = {"kind": p["kind"], "units": idx}
        if p["kind"] != "table":
            m["spans"] = [[u16(p["text"], units[j][0]), u16(p["text"], units[j][1])] for j in idx]
        marks[n] = m
    return marks
