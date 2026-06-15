import type { Project, FileNode } from '../types'

export const mockProjects: Project[] = [
  {
    id: 'p1',
    name: 'cc-desk',
    sessions: [
      { id: 's1', title: '重构登录流程', messages: [
        { id: 'm1', role: 'user', content: '帮我把登录改成 token 刷新机制' },
        { id: 'm2', role: 'assistant', content: '好的，我先看一下当前的 auth 逻辑……' }
      ]},
      { id: 's2', title: '修样式 bug', messages: [] }
    ]
  },
  {
    id: 'p2',
    name: '个人博客',
    sessions: [
      { id: 's3', title: '部署到 Vercel', messages: [
        { id: 'm3', role: 'user', content: '怎么部署？' }
      ]}
    ]
  }
]

export const mockFileTrees: Record<string, FileNode[]> = {
  p1: [
    { name: 'src', path: 'src', isDir: true, children: [
      { name: 'main.tsx', path: 'src/main.tsx', isDir: false },
      { name: 'App.tsx', path: 'src/App.tsx', isDir: false },
      { name: 'components', path: 'src/components', isDir: true, children: [
        { name: 'Button.tsx', path: 'src/components/Button.tsx', isDir: false }
      ]}
    ]},
    { name: 'package.json', path: 'package.json', isDir: false }
  ],
  p2: [
    { name: 'index.md', path: 'index.md', isDir: false },
    { name: 'about.md', path: 'about.md', isDir: false }
  ]
}

// mock 文件内容（按路径）
export const mockFileContents: Record<string, string> = {
  'src/main.tsx': 'import React from "react"\nimport App from "./App"\n\nrender(<App />, document.getElementById("root"))',
  'src/App.tsx': 'export default function App() {\n  return <div>Hello</div>\n}',
  'package.json': '{\n  "name": "cc-desk"\n}'
}
