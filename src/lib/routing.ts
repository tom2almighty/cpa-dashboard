import { ApiError, api } from "@/lib/api";
import type { AuthFile, AuthFileCooldown } from "@/lib/types";

/**
 * 路由编排：把 CPA 的优先级分层显式画出来。
 *
 * CPA 按优先级从高到低选层，同一层内再按 routing.strategy 分流。成员来自
 * 三处：api-keys.<family> 的每个 Key、openai-compatibility 的每个提供商、
 * /v8/management/credentials 的每个 OAuth/文件凭据。
 */

export const ROUTING_STRATEGIES = ["round-robin", "weighted-round-robin", "fill-first"] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export const ROUTING_KEY_FAMILIES = ["gemini", "interactions", "codex", "meta", "xai", "claude", "vertex"] as const;
export type RoutingKeyFamily = (typeof ROUTING_KEY_FAMILIES)[number];

export const ROUTING_COMPAT_FAMILY = "openai-compatibility";
export const ROUTING_WEIGHT_MAX = 1_000_000;
export const TIER_STEP = 10;

/** CPA 用排除全部模型表示「停用这个配置 Key」。 */
const DISABLE_ALL_MODELS_RULE = "*";

/** 没有显式模型列表时，CPA 为每个 Key 家族注册的内置模型目录。 */
const KEY_FAMILY_CHANNELS: Record<RoutingKeyFamily, string> = {
  gemini: "gemini",
  interactions: "gemini-interactions",
  codex: "codex",
  meta: "meta",
  xai: "xai",
  claude: "claude",
  vertex: "vertex",
};

export type RoutingMemberKind = "apiKey" | "compat" | "credential";

export type RoutingMemberLocation =
  | { kind: "apiKey"; family: RoutingKeyFamily; groupIndex: number; keyIndex: number; apiKey: string }
  | { kind: "compat"; groupIndex: number; name: string }
  | { kind: "credential"; target: string };

export type RoutingModelSource =
  | { type: "list"; models: string[] }
  | { type: "channel"; channel: string }
  | { type: "credential"; name: string }
  | { type: "none" };

export type RoutingWeightSlot = {
  index: number;
  weight: number | null;
  label: string;
};

export type RoutingMember = {
  key: string;
  kind: RoutingMemberKind;
  family: string;
  name: string;
  detail: string;
  priority: number;
  weights: RoutingWeightSlot[];
  keyCount: number;
  disabled: boolean;
  /** 运行时凭据没有文件可写优先级。 */
  locked: boolean;
  prefix: string;
  excludedModels: string[];
  modelSource: RoutingModelSource;
  unavailable: boolean;
  cooldowns: AuthFileCooldown[] | null;
  location: RoutingMemberLocation;
};

export type RoutingSettings = {
  strategy: RoutingStrategy;
  sessionAffinity: boolean;
  /** 0 表示无额外重试轮次。 */
  requestRetry: number;
  /** 0 表示尝试所有可用凭据。 */
  maxRetryCredentials: number;
};

export type RoutingBoard = {
  members: RoutingMember[];
  settings: RoutingSettings;
  forceModelPrefix: boolean;
  /** 凭据列表的读取时间，冷却倒计时从这里开始算。 */
  receivedAtMs: number;
};

export type RoutingTier = {
  id: string;
  memberKeys: string[];
};

export type RoutingDraft = {
  /** 优先级从高到低。 */
  tiers: RoutingTier[];
  /** 每个成员按 Key 位置的权重；null 表示按 1。 */
  weights: Record<string, (number | null)[]>;
  settings: RoutingSettings;
};

export type RoutingDropTarget = { kind: "tier"; tierId: string } | { kind: "gap"; index: number };

export type RoutingModelCatalog = {
  channels: Record<string, string[] | null>;
  credentials: Record<string, string[] | null>;
};

export type RoutingChange =
  | { kind: "priority"; memberKey: string; from: number; to: number }
  | { kind: "weight"; memberKey: string; index: number; from: number | null; to: number | null }
  | {
      kind: "setting";
      field: keyof RoutingSettings;
      from: RoutingSettings[keyof RoutingSettings];
      to: RoutingSettings[keyof RoutingSettings];
    };

export type RoutingPlan = {
  changes: RoutingChange[];
  priorities: Record<string, number>;
  weights: Record<string, (number | null)[]>;
  settings: Partial<RoutingSettings>;
};

export type RouteMemberState = "serving" | "excluded" | "cooling" | "blocked" | "unknown" | "ineligible" | "disabled";
export type RouteTierState = "active" | "standby" | "skipped" | "cooling" | "unknown";

