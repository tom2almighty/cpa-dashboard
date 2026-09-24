import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { useTheme } from "next-themes";

// 让编辑器背景、边框跟随面板的颜色 token
const blend = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "13px" },
  ".cm-gutters": { backgroundColor: "transparent", borderRight: "1px solid var(--border)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)" },
});

const LANGUAGES = { yaml: yaml(), json: json() };

export function CodeEditor({
  value,
  onChange,
  language,
  height,
  onSave,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  language: keyof typeof LANGUAGES;
  height: string;
  onSave?: () => void;
  label: string;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <div
      className="overflow-hidden rounded-lg border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
      onKeyDownCapture={(e) => {
        if (onSave && (e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          onSave();
        }
      }}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        height={height}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        extensions={[LANGUAGES[language], blend, EditorView.contentAttributes.of({ "aria-label": label })]}
        basicSetup={{ foldGutter: true, highlightActiveLine: true }}
      />
    </div>
  );
}
