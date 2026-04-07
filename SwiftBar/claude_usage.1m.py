#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# <swiftbar.title>Claude Token Usage</swiftbar.title>
# <swiftbar.version>1.0</swiftbar.version>
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>

import json
import glob
from pathlib import Path
from datetime import datetime, timezone

def load_today_usage():
    base = Path.home() / ".claude" / "projects"
    files = glob.glob(str(base / "**" / "*.jsonl"), recursive=True)

    now = datetime.now(timezone.utc)
    today = now.date()

    input_tokens = 0
    output_tokens = 0
    cache_read = 0
    cache_write = 0
    session_tokens = 0
    session_start = None

    # 세션 감지용 (최근 5시간 - Claude Pro 리셋 주기)
    recent_threshold = now.timestamp() - 5 * 3600

    for f in files:
        try:
            with open(f, encoding="utf-8") as fp:
                for line in fp:
                    try:
                        d = json.loads(line)
                        ts_raw = d.get("timestamp")
                        if not ts_raw:
                            continue

                        # 타임스탬프 파싱
                        if isinstance(ts_raw, str):
                            ts_raw = ts_raw.replace("Z", "+00:00")
                            dt = datetime.fromisoformat(ts_raw)
                        else:
                            dt = datetime.fromtimestamp(ts_raw, tz=timezone.utc)

                        if dt.date() != today:
                            continue

                        usage = d.get("message", {}).get("usage")
                        if not usage:
                            continue

                        inp = usage.get("input_tokens", 0)
                        out = usage.get("output_tokens", 0)
                        cr = usage.get("cache_read_input_tokens", 0)
                        cw = usage.get("cache_creation_input_tokens", 0)

                        input_tokens += inp
                        output_tokens += out
                        cache_read += cr
                        cache_write += cw

                        # 현재 세션 (최근 1시간)
                        if dt.timestamp() >= recent_threshold:
                            session_tokens += inp + out
                            if session_start is None or dt < session_start:
                                session_start = dt

                    except Exception:
                        continue
        except Exception:
            continue

    return {
        "input": input_tokens,
        "output": output_tokens,
        "cache_read": cache_read,
        "cache_write": cache_write,
        "total": input_tokens + output_tokens,
        "session": session_tokens,
    }

def format_num(n):
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}K"
    return str(n)

def main():
    data = load_today_usage()
    total = data["total"]
    session = data["session"]

    # Pro 플랜 5시간 세션 한도: ~88,000 토큰
    LIMIT = 88_000
    session_pct = min(int(session / LIMIT * 100), 100)

    # 퍼센트에 따라 색상 변경 (현재 세션 기준)
    if session_pct >= 80:
        color = "#f87171"  # 빨강
    elif session_pct >= 50:
        color = "#fbbf24"  # 노랑
    else:
        color = "#a78bfa"  # 보라

    # 메뉴바 표시 (현재 세션 기준)
    print(f"◆ {format_num(session)} ({session_pct}%) | size=13 color={color}")
    print("---")
    print(f"현재 세션 (5시간) | size=12 color=#888888")
    print(f"입력: {format_num(data['input'])}  출력: {format_num(data['output'])} | size=12")
    print(f"캐시 읽기: {format_num(data['cache_read'])}  캐시 쓰기: {format_num(data['cache_write'])} | size=12 color=#888888")
    print("---")
    total_pct = min(int(total / LIMIT * 100), 100)
    print(f"오늘 누적: {format_num(total)} tokens ({total_pct}%) | size=12 color=#60a5fa")
    print("---")
    now_str = datetime.now().strftime("%H:%M 기준")
    print(f"{now_str} | size=11 color=#555555")

if __name__ == "__main__":
    main()
