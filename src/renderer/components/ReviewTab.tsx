// 审查 tab：三栏 git 客户端。文件列表 + diff + commit。
// cwd/projectId 绑定当前激活会话所属项目（复用 resolveTerminalCwd 的反查模式）。
import { useEffect, useCallback } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useStore } from '../state/store'
import { DiffView } from './review/DiffView'
import { FileStatusList } from './review/FileStatusList'
import { CommitBar } from './review/CommitBar'
import { translate, type Lang } from '../i18n'
import type { DiffScope } from '../types'

export function ReviewTab() {
  const { state, dispatch } = useStore()
  const sessionId = state.activeSessionId
  // 反查激活会话所属项目（同 resolveTerminalCwd 模式）
  const project = state.projects.find(p => p.sessions.some(s => s.id === sessionId))
  const cwd = project?.path
  const projectId = project?.id ?? ''
  const review = state.reviewByProject[projectId]
  // settings.lang 在类型上是 string（支持未来扩展），运行时只有 zh-CN/en，收敛到 Lang
  const lang = state.settings.lang as Lang
  // 复用 i18n/index.ts 的 translate，不内联字典（DRY）
  const t = (k: string) => translate(lang, k)

  const refreshStatus = useCallback(async () => {
    if (!cwd) return
    dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { loadingStatus: true } })
    dispatch({ type: 'REVIEW_CLEAR_DIFF_CACHE', projectId })
    try {
      const status = await window.api.git.status(cwd)
      dispatch({ type: 'REVIEW_SET_STATUS', projectId, status })
      dispatch({ type: 'REVIEW_SET_ERROR', projectId, error: null })
    } catch (err: any) {
      // err.code 经 IPC 结构化克隆可能为 undefined（Error 非标准属性可能丢失），兜底
      dispatch({ type: 'REVIEW_SET_ERROR', projectId, error: { code: (err?.code ?? 'GIT_ERROR'), message: (err?.message ?? String(err)) } })
      dispatch({ type: 'REVIEW_SET_STATUS', projectId, status: [] })
    } finally {
      dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { loadingStatus: false } })
    }
  }, [cwd, projectId, dispatch])

  // 首次进入且无缓存时自动刷新
  useEffect(() => {
    if (cwd && !review) refreshStatus()
  }, [cwd, review, refreshStatus])

  const loadDiff = useCallback(async (path: string) => {
    if (!cwd) return
    const scope: DiffScope = review?.diffScope ?? 'HEAD'
    dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { loadingDiffPath: path } })
    try {
      const d = await window.api.git.diff(cwd, scope, path)
      dispatch({ type: 'REVIEW_SET_DIFF', projectId, path, diff: d })
    } catch {
      dispatch({ type: 'REVIEW_SET_DIFF', projectId, path, diff: '' })
    } finally {
      dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { loadingDiffPath: null } })
    }
  }, [cwd, projectId, review?.diffScope, dispatch])

  const onSelect = (path: string) => {
    dispatch({ type: 'REVIEW_SELECT_FILE', projectId, path })
    if (!review?.diffCache[path]) loadDiff(path)
  }

  const onManualRefresh = () => {
    // 用户主动刷新时清掉旧 notice（commit/reset 自动刷新不清，保留反馈）
    dispatch({ type: 'REVIEW_SET_NOTICE', projectId, notice: null })
    refreshStatus()
  }

  const onToggleStage = async (path: string, currentlyStaged: boolean) => {
    if (!cwd) return
    try {
      if (currentlyStaged) await window.api.git.restore(cwd, [path], true)
      else await window.api.git.add(cwd, [path])
      refreshStatus()
    } catch (err) {
      console.error('[review] stage toggle failed', err)
    }
  }

  const onSubmit = async () => {
    if (!cwd) return
    const msg = review?.commitMessage ?? ''
    let finalMsg = msg
    dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { commitBusy: true } })
    try {
      if (!finalMsg.trim()) {
        const generated = await window.api.git.generateCommitMessage(cwd)
        finalMsg = generated ?? ''
        if (finalMsg) dispatch({ type: 'REVIEW_SET_COMMIT_MESSAGE', projectId, message: finalMsg })
      }
      if (!finalMsg.trim()) return   // 生成也失败 → 不阻塞，用户手填
      const r = await window.api.git.commit(cwd, finalMsg)
      dispatch({ type: 'REVIEW_SET_COMMIT_MESSAGE', projectId, message: '' })
      dispatch({ type: 'REVIEW_SET_NOTICE', projectId, notice: { kind: 'success', text: `${t('review.committed')} ${r.sha}` } })
      refreshStatus()
    } catch (err: any) {
      console.error('[review] commit failed', err)
      dispatch({ type: 'REVIEW_SET_NOTICE', projectId, notice: { kind: 'error', text: (err?.message ?? t('review.commitFailed')) } })
    } finally {
      dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { commitBusy: false } })
    }
  }

  const onGenerate = async () => {
    if (!cwd) return
    dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { commitBusy: true } })
    try {
      const generated = await window.api.git.generateCommitMessage(cwd)
      if (generated) dispatch({ type: 'REVIEW_SET_COMMIT_MESSAGE', projectId, message: generated })
    } catch (err) {
      console.error('[review] generate failed', err)
    } finally {
      dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { commitBusy: false } })
    }
  }

  const onResetHard = async () => {
    if (!cwd) return
    if (!confirm(t('review.confirmReset'))) return   // 阶段 A 用 window.confirm 兜底；Electron 原生 dialog 见 Task 8
    try {
      await window.api.git.resetHard(cwd)
      dispatch({ type: 'REVIEW_SET_NOTICE', projectId, notice: { kind: 'success', text: t('review.resetDone') } })
      refreshStatus()
    } catch (err: any) {
      console.error('[review] reset hard failed', err)
      dispatch({ type: 'REVIEW_SET_NOTICE', projectId, notice: { kind: 'error', text: (err?.message || t('review.resetFailed')) } })
    }
  }

  if (!cwd) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{t('review.noProject')}</div>
  }
  if (review?.error?.code === 'NOT_A_REPO' || review?.error?.code === 'GIT_NOT_FOUND') {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{t('review.notARepo')}</div>
  }

  const selectedDiff = review?.selectedPath ? (review.diffCache[review.selectedPath] ?? '') : ''
  const diffLoading = review?.loadingDiffPath === review?.selectedPath

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
        <button onClick={onManualRefresh} title={t('review.refresh')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}><RefreshCw size={14} /></button>
        <span>{t('review.fileCount').replace('{n}', String(review?.status.length ?? 0))}</span>
        <div style={{ flex: 1 }} />
        <button onClick={onResetHard} title={t('review.reset')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}><Trash2 size={14} /></button>
      </div>
      {/* 本地反馈条：commit/reset 成功(绿)/失败(红)。git 操作不属于会话，故由 ReviewTab 自管 notice */}
      {review?.notice && (
        <div role="status" data-testid="review-notice" style={{
          padding: '4px 10px', fontSize: 12,
          color: review.notice.kind === 'success' ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)',
          background: review.notice.kind === 'success' ? 'var(--success-bg, rgba(22,163,74,0.1))' : 'var(--danger-bg, rgba(220,38,38,0.1))',
          borderBottom: '1px solid var(--border)',
        }}>
          {review.notice.text}
        </div>
      )}
      {/* 主体：左列表 + 右 diff */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
          <FileStatusList
            status={review?.status ?? []}
            selectedPath={review?.selectedPath ?? null}
            loading={review?.loadingStatus ?? false}
            onSelect={onSelect}
            onToggleStage={onToggleStage}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {review?.selectedPath
            ? <DiffView diff={selectedDiff} loading={diffLoading} />
            : <div style={{ padding: 12, color: 'var(--text-muted)' }}>{t('review.selectFileHint')}</div>}
        </div>
      </div>
      {/* 底部 commit */}
      <CommitBar
        message={review?.commitMessage ?? ''}
        busy={review?.commitBusy ?? false}
        lang={lang}
        onMessageChange={(m) => dispatch({ type: 'REVIEW_SET_COMMIT_MESSAGE', projectId, message: m })}
        onGenerate={onGenerate}
        onSubmit={onSubmit}
      />
    </div>
  )
}