export type RouteMember = {
  key: string;
  state: RouteMemberState;
  /** 该成员在当前层里的流量占比，fill-first 下为 null。 */
  share: number | null;
};

export type RouteTier = {
  tierId: string;
  state: RouteTierState;
  members: RouteMember[];
};

export type RoutePreview = {
  tiers: RouteTier[];
  hasActive: boolean;
};

/* ---------------------------------------------------------------------------------------------
 * 读配置
 * ------------------------------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const readInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
};

const readStringList = (value: unknown): string[] => (Array.isArray(value) ? value.map(readText).filter(Boolean) : []);

const readPath = (root: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), root);

/** 配置里的模型条目既可以按 alias 也可以按 name 被调用。 */
const readModelIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = readText(entry.alias) || readText(entry.name);
    if (id && !seen.has(id.toLowerCase())) {
      seen.add(id.toLowerCase());
      ids.push(id);
    }
  }
  return ids;
};

const readHost = (value: unknown): string => {
  const text = readText(value);
  if (!text) return "";
  try {
    return new URL(text).host || text;
  } catch {
    return text;
  }
};

const maskKey = (value: string): string => {
  const key = value.trim();
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
};

const stripJsonExtension = (name: string): string =>
  name.length > 5 && name.toLowerCase().endsWith(".json") ? name.slice(0, -5) : name;

export function normalizeRoutingStrategy(value: unknown): RoutingStrategy {
  const text = readText(value)
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (["weighted-round-robin", "weightedroundrobin", "wrr"].includes(text)) return "weighted-round-robin";
  if (["fill-first", "fillfirst", "ff"].includes(text)) return "fill-first";
  return "round-robin";
}

export function readRoutingSettings(raw: unknown): RoutingSettings {
  const routing = readPath(raw, ["routing"]);
  return {
    strategy: normalizeRoutingStrategy(readPath(routing, ["strategy"])),
    sessionAffinity: readPath(routing, ["session-affinity"]) === true,
    requestRetry: Math.max(0, readInteger(readPath(routing, ["retry", "request-retry"])) ?? 0),
    maxRetryCredentials: Math.max(0, readInteger(readPath(routing, ["retry", "max-retry-credentials"])) ?? 0),
  };
}

/* ---------------------------------------------------------------------------------------------
 * 构建看板
 * ------------------------------------------------------------------------------------------- */

function keyMembers(raw: unknown, family: RoutingKeyFamily): RoutingMember[] {
  const groups = readPath(raw, ["api-keys", family]);
  if (!Array.isArray(groups)) return [];
  const members: RoutingMember[] = [];
  groups.forEach((group, groupIndex) => {
    if (!isRecord(group) || !Array.isArray(group.keys)) return;
    group.keys.forEach((key, keyIndex) => {
      if (!isRecord(key)) return;
      // 组字段是共享配置，Key 上的非 null 字段覆盖它（与 CPA 展开 v8 分组一致）
      const effective: Record<string, unknown> = { ...group };
      for (const [field, value] of Object.entries(key)) {
        if (value !== null) effective[field] = value;
      }
      const apiKey = readText(key["api-key"]);
      const excludedModels = readStringList(effective["excluded-models"]);
      const models = readModelIds(effective.models);
      const groupName = readText(group.name);
      const host = readHost(group["base-url"]);
      const masked = maskKey(apiKey);
      members.push({
        key: `key:${family}:${groupIndex}:${keyIndex}`,
        kind: "apiKey",
        family,
        name: groupName || host || family,
        detail: [host && host !== groupName ? host : "", masked].filter(Boolean).join(" · "),
        priority: readInteger(effective.priority) ?? 0,
        weights: [{ index: 0, weight: readInteger(key.weight), label: masked }],
        keyCount: 1,
        disabled: excludedModels.includes(DISABLE_ALL_MODELS_RULE),
        locked: false,
        prefix: readText(effective.prefix),
        excludedModels,
        modelSource:
          models.length > 0 ? { type: "list", models } : { type: "channel", channel: KEY_FAMILY_CHANNELS[family] },
        unavailable: false,
        cooldowns: null,
        location: { kind: "apiKey", family, groupIndex, keyIndex, apiKey },
      });
    });
  });
  return members;
}

