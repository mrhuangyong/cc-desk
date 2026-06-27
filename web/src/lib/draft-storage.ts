// web/src/lib/draft-storage.ts
// 按会话(localSessionId)持久化输入草稿到 localStorage。
// 只存文本(不存图片附件,避开 localStorage 容量限制)。
// PWA 同源持久:切会话/退出/刷新后回到该会话仍能看到未发送输入。
//
// 全程 try/catch + typeof 守卫:隐私模式/SSR/localStorage 禁用时不崩,
// 草稿不持久但不影响输入功能(对齐 useTheme.ts 的容错模式)。

const PREFIX = 'cc-desk-draft:'

/** 读取某会话的草稿文本。无则返回空串。localStorage 不可用时静默返回 ''。 */
export function loadDraft(localSessionId: string): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    return localStorage.getItem(PREFIX + localSessionId) ?? ''
  } catch {
    return ''
  }
}

/** 保存某会话草稿。text 为空则删除该 key(避免残留空草稿)。localStorage 不可用时静默。 */
export function saveDraft(localSessionId: string, text: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (text) localStorage.setItem(PREFIX + localSessionId, text)
    else localStorage.removeItem(PREFIX + localSessionId)
  } catch {
    // 隐私模式/容量满/禁用时静默(草稿不持久,但不影响输入)
  }
}

/** 清除某会话草稿(发送后/归档后调用)。localStorage 不可用时静默。 */
export function clearDraft(localSessionId: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(PREFIX + localSessionId)
  } catch {
    // 静默
  }
}
