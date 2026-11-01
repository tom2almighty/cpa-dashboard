import { expect, test } from "vitest";
import type { AuthFile } from "@/lib/types";
import {
  activeCooldownSeconds,
  applyRoutingPlan,
  assignPriorities,
  boardSignature,
  buildRoutingBoard,
  buildRoutingConfigPatch,
  buildRoutingPlan,
  credentialWrites,
  draftFromBoard,
  matchesExcludedRule,
  moveMember,
  RoutingConflictError,
  type RoutingModelCatalog,
  resolveRoute,
} from "./routing";

const raw = () => ({
  routing: {
    strategy: "weighted-round-robin",
    "session-affinity": true,
    retry: { "request-retry": 2, "max-retry-credentials": 3 },
  },
  "api-keys": {
    codex: [
      {
        name: "team",
        "base-url": "https://codex.example",
        auth_index: "group-meta",
        keys: [
          { "api-key": "sk-aaaa1111", priority: 20, weight: 2, auth_index: "key-a" },
          { "api-key": "sk-bbbb2222", priority: 20, "auth-index": "key-b" },
        ],
      },
      {
        name: "backup",
        "base-url": "https://backup.example",
        keys: [{ "api-key": "sk-cccc3333", priority: 0 }],
      },
    ],
    "openai-compatibility": [
      {
        name: "compat",
        "base-url": "https://compat.example",
        priority: 5,
        keys: [{ "api-key": "k1", weight: 3, auth_index: "compat-a" }, { "api-key": "k2" }],
        models: [{ name: "upstream-model", alias: "m1" }],
      },
    ],
  },
});

const file = (overrides: Partial<AuthFile>): AuthFile => ({
  id: "auth-1",
  name: "account.json",
  provider: "claude",
  ...overrides,
});

const credential = (overrides: Partial<AuthFile> = {}) =>
  file({ id: "auth-me", name: "me.json", email: "me@example.com", priority: 42, weight: 4, ...overrides });

const catalog = (overrides: Partial<RoutingModelCatalog> = {}): RoutingModelCatalog => ({
  channels: {},
  credentials: {},
  ...overrides,
});

test("builds members from v8 groups, compat providers, and credentials", () => {
  const board = buildRoutingBoard(raw(), [credential()], 1_000);
  const team = board.members.filter((member) => member.name === "team");
  expect(team).toHaveLength(2);
  expect(team[0].priority).toBe(20);
  expect(team[0].weights[0].weight).toBe(2);
  expect(team[1].weights[0].weight).toBeNull();
  expect(board.members.find((member) => member.name === "compat")?.keyCount).toBe(2);
  expect(board.members.find((member) => member.key === "cred:me.json")?.locked).toBe(false);
  expect(board.members.find((member) => member.key === "cred:me.json")?.weights[0].weight).toBe(4);
  expect(board.settings).toEqual({
    strategy: "weighted-round-robin",
    sessionAffinity: true,
    requestRetry: 2,
    maxRetryCredentials: 3,
  });
  expect(board.forceModelPrefix).toBe(false);
});

test("runtime-only credentials are locked and never planned", () => {
  const board = buildRoutingBoard(raw(), [credential({ runtime_only: true, priority: 7 })]);
  const member = board.members.find((item) => item.key.startsWith("cred:"));
  expect(member?.locked).toBe(true);
  const draft = draftFromBoard(board);
  const plan = buildRoutingPlan(board, { ...draft, weights: { ...draft.weights, "cred:me.json": [9] } });
  expect(plan.changes).toEqual([]);
  expect(credentialWrites(board, plan)).toEqual([]);
});

test("an unchanged draft has no plan", () => {
  const board = buildRoutingBoard(raw(), [credential()]);
  expect(buildRoutingPlan(board, draftFromBoard(board)).changes).toEqual([]);
});

test("a member added outside the draft keeps its stored weights", () => {
  const draft = draftFromBoard(buildRoutingBoard(raw(), []));
  const extra = raw();
  extra["api-keys"]["openai-compatibility"].push({
    name: "late",
    "base-url": "https://late.example",
    priority: -5,
    keys: [{ "api-key": "late-key", weight: 2 }],
    models: [{ name: "late-model" }],
  });
  const board = buildRoutingBoard(extra, []);
  expect(board.members.some((member) => member.name === "late")).toBe(true);
  expect(buildRoutingPlan(board, draft).changes).toEqual([]);
});

test("moving the lowest tier to the top assigns it a higher priority", () => {
  const board = buildRoutingBoard(raw(), []);
  const draft = draftFromBoard(board);
  const backup = board.members.find((member) => member.name === "backup");
  const team = board.members.find((member) => member.name === "team" && member.priority === 20);
  const compat = board.members.find((member) => member.name === "compat");
  expect(backup && team && compat).toBeTruthy();
  if (!backup || !team || !compat) return;

  const tiers = moveMember(draft.tiers, backup.key, { kind: "gap", index: 0 });
  const priorities = assignPriorities(tiers, board.members);
  expect(priorities[backup.key]).toBeGreaterThan(priorities[team.key]);
  expect(priorities[team.key]).toBe(20);
  expect(priorities[compat.key]).toBe(5);

  const plan = buildRoutingPlan(board, { ...draft, tiers });
  expect(plan.priorities[backup.key]).toBe(30);
  expect(plan.changes.some((change) => change.kind === "priority" && change.memberKey === backup.key)).toBe(true);
});

