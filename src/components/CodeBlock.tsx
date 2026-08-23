import { useEffect, useRef, useState } from "react";
import { copyText } from "../app/clipboard";

type CopyState = "idle" | "copied" | "failed";

export function CodeBlock({ code }: { code: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onCopy(): Promise<void> {
    const ok = await copyText(code);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1800);
  }

  return (
    <div className="code-block">
      <button className="code-copy" onClick={onCopy}>
        {state === "idle" ? "Copy" : state === "copied" ? "Copied" : "Copy failed"}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