function compatMembers(raw: unknown): RoutingMember[] {
  const groups = readPath(raw, ["api-keys", ROUTING_COMPAT_FAMILY]);
  if (!Array.isArray(groups)) return [];
  const members: RoutingMember[] = [];
  groups.forEach((group, groupIndex) => {
    if (!isRecord(group)) return;
    const keys = Array.isArray(group.keys) ? group.keys.filter(isRecord) : [];
    const name = readText(group.name);
    const models = readModelIds(group.models);
    members.push({
      key: `compat:${groupIndex}`,
      kind: "compat",
      family: ROUTING_COMPAT_FAMILY,
      name: name || `#${groupIndex + 1}`,
      detail: readHost(group["base-url"]),
      priority: readInteger(group.priority) ?? 0,
      weights: keys.map((key, index) => ({
        index,
        weight: readInteger(key.weight),
        label: maskKey(readText(key["api-key"])) || `#${index + 1}`,
      })),
      // 无 Key 的兼容提供商仍会被调度一次
      keyCount: Math.max(1, keys.length),
      disabled: group.disabled === true,
      locked: false,
      prefix: readText(group.prefix),
      excludedModels: [],
      modelSource: models.length > 0 ? { type: "list", models } : { type: "none" },
      unavailable: false,
      cooldowns: null,
      location: { kind: "compat", groupIndex, name },
    });
  });
  return members;
}

function credentialMember(file: AuthFile): RoutingMember | null {
  const name = readText(file.name);
  if (!name) return null;
  const base = stripJsonExtension(name);
  const primary =
    readText(file.email) || readText(file.label) || readText(file.account) || readText(file.project_id) || base;
  const provider = (file.provider || file.type || "unknown").toLowerCase();
  return {
    key: `cred:${name}`,
    kind: "credential",
    family: provider,
    name: primary,
    detail: primary.toLowerCase() === base.toLowerCase() ? "" : base,
    priority: readInteger(file.priority) ?? 0,
    weights: [{ index: 0, weight: readInteger(file.weight ?? null), label: primary }],
    keyCount: 1,
    disabled: file.disabled === true,
    locked: file.runtime_only === true,
    prefix: "",
    excludedModels: [],
    modelSource: { type: "credential", name },
    unavailable: file.unavailable === true,
    cooldowns: file.cooldowns ?? null,
    location: { kind: "credential", target: file.id || name },
  };
}

export function buildRoutingBoard(raw: unknown, files: readonly AuthFile[], receivedAtMs = Date.now()): RoutingBoard {
  return {
    members: [
      ...ROUTING_KEY_FAMILIES.flatMap((family) => keyMembers(raw, family)),
      ...compatMembers(raw),
      ...files.flatMap((file) => credentialMember(file) ?? []),
    ],
    settings: readRoutingSettings(raw),
    forceModelPrefix: readPath(raw, ["routing", "force-model-prefix"]) === true,
    receivedAtMs,
  };
}

/* ---------------------------------------------------------------------------------------------
 * 排列梯队
 * ------------------------------------------------------------------------------------------- */

/** 配置侧的可比较快照；冷却倒计时等运行时数据不参与，避免倒计时触发布局重建。 */
export function boardSignature(board: RoutingBoard): string {
  const members = board.members
    .map(
      (member) =>
        `${member.key}|${member.priority}|${member.weights.map((slot) => slot.weight ?? "").join(",")}|${
          member.disabled ? 1 : 0
        }|${member.locked ? 1 : 0}`,
    )
    .sort();
  return JSON.stringify({ members, settings: board.settings, forceModelPrefix: board.forceModelPrefix });
}

export function tiersFromMembers(members: readonly RoutingMember[]): RoutingTier[] {
  const byPriority = new Map<number, RoutingMember[]>();
  for (const member of members) {
    byPriority.set(member.priority, [...(byPriority.get(member.priority) ?? []), member]);
  }
  return [...byPriority.entries()]
    .sort(([left], [right]) => right - left)
    .map(([priority, peers]) => ({
      id: `p${priority}`,
      memberKeys: peers
        .slice()
        .sort((left, right) => Number(left.disabled) - Number(right.disabled) || left.name.localeCompare(right.name))
        .map((member) => member.key),
    }));
}

export function draftFromBoard(board: RoutingBoard): RoutingDraft {
  const weights: RoutingDraft["weights"] = {};
  for (const member of board.members) {
    weights[member.key] = member.weights.map((slot) => slot.weight);
  }
  return { tiers: tiersFromMembers(board.members), weights, settings: { ...board.settings } };
}

let tierSequence = 0;
const newTierId = (): string => {
  tierSequence += 1;
  return `new-${tierSequence}`;
};

