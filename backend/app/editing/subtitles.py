"""Импорт субтитров (SRT, VTT, ASS, TXT с метками, JSON) и пересчёт времени под новый монтаж."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .timeline import kept_ranges

MIN_PIECE_MS = 120  # осколки субтитра короче этого не показываем


@dataclass
class Cue:
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None = None

    def to_dict(self) -> dict:
        d = {"start_ms": self.start_ms, "end_ms": self.end_ms, "text": self.text}
        if self.speaker:
            d["speaker"] = self.speaker
        return d


# ---------- чтение ----------

_TS = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")


def _ts_to_ms(m: re.Match) -> int:
    h, mi, s, frac = int(m.group(1) or 0), int(m.group(2)), int(m.group(3)), m.group(4).ljust(3, "0")
    return ((h * 60 + mi) * 60 + s) * 1000 + int(frac)


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-16", "cp1251"):
        try:
            return raw.decode(enc)
        except UnicodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_srt_vtt(text: str) -> list[Cue]:
    cues: list[Cue] = []
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    for block in re.split(r"\n{2,}", text.strip()):
        lines = [ln for ln in block.split("\n")]
        for i, ln in enumerate(lines):
            if "-->" in ln:
                left, right = ln.split("-->", 1)
                ml, mr = _TS.search(left), _TS.search(right)
                if ml and mr:
                    body = "\n".join(lines[i + 1:]).strip()
                    body = re.sub(r"</?[a-zA-Z][^>]*>", "", body)
                    if body:
                        cues.append(Cue(_ts_to_ms(ml), _ts_to_ms(mr), body))
                break
    return cues


_ASS_T = re.compile(r"(\d+):(\d{2}):(\d{2})[.](\d{2})")


def parse_ass(text: str) -> list[Cue]:
    cues: list[Cue] = []
    fmt: list[str] | None = None
    for line in text.splitlines():
        line = line.strip()
        if line.lower().startswith("format:") and fmt is None:
            cand = [c.strip().lower() for c in line.split(":", 1)[1].split(",")]
            if "text" in cand and "start" in cand:
                fmt = cand
        elif line.lower().startswith("dialogue:") and fmt:
            parts = line.split(":", 1)[1].lstrip().split(",", len(fmt) - 1)
            if len(parts) < len(fmt):
                continue
            row = dict(zip(fmt, parts))
            ms, me = _ASS_T.match(row["start"].strip()), _ASS_T.match(row["end"].strip())
            if not (ms and me):
                continue

            def to_ms(m: re.Match) -> int:
                return ((int(m.group(1)) * 60 + int(m.group(2))) * 60 + int(m.group(3))) * 1000 + int(m.group(4)) * 10

            body = re.sub(r"\{[^}]*\}", "", row["text"]).replace("\\N", "\n").replace("\\n", "\n").strip()
            if body:
                cues.append(Cue(to_ms(ms), to_ms(me), body))
    return cues


_TXT_LINE = re.compile(r"^\s*\[?(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\]?\s*[-–]?\s*(.+)$")


def parse_txt(text: str) -> list[Cue]:
    """TXT поддерживается только со строками вида `[чч:мм:сс] текст`; конец реплики — начало следующей."""
    starts: list[tuple[int, str]] = []
    for line in text.splitlines():
        m = _TXT_LINE.match(line)
        if m:
            h, mi, s, frac, body = int(m.group(1) or 0), int(m.group(2)), int(m.group(3)), (m.group(4) or "0"), m.group(5)
            starts.append((((h * 60 + mi) * 60 + s) * 1000 + int(frac.ljust(3, "0")), body.strip()))
    if not starts:
        raise ValueError("В TXT нет временных меток (ожидаются строки вида [00:01:23] текст).")
    cues = []
    for i, (st, body) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else st + 3000
        cues.append(Cue(st, max(end, st + 1), body))
    return cues


def parse_json(text: str) -> list[Cue]:
    data = json.loads(text)
    items = data.get("segments") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise ValueError("JSON должен содержать список segments с start/end/text.")
    cues = []
    for it in items:
        start, end = float(it["start"]), float(it["end"])  # формат Whisp — секунды
        txt = str(it.get("text", "")).strip()
        spk = it.get("speaker")
        if txt and end > start:
            cues.append(Cue(round(start * 1000), round(end * 1000), txt, speaker=spk))
    return cues


def load_subtitles(path: Path) -> list[Cue]:
    text = _read_text(path)
    ext = path.suffix.lower()
    if ext in (".srt", ".vtt"):
        cues = parse_srt_vtt(text)
    elif ext in (".ass", ".ssa"):
        cues = parse_ass(text)
    elif ext == ".txt":
        cues = parse_txt(text)
    elif ext == ".json":
        cues = parse_json(text)
    else:
        raise ValueError(f"Неподдерживаемый формат субтитров: {ext}")
    if not cues:
        raise ValueError("В файле не найдено ни одной реплики.")
    return sorted(cues, key=lambda c: (c.start_ms, c.end_ms))


# ---------- пересчёт под монтаж ----------

def _split_text(text: str, shares: list[int]) -> list[str]:
    """Делит текст по словам пропорционально длительности кусков."""
    if len(shares) == 1:
        return [text]
    words = text.replace("\n", " ").split()
    total = sum(shares) or 1
    out, taken, acc = [], 0, 0
    for i, share in enumerate(shares):
        acc += share
        upto = len(words) if i == len(shares) - 1 else round(len(words) * acc / total)
        out.append(" ".join(words[taken:upto]))
        taken = upto
    return out


def remap_cues(cues: list[Cue], plan: dict) -> list[Cue]:
    """Переносит реплики на время нового видео. Реплика, пересекающая вырезанный участок, обрезается;
    если сохранённых кусков несколько — делится, а слова распределяются пропорционально времени."""
    ranges = kept_ranges(plan)
    # накопленное смещение нового времени для каждого интервала
    offsets, acc = [], 0
    for a, b in ranges:
        offsets.append(acc)
        acc += b - a

    result: list[Cue] = []
    for cue in cues:
        pieces: list[tuple[int, int]] = []  # (new_start, new_end) для каждого куска
        for (a, b), off in zip(ranges, offsets):
            lo, hi = max(cue.start_ms, a), min(cue.end_ms, b)
            if hi > lo:
                pieces.append((off + lo - a, off + hi - a))
        if not pieces:
            continue
        # Сливаем куски, которые в новом видео оказались вплотную (склейка).
        merged: list[list[int]] = []
        for s, e in pieces:
            if merged and s <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        if len(merged) == 1:
            s, e = merged[0]
            if e - s >= MIN_PIECE_MS or (cue.end_ms - cue.start_ms) < MIN_PIECE_MS:
                result.append(Cue(s, e, cue.text, speaker=cue.speaker))
            continue
        texts = _split_text(cue.text, [e - s for s, e in merged])
        for (s, e), txt in zip(merged, texts):
            if txt.strip() and e - s >= MIN_PIECE_MS:
                result.append(Cue(s, e, txt, speaker=cue.speaker))
    # Не допускаем наложения из-за склеек и округлений.
    result.sort(key=lambda c: (c.start_ms, c.end_ms))
    for prev, nxt in zip(result, result[1:]):
        if prev.end_ms > nxt.start_ms:
            prev.end_ms = max(prev.start_ms + 1, nxt.start_ms)
    return result


# ---------- запись ----------

def _fmt(ms: int, sep: str) -> str:
    h, rem = divmod(max(0, ms), 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, milli = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{milli:03d}"


def render_srt(cues: list[Cue]) -> str:
    return "".join(f"{i}\n{_fmt(c.start_ms, ',')} --> {_fmt(c.end_ms, ',')}\n{c.text}\n\n" for i, c in enumerate(cues, 1))


def render_vtt(cues: list[Cue]) -> str:
    body = "".join(f"{_fmt(c.start_ms, '.')} --> {_fmt(c.end_ms, '.')}\n{c.text}\n\n" for c in cues)
    return "WEBVTT\n\n" + body


def render_bilingual_srt(cues_orig: list[Cue], cues_trans: list[Cue]) -> str:
    """Генерирует двуязычный SRT: оригинальный текст + строка перевода снизу."""
    out = []
    # Если количество совпадает, сопоставляем 1-в-1
    if len(cues_orig) == len(cues_trans):
        for i, (co, ct) in enumerate(zip(cues_orig, cues_trans), 1):
            text = f"{co.text}\n{ct.text}" if ct.text else co.text
            out.append(f"{i}\n{_fmt(co.start_ms, ',')} --> {_fmt(co.end_ms, ',')}\n{text}\n\n")
        return "".join(out)

    # Иначе сопоставляем по пересечению интервалов времени
    for i, co in enumerate(cues_orig, 1):
        matching = [ct for ct in cues_trans if max(co.start_ms, ct.start_ms) < min(co.end_ms, ct.end_ms)]
        trans_text = " / ".join(ct.text for ct in matching if ct.text)
        text = f"{co.text}\n{trans_text}" if trans_text else co.text
        out.append(f"{i}\n{_fmt(co.start_ms, ',')} --> {_fmt(co.end_ms, ',')}\n{text}\n\n")
    return "".join(out)


def render_transcript(cues: list[Cue]) -> str:
    """Текстовая расшифровка с таймкодами для чтения."""
    return "\n".join(f"[{_fmt(c.start_ms, '.')[:8]}] {c.text}" for c in cues) + "\n"



def _ass_time(ms: int) -> str:
    h, rem = divmod(max(0, ms), 3_600_000)
    m, rem = divmod(rem, 60_000)
    return f"{h}:{m:02d}:{rem // 1000:02d}.{(rem % 1000) // 10:02d}"


def _ass_colour(hex_rgb: str, alpha: int = 0) -> str:
    h = hex_rgb.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def render_ass(cues: list[Cue], style: dict | None = None, width: int = 1920, height: int = 1080,
               word_highlight: bool = False, highlight_color: str = "#FFEA00") -> str:
    st = {"font": "Arial", "size": 64, "colour": "#FFFFFF", "outline_colour": "#000000", "outline": 3,
          "margin_v": 50, "alignment": 2, "bold": 0, "shadow": 1, **(style or {})}
    bold_flag = 1 if st.get("bold") else 0
    shadow_val = st.get("shadow", 1)
    base_col = _ass_colour(st['colour'])
    hl_col = _ass_colour(highlight_color)
    # Размер шрифта задан для 1080p — масштабируется через PlayRes.
    header = (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding\n"
        f"Style: Default,{st['font']},{st['size']},{base_col},&H000000FF,"
        f"{_ass_colour(st['outline_colour'])},&H64000000,{bold_flag},0,0,0,100,100,0,0,1,{st['outline']},{shadow_val},"
        f"{st['alignment']},60,60,{st['margin_v']},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines = []
    for c in cues:
        raw_words = c.text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").split()
        dur = c.end_ms - c.start_ms
        if not word_highlight or len(raw_words) <= 1 or dur <= 100:
            txt = c.text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", "\\N")
            lines.append(f"Dialogue: 0,{_ass_time(c.start_ms)},{_ass_time(c.end_ms)},Default,,0,0,0,,{txt}")
        else:
            n = len(raw_words)
            dur_per_word = dur / n
            for i in range(n):
                t_start = c.start_ms + round(i * dur_per_word)
                t_end = c.start_ms + round((i + 1) * dur_per_word) if i < n - 1 else c.end_ms
                word_parts = []
                for j, w in enumerate(raw_words):
                    if j == i:
                        word_parts.append(f"{{\\c{hl_col}&}}{w}{{\\c{base_col}&}}")
                    else:
                        word_parts.append(w)
                line_txt = " ".join(word_parts)
                lines.append(f"Dialogue: 0,{_ass_time(t_start)},{_ass_time(t_end)},Default,,0,0,0,,{line_txt}")
    return header + "\n".join(lines) + "\n"
