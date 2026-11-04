## graphify

graphify lives in a project-local virtualenv, not on PATH. Always call it as `.venv-graphify/bin/graphify`
(from the project root). If `.venv-graphify/` is missing, recreate it with
`python3 -m venv .venv-graphify && .venv-graphify/bin/pip install graphifyy==0.9.102`.
`.graphifyignore` keeps `data/` (real customer and bank records) and database/archive files out of the graph —
never remove those entries, and never run graphify's semantic (LLM) extraction on this project.

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `.venv-graphify/bin/graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `.venv-graphify/bin/graphify path "<A>" "<B>"` for relationships and `.venv-graphify/bin/graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `.venv-graphify/bin/graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