const withoutMember = (tiers: readonly RoutingTier[], key: string): RoutingTier[] =>
  tiers.map((tier) => ({ ...tier, memberKeys: tier.memberKeys.filter((memberKey) => memberKey !== key) }));

const withoutEmptyTiers = (tiers: readonly RoutingTier[]): RoutingTier[] =>
  tiers.filter((tier) => tier.memberKeys.length > 0);

export const tierIndexOf = (tiers: readonly RoutingTier[], key: string): number =>
  tiers.findIndex((tier) => tier.memberKeys.includes(key));

/**
 * 移到某一层或某个间隙。成员原本独占一层时，落在自己所在层的前后间隙不会改变排列。
 */
export function moveMember(tiers: readonly RoutingTier[], key: string, target: RoutingDropTarget): RoutingTier[] {
  const from = tierIndexOf(tiers, key);
  if (from < 0) return [...tiers];
  if (target.kind === "tier") {
    if (tiers[from].id === target.tierId || !tiers.some((tier) => tier.id === target.tierId)) {
      return [...tiers];
    }
    const moved = withoutMember(tiers, key).map((tier) =>
      tier.id === target.tierId ? { ...tier, memberKeys: [...tier.memberKeys, key] } : tier,
    );
    return withoutEmptyTiers(moved);
  }
  const isAlone = tiers[from].memberKeys.length === 1;
  if (isAlone && (target.index === from || target.index === from + 1)) return [...tiers];
  const moved = withoutMember(tiers, key);
  const index = Math.max(0, Math.min(target.index, moved.length));
  moved.splice(index, 0, { id: newTierId(), memberKeys: [key] });
  return withoutEmptyTiers(moved);
}

/** 键盘/菜单移动：上移并入上一层；已在顶层则单独升到上一层之上。 */
export function stepMember(tiers: readonly RoutingTier[], key: string, direction: "up" | "down"): RoutingTier[] {
  const from = tierIndexOf(tiers, key);
  if (from < 0) return [...tiers];
  if (direction === "up") {
    return from > 0
      ? moveMember(tiers, key, { kind: "tier", tierId: tiers[from - 1].id })
      : moveMember(tiers, key, { kind: "gap", index: 0 });
  }
  return from < tiers.length - 1
    ? moveMember(tiers, key, { kind: "tier", tierId: tiers[from + 1].id })
    : moveMember(tiers, key, { kind: "gap", index: tiers.length });
}

export function canStepMember(tiers: readonly RoutingTier[], key: string, direction: "up" | "down"): boolean {
  const from = tierIndexOf(tiers, key);
  if (from < 0) return false;
  const isAlone = tiers[from].memberKeys.length === 1;
  if (direction === "up") return from > 0 || !isAlone;
  return from < tiers.length - 1 || !isAlone;
}

export class RoutingPriorityError extends Error {
  constructor() {
    super("Locked priorities leave no room for this arrangement.");
    this.name = "RoutingPriorityError";
  }
}

