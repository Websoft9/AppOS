# User Prompt

## Dev

1. Code review all code & implementations related to storyx.x
2. Implement storyx.x based on specs/implementation-artifacts/storyx.x-*.md
3. Refactor [package/component] to match [reference file/package]
4. Rename [function/component/file] to [new name] across backend and frontend
5. Diagnose why [feature/page] is broken, trace root cause, and fix it
6. Write program logic to implement the migration patch file merging function:
    ```
    Rules:
    1. Read all incremental patch files under Migration.
    2. Classify files by database table.
    3. Merge all patches belonging to the same table into its dedicated main schema file, following the rule of one main schema file per single table.
    4. Output runnable processing logic together with validation logic.
    ```
7. 先落地方案到 epicx，文档 storyx.x-schema-migration.md，文档保持极简风格。落地流程：
    ```
    1. 先校验文档是否达到可开发标准，不完善则持续优化；
    2. 文档就绪后直接开展开发实施。
    本次会话完整交付：文档定稿、业务开发、自测用例、make build 编译校验、代码评审以及评审问题修复全套内容。
    ```
8. 解决问题过程中，有必要请直接浏览器访问应用：http://cdl.dev.websoft9.cn:9091，账号凭据参考 build/.env 

9. 直接进浏览器把这几个页面逐个点一遍，确认列显隐、分页和开关视觉都符合预期。


## Test

1. Run backend tests and fix failures
2. Run frontend tests for [component/page] and fix failures
3. Add an E2E smoke test for [feature/page]
4. Check whether storyx.x acceptance criteria have enough test coverage
5. Run the local CI gate: build, backend tests, frontend tests

## Specs

1. Scan all story files under specs/implementation-artifacts and shorten long filenames to 3 words max, excluding storyx.x
2. After renaming story files, update broken epic and index references
3. Validate storyx.x: acceptance criteria, dependencies, and status
4. Update sprint-status.yaml to match actual story and epic progress
5. Scan for duplicate or overlapping story files and flag conflicts

## Docs

1. Update CHANGELOG.md from recent commits
2. Scan docs for stale references to renamed or deleted APIs/files
3. Summarize all stories in epic x in a compact table

## Build/CI

1. Run the full local CI gate and report failures with file paths
2. Review build warnings and suggest which ones should become errors