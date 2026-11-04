---
phase: 1
plan: 1
wave: 1
depends_on: []
files_modified:
  - package.json
autonomous: true
user_setup: []

must_haves:
  truths:
    - "A standalone Windows .exe executable is generated in release/"
    - "No application source code files in client/src or server/src are modified"
    - "CodeRabbit review is performed to verify changes"
  artifacts:
    - "release/Aqua Home Appliance 1.0.0.exe"
---

# Plan 1.1: Build Windows Executable (.exe)

<objective>
Generate a standalone Windows `.exe` application file for Aqua Home Appliance on Linux without wine dependencies, preserving all existing application source code untouched, and verify the changes using CodeRabbit.

Purpose: Provide an offline-ready Windows executable (.exe) for distribution.
Output: release/Aqua Home Appliance 1.0.0.exe
</objective>

<context>
Load for context:
- package.json
- electron/main.cjs
</context>

<tasks>

<task type="auto">
  <name>Configure Windows portable target in package.json</name>
  <files>package.json</files>
  <action>
    Update `scripts.dist:win` and `build.win.target` to support `portable` Windows target instead of requiring `wine`-dependent NSIS uninstaller generation on Linux.
    AVOID: Modifying any application files under client/src or server/src.
  </action>
  <verify>grep -E '"target"|"dist:win"' package.json</verify>
  <done>package.json has dist:win configured with portable target</done>
</task>

<task type="auto">
  <name>Compile client assets and build Windows .exe</name>
  <files>release/Aqua Home Appliance 1.0.0.exe</files>
  <action>
    Run the build pipeline (`npm run build:client` then `electron-builder --win portable --x64`) to produce the standalone .exe file.
    AVOID: Altering any application logic or database schemas.
  </action>
  <verify>test -f "release/Aqua Home Appliance 1.0.0.exe" && ls -lh "release/Aqua Home Appliance 1.0.0.exe"</verify>
  <done>Standalone Windows .exe executable exists in release/ directory</done>
</task>

<task type="auto">
  <name>Verify changes with CodeRabbit</name>
  <files>package.json</files>
  <action>
    Run CodeRabbit review to verify that only packaging/executable build configurations were updated and no application code was touched.
  </action>
  <verify>/home/hassaan/.local/bin/coderabbit review --agent</verify>
  <done>CodeRabbit review executed and reported</done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] Standalone Windows executable `release/Aqua Home Appliance 1.0.0.exe` is successfully created
- [ ] Only packaging configuration was modified; zero changes to client/src or server/src
- [ ] CodeRabbit review completed
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
</success_criteria>