/** 一层里最常见的存储优先级；并列取较大的数字。 */
function tierCandidate(memberPriorities: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const priority of memberPriorities) counts.set(priority, (counts.get(priority) ?? 0) + 1);
  let best = memberPriorities[0] ?? 0;
  let bestCount = 0;
  for (const [priority, count] of counts) {
    if (count > bestCount || (count === bestCount && priority > best)) {
      best = priority;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 按梯队顺序推导严格递减的优先级。能保留原数字的层尽量保留，其余填入空隙；
 * 含锁定成员的层始终使用该成员的优先级。
 */
export function assignPriorities(
  tiers: readonly RoutingTier[],
  members: readonly RoutingMember[],
): Record<string, number> {
  const byKey = new Map(members.map((member) => [member.key, member]));
  const candidates = tiers.map((tier) => {
    const tierMembers = tier.memberKeys.flatMap((key) => byKey.get(key) ?? []);
    const locked = tierMembers.find((member) => member.locked);
    const value = locked ? locked.priority : tierCandidate(tierMembers.map((member) => member.priority));
    const score = tierMembers.filter((member) => member.priority === value).length + (locked ? 1_000_000 : 0);
    return { value, score };
  });

  // 最重的严格递减子序列：这些层保留原数字
  const n = tiers.length;
  const best = candidates.map((candidate) => candidate.score);
  const previous = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (candidates[j].value > candidates[i].value && best[j] + candidates[i].score > best[i]) {
        best[i] = best[j] + candidates[i].score;
        previous[i] = j;
      }
    }
  }
  const kept = new Set<number>();
  if (n > 0) {
    let end = 0;
    for (let i = 1; i < n; i += 1) if (best[i] > best[end]) end = i;
    for (let i = end; i >= 0; i = previous[i]) kept.add(i);
  }

  const values = new Array<number>(n);
  for (const index of kept) values[index] = candidates[index].value;

  let fits = true;
  let i = 0;
  while (i < n) {
    if (kept.has(i)) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < n && !kept.has(end)) end += 1;
    const count = end - i;
    const upper = i > 0 ? values[i - 1] : null;
    const lower = end < n ? values[end] : null;
    for (let j = 0; j < count; j += 1) {
      if (upper === null && lower === null) values[i + j] = (count - 1 - j) * TIER_STEP;
      else if (upper === null) values[i + j] = (lower as number) + TIER_STEP * (count - j);
      else if (lower === null) values[i + j] = upper - TIER_STEP * (j + 1);
      else {
        const step = Math.floor((upper - lower) / (count + 1));
        if (step < 1) fits = false;
        values[i + j] = upper - Math.max(1, step) * (j + 1);
      }
    }
    i = end;
  }

  const anchors = tiers.flatMap((tier, index) => {
    const locked = tier.memberKeys.flatMap((key) => {
      const member = byKey.get(key);
      return member?.locked ? [member.priority] : [];
    });
    if (new Set(locked).size > 1) throw new RoutingPriorityError();
    return locked.length ? [{ index, value: locked[0] }] : [];
  });
  if (!fits || anchors.some((anchor) => values[anchor.index] !== anchor.value)) {
    // 只重排锁定锚点之间的可编辑层
    for (let segment = 0; segment <= anchors.length; segment += 1) {
      const upper = anchors[segment - 1];
      const lower = anchors[segment];
      const start = upper ? upper.index + 1 : 0;
      const end = lower ? lower.index : n;
      const count = end - start;
      const step = upper && lower ? Math.floor((upper.value - lower.value) / (count + 1)) : TIER_STEP;
      if (step < 1) throw new RoutingPriorityError();
      for (let offset = 0; offset < count; offset += 1) {
        values[start + offset] = upper
          ? upper.value - step * (offset + 1)
          : (lower?.value ?? -TIER_STEP) + step * (count - offset);
      }
      if (lower) values[lower.index] = lower.value;
    }
  }

  const result: Record<string, number> = {};
  tiers.forEach((tier, index) => {
    for (const key of tier.memberKeys) result[key] = values[index];
  });
  return result;
}

/* ---------------------------------------------------------------------------------------------
 * 计划与写入
 * ------------------------------------------------------------------------------------------- */

const SETTING_FIELDS: readonly (keyof RoutingSettings)[] = [
  "strategy",
  "sessionAffinity",
  "requestRetry",
  "maxRetryCredentials",
];

export function buildRoutingPlan(board: RoutingBoard, draft: RoutingDraft): RoutingPlan {
  const assigned = assignPriorities(draft.tiers, board.members);
  const changes: RoutingChange[] = [];
  const priorities: RoutingPlan["priorities"] = {};
  const weights: RoutingPlan["weights"] = {};
  for (const member of board.members) {
    if (member.locked) continue;
    const next = assigned[member.key];
    if (next !== undefined && next !== member.priority) {
      priorities[member.key] = next;
      changes.push({ kind: "priority", memberKey: member.key, from: member.priority, to: next });
    }
    // 草稿里没有的成员（外部刚加进来的）沿用配置里的权重，不把它的 Key 误判成改回默认值
    const draftWeights = draft.weights[member.key] ?? member.weights.map((slot) => slot.weight);
    let weightChanged = false;
    member.weights.forEach((slot, index) => {
      const to = draftWeights[index] ?? null;
      if (to !== slot.weight) {
        weightChanged = true;
        changes.push({ kind: "weight", memberKey: member.key, index, from: slot.weight, to });
      }
    });
    if (weightChanged) {
      weights[member.key] = member.weights.map((_, index) => draftWeights[index] ?? null);
    }
  }
  const settings: Partial<RoutingSettings> = {};
  for (const field of SETTING_FIELDS) {
    if (draft.settings[field] !== board.settings[field]) {
      Object.assign(settings, { [field]: draft.settings[field] });
      changes.push({ kind: "setting", field, from: board.settings[field], to: draft.settings[field] });
    }
  }
  return { changes, priorities, weights, settings };
}

export type CredentialWrite = {
  key: string;
  target: string;
  fields: { priority?: number; weight?: number | null };
};

