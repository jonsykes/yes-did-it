---
name: ydi-plan
description: Break a task or goal into multiple todos and batch-add them to Yes! Did It. Use when the user describes a multi-step project, initiative, or goal that should be tracked as separate actionable items.
argument-hint: [goal or task description]
allowed-tools: Bash
---

# Plan & Add Todos

Break down a user's goal into concrete, actionable todos and add them all via the `ydi` CLI.

## Rules

1. Break the goal into 3–7 discrete, actionable steps — each should be completable independently
2. Keep todo text short and action-oriented (start with a verb)
3. If the user mentions a deadline, distribute due dates logically across the steps
4. Tag all todos with a shared tag so they can be filtered together
5. Show the user the full plan before adding — wait for confirmation
6. After adding, run `ydi list --tags <tag>` to show what was created

## Example

User: "plan out the v2 launch for Friday"

Proposed plan:
1. "Finalize changelog" — due Wednesday, tag: v2-launch
2. "Run full test suite" — due Thursday morning, tag: v2-launch
3. "Update deployment config" — due Thursday, tag: v2-launch
4. "Deploy to staging" — due Thursday afternoon, tag: v2-launch
5. "Smoke test staging" — due Thursday evening, tag: v2-launch
6. "Deploy to production" — due Friday morning, tag: v2-launch
7. "Announce in Slack" — due Friday, tag: v2-launch

After confirmation:
```bash
ydi add "Finalize changelog" --due "Wednesday" --tags v2-launch
ydi add "Run full test suite" --due "Thursday 10am" --tags v2-launch
ydi add "Update deployment config" --due "Thursday" --tags v2-launch
ydi add "Deploy to staging" --due "Thursday 2pm" --tags v2-launch
ydi add "Smoke test staging" --due "Thursday 5pm" --tags v2-launch
ydi add "Deploy to production" --due "Friday 10am" --tags v2-launch
ydi add "Announce in Slack" --due "Friday" --tags v2-launch
ydi list --tags v2-launch
```