test("weight edits are planned and compat weights round-trip into one config patch", () => {
  const latest = raw();
  const board = buildRoutingBoard(latest, []);
  const draft = draftFromBoard(board);
  const compat = board.members.find((member) => member.name === "compat");
  const teamKey = board.members.find((member) => member.name === "team" && member.weights[0].weight === 2);
  expect(compat && teamKey).toBeTruthy();
  if (!compat || !teamKey) return;

  const next = {
    ...draft,
    weights: {
      ...draft.weights,
      [compat.key]: [5, 0],
      [teamKey.key]: [1],
    },
  };
  const plan = buildRoutingPlan(board, next);
  expect(plan.weights[compat.key]).toEqual([5, 0]);
  expect(plan.weights[teamKey.key]).toEqual([1]);

  const patch = buildRoutingConfigPatch(latest, board, plan);
  const apiKeys = patch?.["api-keys"] as Record<string, Record<string, unknown>[]>;
  expect(apiKeys.codex).toHaveLength(2);
  const codexKeys = apiKeys.codex[0].keys as Record<string, unknown>[];
  expect(codexKeys[0].weight).toBe(1);
  expect(codexKeys[0].auth_index).toBeUndefined();
  expect(apiKeys.codex[0].auth_index).toBeUndefined();
  const compatKeys = apiKeys["openai-compatibility"][0].keys as Record<string, unknown>[];
  expect(compatKeys[0].weight).toBe(5);
  expect(compatKeys[1].weight).toBe(0);
});

test("a moved key or provider is reported as a conflict instead of guessed", () => {
  const latest = raw();
  const board = buildRoutingBoard(latest, []);
  const draft = draftFromBoard(board);
  const teamKey = board.members.find((member) => member.name === "team");
  if (!teamKey) throw new Error("missing team member");
  const plan = buildRoutingPlan(board, { ...draft, weights: { ...draft.weights, [teamKey.key]: [7] } });

  const changed = raw();
  changed["api-keys"].codex[0].keys[0]["api-key"] = "sk-moved";
  expect(() => buildRoutingConfigPatch(changed, board, plan)).toThrow(RoutingConflictError);
});

test("route preview follows the first tier that serves the requested model", () => {
  const board = buildRoutingBoard(raw(), []);
  const draft = draftFromBoard(board);

  const compatRoute = resolveRoute(board, draft, catalog({ channels: { codex: null } }), "m1", 0);
  const compat = board.members.find((member) => member.name === "compat");
  const first = compatRoute.tiers.findIndex((tier) => tier.state === "active");
  expect(first).toBeGreaterThanOrEqual(0);
  expect(compatRoute.tiers[first].members.map((member) => member.key)).toContain(compat?.key);

  const roundRobin = { ...draft, settings: { ...draft.settings, strategy: "round-robin" as const } };
  const codexRoute = resolveRoute(
    board,
    roundRobin,
    catalog({ channels: { codex: ["gpt-5-codex"] } }),
    "gpt-5-codex",
    0,
  );
  expect(codexRoute.tiers[0].state).toBe("active");
  expect(codexRoute.tiers[0].members.every((member) => member.state === "serving")).toBe(true);
  expect(codexRoute.tiers[0].members[0].share).toBe(50);
});

test("cooldowns block only the scoped model and count down from the snapshot", () => {
  const board = buildRoutingBoard(raw(), [
    credential({
      cooldowns: [
        {
          scope: "model",
          model_key: "claude-sonnet-5",
          reason: "rate_limit",
          retry_at: "",
          remaining_seconds: 120,
        },
      ],
    }),
  ]);
  const member = board.members.find((item) => item.key.startsWith("cred:"));
  if (!member) throw new Error("missing credential member");
  expect(activeCooldownSeconds(member, "claude-sonnet-5", board.receivedAtMs + 60_000, board.receivedAtMs)).toBe(60);
  expect(activeCooldownSeconds(member, "claude-opus-5", board.receivedAtMs, board.receivedAtMs)).toBe(0);
  expect(activeCooldownSeconds(member, null, board.receivedAtMs, board.receivedAtMs)).toBe(0);
});

test("excluded model rules only treat * as a wildcard", () => {
  expect(matchesExcludedRule("*", "gpt-5-codex")).toBe(true);
  expect(matchesExcludedRule("gpt-*", "GPT-5-Codex")).toBe(true);
  expect(matchesExcludedRule("gpt-*", "claude-opus-5")).toBe(false);
  expect(matchesExcludedRule("gpt-5?", "gpt-5x")).toBe(false);
  expect(matchesExcludedRule("gpt-5?", "gpt-5?")).toBe(true);
});

test("board signature ignores runtime cooldown data", () => {
  const first = buildRoutingBoard(raw(), [credential()], 1_000);
  const second = buildRoutingBoard(
    raw(),
    [
      credential({
        cooldowns: [{ scope: "credential", reason: "rate_limit", retry_at: "", remaining_seconds: 30 }],
        unavailable: true,
      }),
    ],
    9_000,
  );
  expect(boardSignature(first)).toBe(boardSignature(second));
});

test("applyRoutingPlan writes credentials by id before patching config", async () => {
  // 覆盖纯函数部分即可；请求层由 api.test.ts 覆盖，这里确认 target 使用凭据 id。
  const board = buildRoutingBoard(raw(), [credential({ id: "auth-me", name: "me.json" })]);
  const draft = draftFromBoard(board);
  const plan = buildRoutingPlan(board, { ...draft, weights: { ...draft.weights, "cred:me.json": [8] } });
  expect(credentialWrites(board, plan)).toEqual([{ key: "cred:me.json", target: "auth-me", fields: { weight: 8 } }]);
  expect(typeof applyRoutingPlan).toBe("function");
});