export function credentialWrites(board: RoutingBoard, plan: RoutingPlan): CredentialWrite[] {
  return board.members.flatMap((member) => {
    if (member.location.kind !== "credential") return [];
    const fields: CredentialWrite["fields"] = {};
    if (plan.priorities[member.key] !== undefined) fields.priority = plan.priorities[member.key];
    if (plan.weights[member.key]) fields.weight = plan.weights[member.key][0] ?? null;
    return Object.keys(fields).length ? [{ key: member.key, target: member.location.target, fields }] : [];
  });
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 后端注入的只读元数据，写入前必须剔除。 */
const stripAuthIndex = (value: Record<string, unknown>) => {
  delete value.auth_index;
  delete value["auth-index"];
};

const setWeight = (key: Record<string, unknown>, weight: number | null) => {
  if (weight === null) delete key.weight;
  else key.weight = weight;
};

export class RoutingConflictError extends Error {
  constructor() {
    super("The configuration changed since the board was loaded; refresh and try again.");
    this.name = "RoutingConflictError";
  }
}

/**
 * 所有配置侧修改合成一次 PATCH /config，并基于最新文档校验位置。
 * 列表整体替换，所以每个涉及的家族都完整发送；位置对不上视为冲突而不是猜测。
 */
export function buildRoutingConfigPatch(
  latestRaw: unknown,
  board: RoutingBoard,
  plan: RoutingPlan,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  const routing: Record<string, unknown> = {};
  const retry: Record<string, unknown> = {};
  if (plan.settings.strategy !== undefined) routing.strategy = plan.settings.strategy;
  if (plan.settings.sessionAffinity !== undefined) routing["session-affinity"] = plan.settings.sessionAffinity;
  if (plan.settings.requestRetry !== undefined) retry["request-retry"] = plan.settings.requestRetry;
  if (plan.settings.maxRetryCredentials !== undefined)
    retry["max-retry-credentials"] = plan.settings.maxRetryCredentials;
  if (Object.keys(retry).length) routing.retry = retry;
  if (Object.keys(routing).length) patch.routing = routing;

  const families = new Map<string, Record<string, unknown>[]>();
  const familyGroups = (family: string): Record<string, unknown>[] => {
    let groups = families.get(family);
    if (!groups) {
      const latest = readPath(latestRaw, ["api-keys", family]);
      if (!Array.isArray(latest) || !latest.every(isRecord)) throw new RoutingConflictError();
      groups = cloneJson(latest as Record<string, unknown>[]);
      families.set(family, groups);
    }
    return groups;
  };

  for (const member of board.members) {
    const priority = plan.priorities[member.key];
    const weights = plan.weights[member.key];
    if (priority === undefined && !weights) continue;
    const location = member.location;
    if (location.kind === "apiKey") {
      const group = familyGroups(location.family)[location.groupIndex];
      const keys = isRecord(group) && Array.isArray(group.keys) ? group.keys : null;
      const key = keys?.[location.keyIndex];
      if (!isRecord(key) || readText(key["api-key"]) !== location.apiKey) throw new RoutingConflictError();
      // Key 级 priority 只覆盖这一个 Key，组的共享值保持不变
      if (priority !== undefined) key.priority = priority;
      if (weights) setWeight(key, weights[0] ?? null);
    } else if (location.kind === "compat") {
      const group = familyGroups(ROUTING_COMPAT_FAMILY)[location.groupIndex];
      if (!isRecord(group) || readText(group.name) !== location.name) throw new RoutingConflictError();
      if (priority !== undefined) group.priority = priority;
      if (weights) {
        const keys = (Array.isArray(group.keys) ? group.keys : []).filter(isRecord);
        if (keys.length !== member.weights.length) throw new RoutingConflictError();
        keys.forEach((key, index) => {
          setWeight(key, weights[index] ?? null);
        });
      }
    }
  }

  if (families.size) {
    const apiKeys: Record<string, unknown> = {};
    for (const [family, groups] of families) {
      for (const group of groups) {
        stripAuthIndex(group);
        if (Array.isArray(group.keys)) group.keys.filter(isRecord).forEach(stripAuthIndex);
      }
      apiKeys[family] = groups;
    }
    patch["api-keys"] = apiKeys;
  }

  return Object.keys(patch).length ? patch : null;
}

export type RoutingApplyResult = {
  /** 已写入的成员 key 和 "settings"。 */
  applied: string[];
  /** 第一个失败项：成员 key，或 "config"。 */
  failed: { key: string; error: unknown } | null;
  notAttempted: string[];
};

export async function applyRoutingPlan(board: RoutingBoard, plan: RoutingPlan): Promise<RoutingApplyResult> {
  const writes = credentialWrites(board, plan);
  const credentialKeys = new Set(writes.map((write) => write.key));
  const configKeys = Object.keys({ ...plan.priorities, ...plan.weights }).filter((key) => !credentialKeys.has(key));
  const configTargets = [...configKeys, ...(Object.keys(plan.settings).length ? ["settings"] : [])];
  const result: RoutingApplyResult = { applied: [], failed: null, notAttempted: [] };

  for (let index = 0; index < writes.length; index += 1) {
    const write = writes[index];
    try {
      await api("/v8/management/credentials/fields", {
        method: "PATCH",
        body: { name: write.target, ...write.fields },
      });
      result.applied.push(write.key);
    } catch (error) {
      result.failed = { key: write.key, error };
      result.notAttempted = [...writes.slice(index + 1).map((item) => item.key), ...configTargets];
      return result;
    }
  }

  if (configTargets.length === 0) return result;
  try {
    // 重新读一次，避免用 30 秒前的快照覆盖别人的修改
    const latest = await api<Record<string, unknown>>("/v8/management/config");
    const patch = buildRoutingConfigPatch(latest, board, plan);
    if (patch) await api("/v8/management/config", { method: "PATCH", body: patch });
    result.applied.push(...configTargets);
  } catch (error) {
    result.failed = { key: "config", error };
    result.notAttempted = configTargets;
  }
  return result;
}

export function isRoutingConflict(error: unknown): boolean {
  return error instanceof RoutingConflictError || (error instanceof ApiError && error.status === 412);
}

/* ---------------------------------------------------------------------------------------------
 * 模型与预览
 * ------------------------------------------------------------------------------------------- */

/** 与后端一致：忽略大小写，只有 `*` 是通配符，其余字符按字面量匹配。 */
export function matchesExcludedRule(rule: string, modelId: string): boolean {
  const normalizedRule = rule.trim().toLowerCase();
  const normalizedModel = modelId.trim().toLowerCase();
  if (!normalizedRule || !normalizedModel) return false;
  if (!normalizedRule.includes("*")) return normalizedRule === normalizedModel;
  const escaped = normalizedRule
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i").test(normalizedModel);
}

export const isModelExcluded = (rules: readonly string[], modelId: string): boolean =>
  rules.some((rule) => matchesExcludedRule(rule, modelId));

/** 模型 ID，未知时返回 null。凭据目录已经是最终可调用 ID。 */
export function memberModels(member: RoutingMember, catalog: RoutingModelCatalog): string[] | null {
  const source = member.modelSource;
  let models: string[] | null;
  if (source.type === "list") models = source.models;
  else if (source.type === "none") models = [];
  else if (source.type === "channel") models = catalog.channels[source.channel] ?? null;
  else models = catalog.credentials[source.name] ?? null;
  if (!models) return null;
  return member.excludedModels.length
    ? models.filter((model) => !isModelExcluded(member.excludedModels, model))
    : models;
}

/** 带前缀的成员也响应前缀名；force-model-prefix 下只响应前缀名。 */
export function memberServesModel(
  member: RoutingMember,
  models: readonly string[],
  model: string,
  forceModelPrefix: boolean,
): boolean {
  const requested = model.trim().toLowerCase();
  const known = (id: string) => models.some((entry) => entry.toLowerCase() === id);
  // 凭据接口返回的目录已经应用过前缀策略
  if (member.modelSource.type === "credential") return known(requested);
  const prefix = member.prefix.toLowerCase();
  if (prefix) {
    if (requested.startsWith(`${prefix}/`) && known(requested.slice(prefix.length + 1))) return true;
    if (forceModelPrefix && requested !== prefix) return false;
  }
  return known(requested);
}

export function collectModelOptions(board: RoutingBoard, catalog: RoutingModelCatalog): string[] {
  const options = new Map<string, string>();
  const add = (id: string) => {
    if (!options.has(id.toLowerCase())) options.set(id.toLowerCase(), id);
  };
  for (const member of board.members) {
    if (member.disabled) continue;
    const models = memberModels(member, catalog);
    if (!models) continue;
    for (const model of models) {
      if (member.modelSource.type === "credential") {
        add(model);
        continue;
      }
      if (!member.prefix || !board.forceModelPrefix) add(model);
      if (member.prefix) add(`${member.prefix}/${model}`);
    }
  }
  return [...options.values()].sort((left, right) => left.localeCompare(right));
}

const baseModelKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\(.*\)$/, "");

