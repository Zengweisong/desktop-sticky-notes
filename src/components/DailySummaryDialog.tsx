import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, Send, X } from "lucide-react";
import type { Note } from "../types/note";
import { localDateKey } from "../services/noteDateService";
import {
  clearDailySummaryConfig, completedTitlesForDate, generateDailySummary, loadDailySummaryConfig,
  saveDailySummaryConfig, type DailySummaryConfig
} from "../services/dailySummaryService";

interface Props { open: boolean; notes: readonly Note[]; onClose: () => void; }

export function DailySummaryDialog({ open, notes, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("帮我总结一下今日完成的代办事项");
  const [config, setConfig] = useState<DailySummaryConfig | null>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"saving" | "generating" | null>(null);
  const [error, setError] = useState("");
  const [report, setReport] = useState<{ date: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const date = localDateKey(new Date());
  const titles = open ? completedTitlesForDate(notes, date) : [];
  const text = report?.date === date ? report.text : "";

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) {
      element.showModal();
      promptInput.current?.focus({ preventScroll: true });
    }
    if (!open && element?.open) {
      const password = element.querySelector<HTMLInputElement>('input[name="apiKey"]');
      if (password) password.value = "";
      element.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open || config !== undefined) return;
    let active = true;
    loadDailySummaryConfig().then((loaded) => {
      if (active) setConfig(loaded);
    }).catch((error) => {
      if (!active) return;
      setConfig(null);
      setError(String(error));
    });
    return () => { active = false; };
  }, [open, config]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy("saving");
    setError("");
    try {
      const next = await saveDailySummaryConfig({
        endpoint: String(fields.get("endpoint") ?? ""),
        model: String(fields.get("model") ?? "")
      }, String(fields.get("apiKey") ?? ""));
      setConfig(next);
      setEditing(false);
    } catch (error) { setError(String(error)); }
    finally { setBusy(null); }
  }

  async function clear() {
    setBusy("saving");
    setError("");
    try { await clearDailySummaryConfig(); setConfig(null); setEditing(false); }
    catch (error) { setError(String(error)); }
    finally { setBusy(null); }
  }

  async function generate() {
    if (!config || !prompt.trim() || busy) return;
    if (!titles.length) {
      setError("今天还没有已完成的待办事项，完成事项后再来总结吧。");
      return;
    }
    setBusy("generating");
    setError("");
    setCopied(false);
    try { setReport({ date, text: await generateDailySummary(date, titles, prompt.trim()) }); }
    catch (error) { setError(String(error)); }
    finally { setBusy(null); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setError("无法访问剪贴板，可选中正文手动复制"); }
  }

  return <dialog ref={dialog} className="daily-summary-dialog" aria-labelledby="daily-summary-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="drawer-header">
      <div><h2 id="daily-summary-title">AI 日报</h2><p>回顾一天完成的事项</p></div>
      <button type="button" aria-label="关闭 AI 日报" onClick={onClose}><X size={18} /></button>
    </div>
    <div className="drawer-content summary-content">
      <label className="summary-prompt">给 AI 的提示词
        <textarea ref={promptInput} value={prompt} rows={3} maxLength={2000} disabled={!!busy}
          placeholder="描述希望 AI 如何总结这些事项"
          onChange={(event) => { setPrompt(event.target.value); setError(""); }} />
      </label>
      {config === undefined ? <p role="status">正在读取 AI 配置…</p> : editing || !config ?
        <form key={config?.endpoint} className="summary-config" onSubmit={save}>
          <label>API 地址<input type="url" name="endpoint" required defaultValue={config?.endpoint}
            placeholder="https://api.openai.com/v1" maxLength={1024} /></label>
          <label>模型<input name="model" required defaultValue={config?.model} maxLength={256} placeholder="填写服务商的模型 ID" /></label>
          <label>API 密钥<input type="password" name="apiKey" required={!config} autoComplete="off"
            maxLength={1024} placeholder={config ? "留空保留当前密钥" : "填写服务商的 API 密钥"} /></label>
          <p>配置保存在 Windows 凭据管理器。更换 API 地址时，请填写对应的密钥。</p>
          <div className="summary-actions">
            <button className="summary-primary" disabled={!!busy} type="submit">{busy ? "正在保存…" : "保存配置"}</button>
            {config && <>
              <button type="button" disabled={!!busy} onClick={() => { setEditing(false); setError(""); }}>取消</button>
              <button type="button" disabled={!!busy} onClick={() => void clear()}>清除配置</button>
            </>}
          </div>
        </form> : <>
          <div className="summary-actions">
            <button className="summary-primary" type="button" disabled={!!busy || !prompt.trim()}
              onClick={() => void generate()}><Send size={15} />{busy ? "发送中…" : "发送"}</button>
            <button type="button" disabled={!!busy} onClick={() => { setEditing(true); setError(""); }}>编辑 AI 配置</button>
          </div>
          {busy === "generating" && <p role="status">正在整理已完成事项…</p>}
          {text && <section className="summary-result" aria-label="生成的日报">
            <div className="summary-result-heading"><strong>{date} 日报</strong>
              <button type="button" onClick={() => void copy()}><Copy size={14} />{copied ? "已复制" : "复制"}</button></div>
            <p>{text}</p>
          </section>}
        </>}
      {error && <p className="summary-error" role="alert">{error}</p>}
    </div>
  </dialog>;
}
