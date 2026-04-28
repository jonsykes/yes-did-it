/**
 * Fixture payload for the agenda widget preview harness.
 *
 * Shape matches `_meta["ydi.todos"]` from the real get_agenda handler:
 *   { id, text, due_at, bucket, tags, branch, repo_slug }
 *
 * Spread across all three buckets, mix of branch/no-branch, varied tags.
 */

type FixtureTodo = {
  id: string;
  text: string;
  due_at: string | null;
  bucket: "overdue" | "today" | "week";
  tags: string[];
  branch: string | null;
  repo_slug: string | null;
};

function iso(deltaDays: number, hour = 17): string {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const fixtureTodos: FixtureTodo[] = [
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef0123456701",
    text: "Reply to legal re: DPA feedback before EOW",
    due_at: iso(-3),
    bucket: "overdue",
    tags: ["legal", "p0"],
    branch: null,
    repo_slug: null,
  },
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef0123456702",
    text: "Ship the anthropic-qa seed script PR",
    due_at: iso(-1),
    bucket: "overdue",
    tags: ["qa"],
    branch: "feat/anthropic-qa-seed",
    repo_slug: "jonsykes/Yesdidit",
  },
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef0123456703",
    text: "Cut a release branch for mobile and tag v0.6.0",
    due_at: iso(0, 16),
    bucket: "today",
    tags: ["release"],
    branch: "release/0.6.0",
    repo_slug: "jonsykes/Yesdidit",
  },
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef0123456704",
    text: "Review Adam's PR on account export",
    due_at: iso(0),
    bucket: "today",
    tags: ["review"],
    branch: "feat/account-delete-export",
    repo_slug: "jonsykes/Yesdidit",
  },
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef0123456705",
    text: "Draft investor update for Q2",
    due_at: iso(0),
    bucket: "today",
    tags: [],
    branch: null,
    repo_slug: null,
  },
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef0123456706",
    text: "Wire get_agenda widget into the MCP tool response",
    due_at: iso(1),
    bucket: "week",
    tags: ["mcp", "widgets"],
    branch: "feat/agenda-widget",
    repo_slug: "jonsykes/Yesdidit",
  },
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef0123456707",
    text: "Run the MCP inspector against staging",
    due_at: iso(2),
    bucket: "week",
    tags: ["qa", "mcp"],
    branch: null,
    repo_slug: null,
  },
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef0123456708",
    text: "Write ADR: three-channel response pattern for widget tools",
    due_at: iso(3),
    bucket: "week",
    tags: ["docs"],
    branch: "feat/agenda-widget",
    repo_slug: "jonsykes/Yesdidit",
  },
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef0123456709",
    text: "Double-check the anthropic directory submission package",
    due_at: iso(4),
    bucket: "week",
    tags: ["launch"],
    branch: null,
    repo_slug: null,
  },
  {
    id: "0a1b2c3d-4e5f-6789-abcd-ef012345670a",
    text: "Follow up on the data-studio intro from YC",
    due_at: iso(5),
    bucket: "week",
    tags: [],
    branch: null,
    repo_slug: null,
  },
];

export const fixtureResult = {
  structuredContent: {
    summary: fixtureTodos.length + " active todos",
    counts: {
      overdue: fixtureTodos.filter((t) => t.bucket === "overdue").length,
      today: fixtureTodos.filter((t) => t.bucket === "today").length,
      this_week: fixtureTodos.filter((t) => t.bucket === "week").length,
    },
  },
  _meta: {
    "ydi.todos": fixtureTodos,
    "ydi.server_time": new Date().toISOString(),
  },
};
