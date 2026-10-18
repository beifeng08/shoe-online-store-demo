#!/usr/bin/env python3
"""零依赖 AI Slop 扫描器（Python 侧）：只用标准库 ast，不需要 venv 或任何第三方包。

用法：
    node scripts/py.mjs ../scripts/check-slop-python.py          # 人读输出
    node scripts/py.mjs ../scripts/check-slop-python.py --json    # 机器可读
    python3 scripts/check-slop-python.py --self-test              # 跑内置回归自检

与 TypeScript 侧的 scripts/check-slop.mjs 是同一套判据思路，但**严重度分配不同**，
原因是这一侧的候选几乎都需要人判断：

  · unused-import     阻塞。人工审计中实测 0 命中，判据可靠。
  · dead-definition   提示。已排除 SQLAlchemy 声明式模型（由 Base.metadata 与
                      Alembic 迁移消费，类名不出现在代码里）。
  · print-in-library  提示。CLI 入口模块的 print 是正常输出，必须排除。

**刻意不实现 silent-except。** 本项目实测 3 个 `except ...: pass` 全部合法：
expiry.py 的两个分别保护其后的脱敏 raise 与 worker 的正常停止条件，main.py 的是
UUID 解析失败的 fail-safe 回退。「保护关键信号的 except」与「吞掉错误的 except」
字节级同形，例外不可表达——判据假阳性率 100% 就不该留在产物里。这类判断属于 G 类，
只能由人读上下文（是否紧邻脱敏 raise、是否窄异常类型且有回退）决定。

内置自检锁住的是本项目人工审计期间出现过的假阳性：装饰器注册的路由被当成死代码、
SQLAlchemy 模型被当成死代码、CLI 模块的 print 被当成调试残留、
仅用于类型注解的 import 被当成未使用。
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys
from collections import defaultdict

# 目录名与 TypeScript 侧保持一致：生成物、依赖、虚拟环境都不扫。
SKIP_DIRS = {"__pycache__", ".venv", "venv", ".git", "node_modules"}
RULES = {
    "unused-import": {"blocking": True, "summary": "导入了但未使用"},
    "dead-definition": {"blocking": False, "summary": "模块级定义没有任何引用"},
    "print-in-library": {"blocking": False, "summary": "库模块里残留的 print"},
}
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def collect_python_files(root: str) -> list[str]:
    collected: list[str] = []
    for current, directories, files in os.walk(root):
        directories[:] = [d for d in directories if d not in SKIP_DIRS]
        for name in sorted(files):
            if name.endswith(".py"):
                collected.append(os.path.join(current, name))
    return sorted(collected)


def _imported_names(tree: ast.AST) -> dict[str, int]:
    """收集 import 引入的本地名 → 行号。"""
    imported: dict[str, int] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported[(alias.asname or alias.name).split(".")[0]] = node.lineno
        elif isinstance(node, ast.ImportFrom):
            if node.module == "__future__":
                continue
            for alias in node.names:
                if alias.name != "*":
                    imported[alias.asname or alias.name] = node.lineno
    return imported


def analyze_source(file_name: str, text: str, all_text: str, is_test: bool) -> list[dict]:
    """分析单个 Python 源文件。纯函数：只看传入的文本，不读磁盘。"""
    findings: list[dict] = []
    try:
        tree = ast.parse(text, filename=file_name)
    except SyntaxError as error:
        return [
            {
                "rule": "unused-import",
                "file": file_name,
                "line": error.lineno or 1,
                "message": f"无法解析：{error.msg}",
            }
        ]

    lines = text.split("\n")
    is_cli = "__main__" in text

    # import 使用检查：把 import 行本身排除，否则 import 语句自己会命中。
    body = "\n".join(line for line in lines if not re.match(r"\s*(from|import)\s", line))
    for name, line_number in _imported_names(tree).items():
        if is_test:
            continue
        if not re.search(r"\b" + re.escape(name) + r"\b", body):
            findings.append(
                {
                    "rule": "unused-import",
                    "file": file_name,
                    "line": line_number,
                    "symbol": name,
                    "message": f"import {name} 在该文件中没有使用",
                }
            )

    if not is_cli and not is_test:
        for index, line in enumerate(lines, 1):
            if re.match(r"\s*print\(", line):
                findings.append(
                    {
                        "rule": "print-in-library",
                        "file": file_name,
                        "line": index,
                        "message": line.strip()[:100],
                    }
                )

    return findings


def find_dead_definitions(
    files: list[str], sources: dict[str, str], all_text: str
) -> list[dict]:
    """模块级定义的死代码判定。

    排除两类：带装饰器的定义（FastAPI 路由、异常处理器、ORM 注册由框架消费），
    以及名称在仓库任意位置以字符串形式出现的定义（反射/映射表/迁移引用）。
    """
    identifier_files: dict[str, set[str]] = defaultdict(set)
    for file_name in files:
        for name in set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", sources[file_name])):
            identifier_files[name].add(file_name)

    findings: list[dict] = []
    for file_name in files:
        if "/tests/" in file_name or os.sep + "tests" + os.sep in file_name:
            continue
        try:
            tree = ast.parse(sources[file_name], filename=file_name)
        except SyntaxError:
            continue
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            if node.name.startswith("_") or getattr(node, "decorator_list", []):
                continue
            # SQLAlchemy 声明式模型由 Base.metadata 与 Alembic 迁移消费，类名不会
            # 出现在 Python 代码里（迁移引用的是表名）。backend/app/domain/models.py
            # 的 WebhookEvent 就是这种情况：删掉它 alembic check 会要求 drop 表。
            if isinstance(node, ast.ClassDef) and any(
                isinstance(base, ast.Name) and base.id.endswith("Base") for base in node.bases
            ):
                continue
            others = identifier_files[node.name] - {file_name}
            local_uses = len(re.findall(r"\b" + re.escape(node.name) + r"\b", sources[file_name]))
            string_referenced = f"'{node.name}'" in all_text or f'"{node.name}"' in all_text
            if not others and local_uses <= 1 and not string_referenced:
                findings.append(
                    {
                        "rule": "dead-definition",
                        "file": file_name,
                        "line": node.lineno,
                        "symbol": node.name,
                        "message": f"{type(node).__name__} {node.name} 没有任何引用",
                    }
                )
    return findings


def analyze_project(root: str = REPO_ROOT) -> list[dict]:
    backend = os.path.join(root, "backend")
    files = collect_python_files(backend) if os.path.isdir(backend) else []
    sources = {}
    unreadable: list[dict] = []
    for absolute in files:
        # 读不到就显式报阻塞项：静默跳过会让扫描结果看起来比实际更干净。
        try:
            with open(absolute, encoding="utf8", errors="replace") as handle:
                sources[absolute] = handle.read()
        except OSError as error:
            unreadable.append(
                {
                    "rule": "unused-import",
                    "file": os.path.relpath(absolute, root),
                    "line": 1,
                    "message": f"无法读取，扫描结果不完整：{error.strerror or error}",
                }
            )
    all_text = "\n".join(sources.values())
    relative = {absolute: os.path.relpath(absolute, root) for absolute in sources}
    rel_sources = {relative[absolute]: text for absolute, text in sources.items()}

    findings: list[dict] = list(unreadable)
    for absolute in files:
        findings.extend(
            analyze_source(
                relative[absolute],
                sources[absolute],
                all_text,
                is_test="/tests/" in relative[absolute].replace(os.sep, "/"),
            )
        )
    findings.extend(find_dead_definitions(sorted(rel_sources), rel_sources, all_text))

    order = list(RULES)
    findings.sort(key=lambda item: (order.index(item["rule"]), item["file"], item["line"]))
    return findings


def self_test() -> int:
    """内置回归自检：锁住人工审计期间出现过的假阳性。"""
    failures: list[str] = []

    def check(label: str, condition: bool) -> None:
        if not condition:
            failures.append(label)

    def rules_for(text: str, is_test: bool = False) -> list[str]:
        return [
            item["rule"]
            for item in analyze_source("backend/app/sample.py", text, text, is_test)
        ]

    # 装饰器注册的路由不是死代码（FastAPI 用装饰器消费，不按名字引用）
    decorated = "class R:\n    pass\n\nr = R()\n\n@r.get('/x')\ndef list_items():\n    return []\n"
    dead = find_dead_definitions(["backend/app/routes.py"], {"backend/app/routes.py": decorated}, decorated)
    check("带装饰器的定义不应被报死代码", all(item["symbol"] != "list_items" for item in dead))

    # 无引用、无装饰器、无字符串引用的模块级定义应被报出
    orphan = "def never_called():\n    return 1\n"
    dead = find_dead_definitions(["backend/app/x.py"], {"backend/app/x.py": orphan}, orphan)
    check("无引用的定义应被报出", any(item["symbol"] == "never_called" for item in dead))

    # 被字符串引用的定义不报（反射 / 映射表 / 迁移）
    linked = "class Row:\n    pass\n\nTABLE = 'Row'\n"
    dead = find_dead_definitions(["backend/app/y.py"], {"backend/app/y.py": linked}, linked)
    check("被字符串引用的定义不应被报出", all(item["symbol"] != "Row" for item in dead))

    # CLI 入口模块的 print 是正常输出
    cli = 'if __name__ == "__main__":\n    print("done")\n'
    check("CLI 模块的 print 不应被报出", "print-in-library" not in rules_for(cli))

    # 库模块里的 print 才是残留
    check("库模块的 print 应被报出", "print-in-library" in rules_for("def f():\n    print('debug')\n"))

    # SQLAlchemy 声明式模型由 Base.metadata / Alembic 迁移消费，类名不出现在代码里
    model = "from sqlalchemy.orm import DeclarativeBase\n\n\nclass Base(DeclarativeBase):\n    pass\n\n\nclass WebhookEvent(Base):\n    __tablename__ = 'webhook_events'\n"
    dead = find_dead_definitions(["backend/app/domain/models.py"], {"backend/app/domain/models.py": model}, model)
    check("SQLAlchemy 模型不应被报死代码", all(item["symbol"] != "WebhookEvent" for item in dead))

    # 仅用于类型注解的 import 是已使用的
    annotated = "import collections\n\n\ndef f() -> collections.OrderedDict:\n    return None\n"
    check("用于注解的 import 不应被报出", "unused-import" not in rules_for(annotated))

    # 未使用的 import 才是残留
    check("未使用的 import 应被报出", "unused-import" in rules_for("import json\n\n\ndef f():\n    return 1\n"))

    for label in failures:
        print(f"self-test 失败: {label}", file=sys.stderr)
    if failures:
        return 1
    print("check-slop-python: 自检通过（7 项假阳性回归用例）")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="零依赖 AI Slop 扫描器（Python 侧）")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    parser.add_argument("--self-test", action="store_true", help="只跑内置回归自检")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    findings = analyze_project()
    blocking = [item for item in findings if RULES[item["rule"]]["blocking"]]
    advisory = [item for item in findings if not RULES[item["rule"]]["blocking"]]

    if args.json:
        print(json.dumps({"blocking": blocking, "advisory": advisory, "rules": RULES}, ensure_ascii=False, indent=1))
        return 1 if blocking else 0

    def report(label: str, items: list[dict]) -> None:
        if not items:
            return
        print(f"\n{label}（{len(items)}）")
        for item in items:
            symbol = f" :: {item['symbol']}" if item.get("symbol") else ""
            print(f"  {item['file']}:{item['line']}{symbol}  [{item['rule']}] {item['message']}")

    report("阻塞项", blocking)
    report("提示项（需要人判断，不影响退出码）", advisory)
    if not findings:
        print("check:slop:python: 机械判据未发现 slop。")
    else:
        print(f"\ncheck:slop:python: {len(blocking)} 项阻塞 / {len(advisory)} 项提示。")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
