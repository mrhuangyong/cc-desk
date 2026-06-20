// Hook 编辑弹窗：支持 command / prompt / agent / http 四种类型，切换 tab 展示不同字段。
import { useState } from 'react'
import { X } from 'lucide-react'
import type { HookEntry } from '../../../main/claude-config'

interface Props {
  entry: HookEntry | null       // null=新建
  onSave: (entry: HookEntry) => void
  onCancel: () => void
}

type HookType = 'command' | 'prompt' | 'agent' | 'http'

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
  display: 'grid', placeItems: 'center',
}
const dialogStyle: React.CSSProperties = {
  width: 520, maxHeight: '85vh', overflowY: 'auto',
  background: 'var(--bg-sidebar)', borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-float)', padding: 20,
}
const labelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4, marginTop: 12 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: 'var(--bg)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)',
  fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
}
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'var(--font-mono)' }
const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 16px', fontSize: 12, cursor: 'pointer', border: 'none',
  background: 'transparent', color: active ? 'var(--accent)' : 'var(--text-muted)',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
})
const primaryBtn: React.CSSProperties = {
  padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)',
  background: 'var(--accent)', color: 'var(--accent-text)',
}
const ghostBtn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)',
}

export function HookEditDialog({ entry, onSave, onCancel }: Props) {
  const [type, setType] = useState<HookType>(entry?.type ?? 'command')
  const [command, setCommand] = useState((entry as any)?.command ?? '')
  const [prompt, setPrompt] = useState((entry as any)?.prompt ?? '')
  const [url, setUrl] = useState((entry as any)?.url ?? '')
  const [ifCond, setIfCond] = useState((entry as any)?.if ?? '')
  const [timeout, setTimeoutVal] = useState<string>((entry as any)?.timeout != null ? String((entry as any).timeout) : '')
  const [model, setModel] = useState((entry as any)?.model ?? '')
  const [shell, setShell] = useState<'bash' | 'powershell'>((entry as any)?.shell ?? 'bash')
  const [statusMessage, setStatusMessage] = useState((entry as any)?.statusMessage ?? '')
  const [headers, setHeaders] = useState(
    (entry as any)?.headers ? Object.entries((entry as any).headers).map(([k, v]) => `${k}: ${v}`).join('\n') : ''
  )
  const [allowedEnvVars, setAllowedEnvVars] = useState(
    Array.isArray((entry as any)?.allowedEnvVars) ? ((entry as any).allowedEnvVars as string[]).join(', ') : ''
  )
  const [isAsync, setIsAsync] = useState((entry as any)?.async ?? false)
  const [asyncRewake, setAsyncRewake] = useState((entry as any)?.asyncRewake ?? false)
  const [once, setOnce] = useState((entry as any)?.once ?? false)
  const [error, setError] = useState<string | null>(null)

  const parseHeaderLines = (text: string): Record<string, string> => {
    const obj: Record<string, string> = {}
    ;(text || '').split('\n').forEach(line => {
      const i = line.indexOf(':')
      if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    })
    return obj
  }

  const handleSave = () => {
    setError(null)
    const base: any = { type }
    if (ifCond) base.if = ifCond
    if (timeout) { const n = Number(timeout); if (!isNaN(n) && n > 0) base.timeout = n }
    if (statusMessage) base.statusMessage = statusMessage
    if (once) base.once = true

    if (type === 'command') {
      if (!command.trim()) { setError('command 不能为空'); return }
      base.command = command
      base.shell = shell
      if (isAsync) base.async = true
      if (asyncRewake) base.asyncRewake = true
    } else if (type === 'prompt') {
      if (!prompt.trim()) { setError('prompt 不能为空'); return }
      base.prompt = prompt
      if (model) base.model = model
    } else if (type === 'agent') {
      if (!prompt.trim()) { setError('prompt 不能为空'); return }
      base.prompt = prompt
      if (model) base.model = model
    } else if (type === 'http') {
      if (!url.trim()) { setError('url 不能为空'); return }
      base.url = url
      const hdrs = parseHeaderLines(headers)
      if (Object.keys(hdrs).length) base.headers = hdrs
      const vars = allowedEnvVars.split(',').map(s => s.trim()).filter(Boolean)
      if (vars.length) base.allowedEnvVars = vars
    }
    onSave(base as HookEntry)
  }

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={dialogStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{entry ? '编辑 Hook' : '新建 Hook'}</span>
          <button onClick={onCancel} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
          {(['command', 'prompt', 'agent', 'http'] as HookType[]).map(t => (
            <button key={t} onClick={() => setType(t)} style={tabStyle(type === t)}>{t}</button>
          ))}
        </div>

        {type === 'command' && (
          <>
            <div style={labelStyle}>命令</div>
            <textarea value={command} onChange={e => setCommand(e.target.value)} placeholder="echo 'hook triggered'" style={textareaStyle} />
            <div style={labelStyle}>Shell</div>
            <select value={shell} onChange={e => setShell(e.target.value as 'bash' | 'powershell')} style={inputStyle}>
              <option value="bash">bash</option>
              <option value="powershell">powershell</option>
            </select>
            <div style={labelStyle}>异步（async）</div>
            <input type="checkbox" checked={isAsync} onChange={e => setIsAsync(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>后台运行不阻塞</span>
            <div style={labelStyle}>asyncRewake（后台 + 出错时唤醒）</div>
            <input type="checkbox" checked={asyncRewake} onChange={e => setAsyncRewake(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
          </>
        )}
        {type === 'prompt' && (
          <>
            <div style={labelStyle}>提示词</div>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="分析以下内容并给出建议：$ARGUMENTS" style={textareaStyle} />
            <div style={labelStyle}>模型（可选）</div>
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-4-6" style={inputStyle} />
          </>
        )}
        {type === 'agent' && (
          <>
            <div style={labelStyle}>验证提示词</div>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="验证单元测试是否运行并通过" style={textareaStyle} />
            <div style={labelStyle}>模型（可选）</div>
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-4-6" style={inputStyle} />
          </>
        )}
        {type === 'http' && (
          <>
            <div style={labelStyle}>URL</div>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/webhook" style={inputStyle} />
            <div style={labelStyle}>Headers（每行 KEY: VALUE）</div>
            <textarea value={headers} onChange={e => setHeaders(e.target.value)} placeholder={'Authorization: Bearer $TOKEN'} style={textareaStyle} />
            <div style={labelStyle}>allowedEnvVars（逗号分隔）</div>
            <input value={allowedEnvVars} onChange={e => setAllowedEnvVars(e.target.value)} placeholder="TOKEN, API_KEY" style={inputStyle} />
          </>
        )}

        <div style={labelStyle}>条件 if（权限规则语法，如 Bash(git *)）</div>
        <input value={ifCond} onChange={e => setIfCond(e.target.value)} placeholder="Bash(git *)" style={inputStyle} />
        <div style={labelStyle}>超时（秒）</div>
        <input value={timeout} onChange={e => setTimeoutVal(e.target.value)} placeholder="60" style={inputStyle} />
        <div style={labelStyle}>状态消息</div>
        <input value={statusMessage} onChange={e => setStatusMessage(e.target.value)} placeholder="运行中..." style={inputStyle} />
        <div style={labelStyle}>once（运行一次后删除）</div>
        <input type="checkbox" checked={once} onChange={e => setOnce(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />

        {error && <div style={{ marginTop: 10, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={ghostBtn}>取消</button>
          <button onClick={handleSave} style={primaryBtn}>保存</button>
        </div>
      </div>
    </div>
  )
}
