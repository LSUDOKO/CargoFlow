# Parses every block of the Dune queries with sqlglot (Trino dialect, which DuneSQL is based on).
# Usage: python check/parse.py *.sql
import re, sys, sqlglot
from sqlglot import exp
ok = True
for path in sys.argv[1:]:
    src = open(path).read().replace('{{team}}', 'team_param')
    # strip comments, split on statement terminators
    stmts = [s for s in sqlglot.parse(src, read='trino') if s is not None]
    for i, st in enumerate(stmts, 1):
        tables = sorted({".".join(p for p in (t.catalog, t.db, t.name) if p) for t in st.find_all(exp.Table)})
        print(f"{path.split('/')[-1]} #{i}: {type(st).__name__} OK; tables: {', '.join(t for t in tables if '.' in t)}")
    # round-trip strict parse with error level raise
    sqlglot.transpile(src, read='trino', write='trino', error_level=sqlglot.ErrorLevel.RAISE)
print("ALL PARSED")
