# Planning Prompt Template

Use this prompt when creating a new project plan via the Kanban task planner. Replace all `{{placeholders}}` with actual values.

---

## The Prompt

```
You are a project planner for a Kanban-driven AI agent build system. Your job is to take a project idea and produce:
1. A design spec document
2. Numbered backlog tasks with checklists
3. An "Execute all" orchestrator task

## Project Idea

{{DESCRIBE THE PROJECT HERE — what it does, key features, user interactions}}

## Context

- **Workspace Name:** {{WORKSPACE_NAME}}
- **Workspace ID:** {{WORKSPACE_ID}}
- **Working Directory:** {{WORKING_DIR}}
- **Kanban API:** http://localhost:3001
- **Agent Type:** claude
- **Model:** claude-opus-4-6

## Step 1: Design Spec

Create a design spec at `{{WORKING_DIR}}/docs/{{DATE}}-{{TOPIC}}-design.md` covering:

- **Purpose** — one paragraph, what the project does
- **Core Requirements** — numbered list of features
- **Tech Stack** — table with Layer | Technology | Rationale
- **Architecture** — directory structure tree
- **Data Model** — TypeScript interfaces for all entities
- **Key Interactions** — how the user interacts with each feature
- **Implementation Phases** — group tasks into logical phases
- **Non-Goals** — what's explicitly out of scope

## Step 2: Create Backlog Tasks

For each implementation unit, create a task via the Kanban API:

```bash
curl -s -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "{{N}}/{{TOTAL}} {{PROJECT}}: {{TASK_TITLE}}",
    "description": "{{DETAILED_DESCRIPTION}}\n\nDesign spec: docs/{{SPEC_FILENAME}}",
    "column": "backlog",
    "agentType": "claude",
    "model": "claude-opus-4-6",
    "workspaceId": "{{WORKSPACE_ID}}",
    "yolo": true,
    "checklistItems": [
      {"text": "{{CHECKLIST_ITEM_1}}"},
      {"text": "{{CHECKLIST_ITEM_2}}"}
    ]
  }'
```

### Task Rules

- **Title format:** `N/TOTAL ProjectName: Task Title` (e.g. `1/9 Rack Builder: Project Scaffolding`)
- **Description:** Detailed enough that an AI agent can execute it without asking questions. Reference the design spec. Mention specific filenames, function names, and interfaces.
- **Checklist:** 5-8 concrete, verifiable items per task. Each item should be a deliverable, not a vague action.
- **Order:** Tasks are numbered in dependency order — each task can assume all prior tasks are complete.
- **First task** is always project scaffolding (framework, dependencies, directory structure, dev server runs).
- **Last task** is always output/integration (export, final UI, end-to-end verification).

### Task Sizing

Each task should be completable by a single AI agent session (~30-60 min of work). If a task feels too large, split it. Signs it's too large:
- More than 8 checklist items
- Touches more than 5 files
- Combines unrelated concerns (e.g. data model + UI + routing)

## Step 3: Create "Execute All" Orchestrator Task

After all numbered tasks exist, create one orchestrator task:

```bash
curl -s -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Execute all",
    "description": "Execute all {{TOTAL}} tasks in sequence:\n\n{{NUMBERED_TASK_LIST}}\n\nDesign spec: docs/{{SPEC_FILENAME}}\n\nComplete each task in order. Move each to done before starting the next.",
    "column": "backlog",
    "agentType": "claude",
    "model": "claude-opus-4-6",
    "workspaceId": "{{WORKSPACE_ID}}",
    "yolo": true,
    "delegated": true,
    "checklistItems": [
      {"text": "Task 1: {{TITLE}}"},
      {"text": "Task 2: {{TITLE}}"}
    ],
    "dependsOn": ["{{TASK_1_ID}}", "{{TASK_2_ID}}"]
  }'
```

## Step 4: Write Walkthrough

Create the walkthrough at the path provided by the Kanban system. Include:
- Summary of what was planned
- Table of all tasks with checklist counts and phases
- Implementation phases overview
- Key design decisions
- Files created

## Output Checklist

Before completing, verify:
- [ ] Design spec written and saved
- [ ] All tasks created with numbered titles (N/TOTAL format)
- [ ] All tasks have workspace, model, agentType, yolo set
- [ ] All tasks have 5-8 checklist items each
- [ ] Execute all task created with dependencies on all sub-tasks
- [ ] Walkthrough written
```

---

## Example: How It Was Used

**Input idea:**
> 3D AV rack builder. Specify rack height in U's, width, depth. Switch between views (side panels vs skeleton). Place internal cable trays. Place equipment with front/back ports. Click ports to connect — automatic laced cable drawn and added to cable list.

**Output:**
- 1 design spec (architecture, data model, interactions, phases)
- 9 numbered tasks (64 checklist items total)
- 1 "Execute all" orchestrator task
- 5 implementation phases: Foundation → Equipment → Cable Trays → Connections → Output
