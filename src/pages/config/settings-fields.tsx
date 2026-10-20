import { Check, Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { DualModeField } from "@/components/dual-mode-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCopiedState } from "@/hooks/use-copied-state";
import { useI18n } from "@/i18n/context";
import {
  AUTH_APPLY_TO,
  AUTH_TYPE_FIELDS,
  AUTH_TYPES,
  type AuthRule,
  type ChannelEntries,
  type EntryFieldSpec,
  type IceServer,
  readPath,
  type Setting,
  useConfigSettings,
} from "./settings";

// 输入框里的文本转成写入值,非法返回 undefined
export function parseValue(type: Setting["type"], text: string): unknown {
  if (type === "int") return /^-?\d+$/.test(text.trim()) ? Number(text) : undefined;
  if (type === "list")
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  if (type === "auth-rules" || type === "channel-entries" || type === "ice-servers") {
    if (type === "ice-servers") return parseIceServers(text) ?? undefined;
    try {
      const value: unknown = JSON.parse(text);
      // 认证规则是数组,数组里每项是一个规则对象
      if (type === "auth-rules") return Array.isArray(value) && value.every(isRule) ? value : undefined;
      return isChannelEntries(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return text;
}

/** 认证规则:非空对象,且不是数组(数组会被当成列表值) */
function isRule(value: unknown): value is AuthRule {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 「渠道 -> 条目数组」:每个值都必须是非空对象的数组 */
function isChannelEntries(value: unknown): value is ChannelEntries {
  return isRule(value) && Object.values(value).every((entries) => Array.isArray(entries) && entries.every(isRule));
}

export function SettingField({ setting }: { setting: Setting }) {
  const { t } = useI18n();
  const { config, getValue, setValue, patch } = useConfigSettings();
  const id = useId();
  // 标签用 aria-labelledby 关联控件:htmlFor 会让点击标题行直接改值(开关、下拉)
  const labelId = `${id}-label`;
  const [showPassword, setShowPassword] = useState(false);
  const { copied, mark } = useCopiedState();

  const isModified = Object.hasOwn(patch, setting.endpoint);
  const value = getValue(setting);
  const text = typeof value === "string" ? value : "";
  const invalid = text !== "" && parseValue(setting.type, text) === undefined;

  const copyValue = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => {
        mark(text);
        toast.success(t("config.settings.copied_value"));
      },
      () => toast.error(t("common.copy_failed")),
    );
  };

  let control: ReactNode = null;

  if (setting.type === "bool") {
    control = (
      <Switch
        id={id}
        aria-labelledby={labelId}
        checked={value === true}
        onCheckedChange={(checked) => setValue(setting, checked)}
      />
    );
  } else if (setting.type === "select") {
    const options = setting.options?.map((option) => ({
      value: option,
      label: t(`config.fields.${setting.endpoint}.options.${option}` as never),
    }));
    control = (
      <Select items={options} value={text || null} onValueChange={(val) => val && setValue(setting, val)}>
        <SelectTrigger id={id} aria-labelledby={labelId} className="min-w-44 w-auto max-w-xs sm:max-w-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options?.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (setting.type === "password") {
    const placeholder = readPath(config, setting.endpoint)
      ? t("config.settings.secret_key_set")
      : t("config.settings.secret_key_unset");

    control = (
      <div className="relative w-full sm:w-80">
        <Input
          id={id}
          aria-labelledby={labelId}
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          value={text}
          onChange={(e) => setValue(setting, e.target.value.trim() ? e.target.value : "")}
          placeholder={placeholder}
          className="w-full pr-9 text-xs font-mono"
        />
        {text && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              title={showPassword ? t("login.hide_key") : t("config.settings.show_secret")}
              aria-label={showPassword ? t("login.hide_key") : t("config.settings.show_secret")}
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </div>
        )}
      </div>
    );
  } else if (setting.type === "list") {
    control = (
      <ListField id={id} labelId={labelId} text={text} invalid={invalid} onChange={(next) => setValue(setting, next)} />
    );
  } else if (setting.type === "auth-rules") {
    control = (
      <DualModeField
        ariaLabelledBy={labelId}
        value={text}
        onChange={(next) => setValue(setting, next)}
        parse={parseAuthRules}
        format={(rules) => JSON.stringify(rules, null, 2)}
        render={(rules, write) => <AuthRuleList rules={rules} write={write} />}
        invalidHint={t("config.settings.auth_invalid_json")}
      />
    );
  } else if (setting.type === "channel-entries") {
    const fields = setting.entryFields ?? [];
    control = (
      <DualModeField
        ariaLabelledBy={labelId}
        value={text}
        onChange={(next) => setValue(setting, next)}
        parse={parseChannelEntries}
        format={(entries) => JSON.stringify(entries, null, 2)}
        render={(entries, write) => <ChannelEntriesField value={entries} write={write} fields={fields} />}
        invalidHint={t("config.settings.channel_invalid_json")}
      />
    );
  } else if (setting.type === "ice-servers") {
    control = (
      <DualModeField
        ariaLabelledBy={labelId}
        value={text}
        onChange={(next) => setValue(setting, next)}
        parse={parseIceServers}
        format={(servers) => JSON.stringify(servers, null, 2)}
        render={(servers, write) => <IceServerList servers={servers} write={write} />}
        invalidHint={t("config.settings.ice_invalid_json")}
      />
    );
  } else {
    const isInt = setting.type === "int";
    control = (
      <div className="flex items-center gap-1.5 w-full sm:w-80">
        <Input
          id={id}
          aria-labelledby={labelId}
          value={text}
          inputMode={isInt ? "numeric" : undefined}
          onChange={(e) => setValue(setting, e.target.value)}
          aria-invalid={invalid}
          className={`flex-1 text-xs ${isInt ? "font-mono" : ""}`}
        />
        {text && setting.type === "text" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground shrink-0"
            title={t("common.copy")}
            aria-label={t("config.settings.copy_value")}
            onClick={copyValue}
          >
            {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
          </Button>
        )}
      </div>
    );
  }

  // list / 双模式编辑器需要整行宽度,其余保持左右分栏
  const wide =
    setting.type === "list" ||
    setting.type === "auth-rules" ||
    setting.type === "channel-entries" ||
    setting.type === "ice-servers";

  return (
    <div
      className={`flex flex-col gap-3 py-4 transition-colors ${
        wide ? "" : "sm:flex-row sm:items-center sm:justify-between"
      } ${isModified ? "bg-primary/5 rounded-lg px-3 -mx-3" : ""}`}
    >
      <div className={`min-w-0 ${wide ? "" : "pr-4"}`}>
        <div className="flex items-center gap-2">
          {/* 这里刻意不用 htmlFor（点标题不该改值），所以也放开文本选中：Label 基础样式带 select-none */}
          <Label id={labelId} className="font-medium text-sm select-text">
            {t(`config.fields.${setting.endpoint}.label` as never)}
          </Label>
          {isModified && (
            <Badge variant="outline" className="text-xs h-4.5 px-1.5 text-primary border-primary/30 font-normal">
              {t("config.settings.modified")}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          {t(`config.fields.${setting.endpoint}.hint` as never)}
        </p>
      </div>
      <div className={wide ? "w-full" : "shrink-0"}>{control}</div>
    </div>
  );
}

/** 字符串列表:逐行编辑,可增删行;空行由 parseValue 在保存时过滤 */
function ListField({
  id,
  labelId,
  text,
  invalid,
  onChange,
}: {
  id: string;
  labelId: string;
  text: string;
  invalid: boolean;
  onChange: (text: string) => void;
}) {
  const { t } = useI18n();
  // 空行是合法中间态(点了「添加一行」还没填),不能从 text 反推,否则新增的空行会被 join 掉
  const [rows, setRows] = useState<string[]>(() => (text === "" ? [] : text.split("\n")));
  const emitted = useRef(text);
  if (text !== emitted.current) {
    emitted.current = text;
    setRows(text === "" ? [] : text.split("\n"));
  }
  // 行没有天然标识,这里按行分配稳定 key,只在增删行时变动
  const rowKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  while (rowKeys.current.length < rows.length) rowKeys.current.push(`row-${keySeq.current++}`);
  if (rowKeys.current.length > rows.length) rowKeys.current.length = rows.length;
  const write = (next: string[]) => {
    setRows(next);
    emitted.current = next.join("\n");
    onChange(emitted.current);
  };

  return (
    <div className="grid gap-2">
      {rows.map((row, index) => (
        <div key={rowKeys.current[index]} className="flex items-center gap-2">
          <Input
            id={index === 0 ? id : undefined}
            aria-labelledby={labelId}
            aria-invalid={invalid}
            value={row}
            onChange={(e) => write(rows.map((item, i) => (i === index ? e.target.value : item)))}
            className="flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            title={t("config.settings.list_remove")}
            aria-label={t("config.settings.list_remove")}
            onClick={() => {
              rowKeys.current.splice(index, 1);
              write(rows.filter((_, i) => i !== index));
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit gap-1 text-xs"
        onClick={() => write([...rows, ""])}
      >
        <Plus className="size-3.5" />
        {t("config.settings.list_add")}
      </Button>
    </div>
  );
}

function isIceServer(value: unknown): value is Record<string, unknown> {
  return isRule(value) && Array.isArray(value.urls) && value.urls.every((url) => typeof url === "string");
}

/**
 * 文本 → ICE 服务器数组;空文本视为空数组。
 * 规范化时去掉空 URL 与空用户名,credential 保持原样不 trim。
 */
export function parseIceServers(text: string): IceServer[] | null {
  if (text.trim() === "") return [];
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return null;
    const servers: IceServer[] = [];
    for (const item of value) {
      if (!isIceServer(item)) return null;
      const urls = (item.urls as string[]).map((url) => url.trim()).filter(Boolean);
      if (urls.length === 0) continue;
      const server: IceServer = { urls };
      if (typeof item.username === "string" && item.username.trim()) server.username = item.username.trim();
      if (typeof item.credential === "string" && item.credential) server.credential = item.credential;
      servers.push(server);
    }
    return servers;
  } catch {
    return null;
  }
}

/** ICE 服务器可视化编辑:URL 每行一个,用户名/凭据可留空以保留服务端已存值 */
function IceServerList({ servers, write }: { servers: IceServer[]; write: (next: IceServer[]) => void }) {
  const { t } = useI18n();
  const serverKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  while (serverKeys.current.length < servers.length) serverKeys.current.push(`ice-${keySeq.current++}`);
  if (serverKeys.current.length > servers.length) serverKeys.current.length = servers.length;

  const update = (index: number, patch: Partial<IceServer>) =>
    write(servers.map((server, i) => (i === index ? { ...server, ...patch } : server)));

  return (
    <div className="grid gap-2">
      {servers.length === 0 && <p className="text-xs text-muted-foreground">{t("config.settings.ice_empty")}</p>}
      {servers.map((server, index) => (
        <IceServerRow
          key={serverKeys.current[index]}
          index={index}
          server={server}
          onUpdate={(patch) => update(index, patch)}
          onRemove={() => {
            serverKeys.current.splice(index, 1);
            write(servers.filter((_, i) => i !== index));
          }}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit gap-1 text-xs"
        onClick={() => write([...servers, { urls: [] }])}
      >
        <Plus className="size-3.5" />
        {t("config.settings.ice_add")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("config.settings.ice_hint")}</p>
    </div>
  );
}

/** 单条 ICE 服务器;URL 文本保留本地原始输入,避免输入换行时被立即过滤 */
function IceServerRow({
  index,
  server,
  onUpdate,
  onRemove,
}: {
  index: number;
  server: IceServer;
  onUpdate: (patch: Partial<IceServer>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const [urlsText, setUrlsText] = useState(server.urls.join("\n"));

  const writeUrls = (text: string) => {
    setUrlsText(text);
    onUpdate({
      urls: text
        .split("\n")
        .map((url) => url.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("config.settings.ice_server", { index: index + 1 })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          title={t("config.settings.list_remove")}
          aria-label={t("config.settings.list_remove")}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-urls`}>{t("config.settings.ice_urls")}</Label>
        <Textarea
          id={`${uid}-urls`}
          value={urlsText}
          onChange={(event) => writeUrls(event.target.value)}
          placeholder={"stun:stun.example.com:3478\nturn:turn.example.com:3478?transport=udp"}
          className="min-h-16 font-mono text-xs"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-username`}>{t("config.settings.ice_username")}</Label>
          <Input
            id={`${uid}-username`}
            value={server.username ?? ""}
            autoComplete="off"
            onChange={(event) => onUpdate({ username: event.target.value })}
            placeholder={t("config.settings.ice_secret_keep")}
            className="font-mono text-xs"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-credential`}>{t("config.settings.ice_credential")}</Label>
          <Input
            id={`${uid}-credential`}
            type="password"
            value={server.credential ?? ""}
            autoComplete="new-password"
            onChange={(event) => onUpdate({ credential: event.target.value })}
            placeholder={t("config.settings.ice_secret_keep")}
            className="font-mono text-xs"
          />
        </div>
      </div>
    </div>
  );
}

/** 文本 → 认证规则数组;空文本视为空数组 */
export function parseAuthRules(text: string): AuthRule[] | null {
  if (text.trim() === "") return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.every(isRule) ? value : null;
  } catch {
    return null;
  }
}

/** 文本 → 「渠道 -> 条目数组」;空文本视为空对象 */
export function parseChannelEntries(text: string): ChannelEntries | null {
  if (text.trim() === "") return {};
  try {
    const value: unknown = JSON.parse(text);
    return isChannelEntries(value) ? value : null;
  } catch {
    return null;
  }
}

/** 认证规则列表;规则来自 JSON、自身没有 id,这里按行分配稳定 key,只在增删行时变动 */
function AuthRuleList({ rules, write }: { rules: AuthRule[]; write: (next: AuthRule[]) => void }) {
  const { t } = useI18n();
  const ruleKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  while (ruleKeys.current.length < rules.length) ruleKeys.current.push(`rule-${keySeq.current++}`);
  if (ruleKeys.current.length > rules.length) ruleKeys.current.length = rules.length;

  const update = (index: number, patch: AuthRule) =>
    write(
      rules.map((rule, i) => {
        if (i !== index) return rule;
        const next = { ...rule, ...patch };
        // 空串与关闭的开关不落进 JSON,避免堆无意义字段
        for (const [key, value] of Object.entries(patch)) if (value === "" || value === false) delete next[key];
        return next;
      }),
    );

  const setType = (index: number, type: string) =>
    write(
      rules.map((rule, i) => {
        if (i !== index) return rule;
        const keep = ["match", "apply_to", "allow_insecure", ...(AUTH_TYPE_FIELDS[type] ?? [])];
        const next: AuthRule = {};
        for (const key of Object.keys(rule)) if (keep.includes(key)) next[key] = rule[key];
        if (type !== "none") next.type = type;
        return next;
      }),
    );

  const toggleApply = (index: number, kind: string, checked: boolean) =>
    write(
      rules.map((rule, i) => {
        if (i !== index) return rule;
        const current = Array.isArray(rule.apply_to)
          ? rule.apply_to.filter((value): value is string => typeof value === "string")
          : [];
        const picked = checked ? [...current, kind] : current.filter((value) => value !== kind);
        const next = { ...rule };
        // 一项都不选等于对所有请求生效,直接省略该字段
        const ordered = AUTH_APPLY_TO.filter((value) => picked.includes(value));
        if (ordered.length === 0) delete next.apply_to;
        else next.apply_to = ordered;
        return next;
      }),
    );

  return (
    <div className="grid gap-2">
      {rules.length === 0 && <p className="text-xs text-muted-foreground">{t("config.settings.auth_empty")}</p>}
      {rules.map((rule, index) => (
        <AuthRuleCard
          key={ruleKeys.current[index]}
          index={index}
          rule={rule}
          onRemove={() => {
            ruleKeys.current.splice(index, 1);
            write(rules.filter((_, i) => i !== index));
          }}
          onUpdate={(patch) => update(index, patch)}
          onTypeChange={(type) => setType(index, type)}
          onToggleApply={(kind, checked) => toggleApply(index, kind, checked)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit gap-1 text-xs"
        onClick={() => write([...rules, {}])}
      >
        <Plus className="size-3.5" />
        {t("config.settings.auth_add_rule")}
      </Button>
    </div>
  );
}

/** 单条认证规则的编辑卡片 */
function AuthRuleCard({
  index,
  rule,
  onUpdate,
  onTypeChange,
  onToggleApply,
  onRemove,
}: {
  index: number;
  rule: AuthRule;
  onRemove: () => void;
  onUpdate: (patch: AuthRule) => void;
  onTypeChange: (type: string) => void;
  onToggleApply: (kind: string, checked: boolean) => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const type = typeof rule.type === "string" && rule.type !== "" ? rule.type : "none";
  const applies = Array.isArray(rule.apply_to)
    ? rule.apply_to.filter((value): value is string => typeof value === "string")
    : [];
  const textField = (key: string) => (typeof rule[key] === "string" ? (rule[key] as string) : "");

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("config.settings.auth_rule", { index: index + 1 })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          title={t("config.settings.list_remove")}
          aria-label={t("config.settings.list_remove")}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-match`}>{t("config.settings.auth_match")}</Label>
        <Input
          id={`${uid}-match`}
          value={textField("match")}
          onChange={(e) => onUpdate({ match: e.target.value })}
          placeholder="https://plugins.example.com/"
          className="font-mono text-xs"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("config.settings.auth_apply_to")}</Label>
        <div className="flex flex-wrap items-center gap-4">
          {AUTH_APPLY_TO.map((kind) => (
            <label key={kind} htmlFor={`${uid}-apply-${kind}`} className="flex items-center gap-2 text-xs">
              <Checkbox
                id={`${uid}-apply-${kind}`}
                checked={applies.includes(kind)}
                onCheckedChange={(checked) => onToggleApply(kind, checked === true)}
              />
              {t(`config.settings.auth_apply_${kind}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("config.settings.auth_apply_hint")}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-type`}>{t("config.settings.auth_type")}</Label>
        <Select
          items={AUTH_TYPES.map((value) => ({ value, label: t(`config.settings.auth_type_${value}`) }))}
          value={type}
          onValueChange={(value) => value && onTypeChange(value)}
        >
          <SelectTrigger id={`${uid}-type`} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTH_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`config.settings.auth_type_${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(AUTH_TYPE_FIELDS[type] ?? []).map((key) => (
        <div key={key} className="grid gap-1.5">
          <Label htmlFor={`${uid}-${key}`}>{t(`config.settings.auth_field_${key}` as never)}</Label>
          <Input
            id={`${uid}-${key}`}
            value={textField(key)}
            onChange={(e) => onUpdate({ [key]: e.target.value })}
            className="font-mono text-xs"
          />
        </div>
      ))}

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${uid}-insecure`}>{t("config.settings.auth_allow_insecure")}</Label>
        <Switch
          id={`${uid}-insecure`}
          checked={rule.allow_insecure === true}
          onCheckedChange={(checked) => onUpdate({ allow_insecure: checked })}
        />
      </div>
    </div>
  );
}

/** 「渠道 -> 条目数组」可视化编辑,如 oauth.settings、oauth.request-scoped-errors */
function ChannelEntriesField({
  value,
  write,
  fields,
}: {
  value: ChannelEntries;
  write: (next: ChannelEntries) => void;
  fields: EntryFieldSpec[];
}) {
  const { t } = useI18n();
  const channels = Object.entries(value);
  // 渠道名是对象的键、没有天然 id,按行分配稳定 key,只在增删渠道时变动
  const channelKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  while (channelKeys.current.length < channels.length) channelKeys.current.push(`channel-${keySeq.current++}`);
  if (channelKeys.current.length > channels.length) channelKeys.current.length = channels.length;

  const replace = (index: number, name: string, entries: AuthRule[]) => {
    const next: ChannelEntries = {};
    channels.forEach(([key, current], i) => {
      next[i === index ? name : key] = i === index ? entries : current;
    });
    write(next);
  };

  const addChannel = () => {
    let i = 1;
    while (`channel-${i}` in value) i++;
    write({ ...value, [`channel-${i}`]: [] });
  };

  return (
    <div className="grid gap-2">
      {channels.length === 0 && <p className="text-xs text-muted-foreground">{t("config.settings.channel_empty")}</p>}
      {channels.map(([channel, entries], index) => (
        <div key={channelKeys.current[index]} className="grid gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Input
              value={channel}
              aria-label={t("config.settings.channel_name")}
              placeholder="codex"
              onChange={(e) => replace(index, e.target.value, entries)}
              className="h-7 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              title={t("config.settings.channel_remove")}
              aria-label={t("config.settings.channel_remove")}
              onClick={() => {
                channelKeys.current.splice(index, 1);
                const next: ChannelEntries = {};
                channels.forEach(([key, current], i) => {
                  if (i !== index) next[key] = current;
                });
                write(next);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <EntryList entries={entries} fields={fields} onChange={(next) => replace(index, channel, next)} />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-7 w-fit gap-1 text-xs" onClick={addChannel}>
        <Plus className="size-3.5" />
        {t("config.settings.channel_add")}
      </Button>
    </div>
  );
}

/** 某个渠道下的条目列表 */
function EntryList({
  entries,
  fields,
  onChange,
}: {
  entries: AuthRule[];
  fields: EntryFieldSpec[];
  onChange: (next: AuthRule[]) => void;
}) {
  const { t } = useI18n();
  const entryKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  while (entryKeys.current.length < entries.length) entryKeys.current.push(`entry-${keySeq.current++}`);
  if (entryKeys.current.length > entries.length) entryKeys.current.length = entries.length;

  const update = (index: number, key: string, raw: unknown) =>
    onChange(
      entries.map((entry, i) => {
        if (i !== index) return entry;
        const next = { ...entry };
        // 空值不落进 JSON,避免堆无意义字段
        if (raw === "" || raw === undefined || (Array.isArray(raw) && raw.length === 0)) delete next[key];
        else next[key] = raw;
        return next;
      }),
    );

  return (
    <div className="grid gap-2">
      {entries.map((entry, index) => (
        <div key={entryKeys.current[index]} className="grid gap-3 rounded-lg border border-dashed p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("config.settings.channel_entry", { index: index + 1 })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              title={t("config.settings.list_remove")}
              aria-label={t("config.settings.list_remove")}
              onClick={() => {
                entryKeys.current.splice(index, 1);
                onChange(entries.filter((_, i) => i !== index));
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          {fields.map((field) => (
            <EntryField
              key={field.key}
              field={field}
              value={entry[field.key]}
              onChange={(raw) => update(index, field.key, raw)}
            />
          ))}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit gap-1 text-xs"
        onClick={() => onChange([...entries, {}])}
      >
        <Plus className="size-3.5" />
        {t("config.settings.channel_entry_add")}
      </Button>
    </div>
  );
}

/** 单个条目字段;数字输入保留中间态,避免打到一半就被规范化 */
function EntryField({
  field,
  value,
  onChange,
}: {
  field: EntryFieldSpec;
  value: unknown;
  onChange: (raw: unknown) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const external = value === undefined || value === null ? "" : String(value);
  const [text, setText] = useState(external);
  const emitted = useRef(external);
  if (external !== emitted.current) {
    emitted.current = external;
    setText(external);
  }

  const label = t(`config.settings.entry_${field.key}` as never);

  if (field.kind === "list") {
    const lines = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").join("\n")
      : "";
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <ListField
          id={id}
          labelId={id}
          text={lines}
          invalid={false}
          onChange={(next) =>
            onChange(
              next
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            )
          }
        />
      </div>
    );
  }

  if (field.kind === "select") {
    const options = field.options ?? [];
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Select
          items={options.map((option) => ({ value: option, label: option }))}
          value={external || null}
          onValueChange={(next) => next && onChange(next)}
        >
          <SelectTrigger id={id} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const numeric = field.kind === "int";
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode={numeric ? "numeric" : undefined}
        value={numeric ? text : external}
        onChange={(e) => {
          if (!numeric) {
            onChange(e.target.value);
            return;
          }
          setText(e.target.value);
          const raw = e.target.value.trim();
          if (raw === "") {
            emitted.current = "";
            onChange("");
          } else if (/^-?\d+$/.test(raw)) {
            emitted.current = String(Number(raw));
            onChange(Number(raw));
          }
          // 非法中间态只留在输入框,不写进 JSON
        }}
        className={numeric ? "font-mono text-xs" : "text-xs"}
      />
    </div>
  );
}