/** 还会阻塞这个请求的冷却秒数；只统计能匹配该模型的记录。 */
export function activeCooldownSeconds(
  member: RoutingMember,
  model: string | null,
  nowMs: number,
  receivedAtMs: number,
): number {
  const records = member.cooldowns;
  if (!records?.length) return 0;
  const elapsed = Math.max(0, nowMs - receivedAtMs) / 1000;
  let requested: string | null = null;
  if (model) {
    const lower = model.trim().toLowerCase();
    const prefix = member.prefix.toLowerCase();
    requested = baseModelKey(prefix && lower.startsWith(`${prefix}/`) ? lower.slice(prefix.length + 1) : lower);
  }
  let longest = 0;
  for (const record of records) {
    const remaining = Math.ceil(record.remaining_seconds - elapsed);
    if (remaining <= 0) continue;
    const blocks =
      record.scope === "credential" || (requested !== null && baseModelKey(record.model_key ?? "") === requested);
    if (blocks) longest = Math.max(longest, remaining);
  }
  return longest;
}

const memberUnits = (member: RoutingMember, weights: readonly (number | null)[], strategy: RoutingStrategy): number => {
  if (strategy !== "weighted-round-robin") return member.keyCount;
  if (member.weights.length === 0) return member.keyCount;
  return member.weights.reduce((sum, _, index) => sum + Math.max(0, weights[index] ?? 1), 0);
};

