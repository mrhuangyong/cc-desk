import type { Project } from '../src/renderer/types'

// 测试专用种子数据（不属于生产 mockData）。reducer/组件测试基于这套已知结构：
// p1=cc-desk 含 s1（2 条消息）+ s2（空）；p2=个人博客 含 s3（1 条消息）。
export const seedProjects: Project[] = [
  {
    id: 'p1',
    name: 'cc-desk',
    sessions: [
      {
        id: 's1',
        title: '重构登录流程',
        messages: [
          { id: 'm1', role: 'user', content: [{ type: 'text', text: '帮我把登录改成 token 刷新机制' }] },
          { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '好的，我先看一下当前的 auth 逻辑……' }] },
        ],
      },
      { id: 's2', title: '修样式 bug', messages: [] },
    ],
  },
  {
    id: 'p2',
    name: '个人博客',
    sessions: [
      {
        id: 's3',
        title: '部署到 Vercel',
        messages: [{ id: 'm3', role: 'user', content: [{ type: 'text', text: '怎么部署？' }] }],
      },
    ],
  },
]