/**
 * 按草稿估算去向：第一个有成员能服务的层接单，上面的层跳过（无此模型或冷却中），
 * 下面的层待命。看不到 CPA 内部的 API Key 冷却与会话绑定。
 */
export function resolveRoute(
  board: RoutingBoard,
  draft: RoutingDraft,
  catalog: RoutingModelCatalog,
  model: string | null,
  nowMs: number,
): RoutePreview {
  const byKey = new Map(board.members.map((member) => [member.key, member]));
  const strategy = draft.settings.strategy;
  let hasActive = false;
  const tiers: RouteTier[] = draft.tiers.map((tier) => {
    const units = new Map<string, number>();
    const members: RouteMember[] = tier.memberKeys.flatMap((key) => {
      const member = byKey.get(key);
      if (!member) return [];
      let state: RouteMemberState;
      const models = model ? memberModels(member, catalog) : [];
      if (member.disabled) state = "disabled";
      else if (model && models === null) state = "unknown";
      else if (model && !memberServesModel(member, models ?? [], model, board.forceModelPrefix)) {
        state = "ineligible";
      } else if (activeCooldownSeconds(member, model, nowMs, board.receivedAtMs) > 0) state = "cooling";
      else if (member.unavailable && !member.cooldowns?.length) state = "blocked";
      else {
        const value = memberUnits(member, draft.weights[key] ?? [], strategy);
        if (value > 0) {
          units.set(key, value);
          state = "serving";
        } else state = "excluded";
      }
      return [{ key, state, share: null }];
    });

    const total = [...units.values()].reduce((sum, value) => sum + value, 0);
    const has = (state: RouteMemberState) => members.some((member) => member.state === state);
    const candidates = members.filter((member) => member.state !== "ineligible" && member.state !== "disabled");
    let state: RouteTierState;
    if (!hasActive && total > 0) {
      state = "active";
      hasActive = true;
      if (strategy !== "fill-first") {
        for (const member of members) {
          const value = units.get(member.key);
          if (value !== undefined) member.share = Math.round((value / total) * 1000) / 10;
        }
      }
    } else if (candidates.length === 0) state = "skipped";
    else if (hasActive) state = "standby";
    else if (has("cooling") || has("blocked")) state = "cooling";
    else if (has("unknown")) state = "unknown";
    else state = "skipped";
    return { tierId: tier.id, state, members };
  });
  return { tiers, hasActive };
}

/** 需要加载内置模型目录的渠道。 */
export function neededChannels(board: RoutingBoard): string[] {
  const channels = new Set<string>();
  for (const member of board.members) {
    if (member.modelSource.type === "channel") channels.add(member.modelSource.channel);
  }
  return [...channels].sort();
}

/** 需要读取实时模型目录的凭据（停用的不会服务）。 */
export function neededCredentialModels(board: RoutingBoard): string[] {
  return board.members.flatMap((member) =>
    member.modelSource.type === "credential" && !member.disabled ? [member.modelSource.name] : [],
  );
}

export function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(ROUTING_WEIGHT_MAX, Math.max(0, Math.round(value)));
}
