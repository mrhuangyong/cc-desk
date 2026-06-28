# Mobile/Desktop Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the first batch of mobile/desktop interaction gaps so mobile sends are trustworthy, queued sends preserve parameters, notices render, and project lists open cleanly.

**Architecture:** Keep the existing PWA/relay/desktop bridge boundaries. Change only the PWA state contract where needed: `useSessionChat` owns chat send lifecycle and queue payloads, `App` owns draft/attachment preservation, and page components render affordances without touching transport.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing remote protocol.

---

### Task 1: Sending Safety And Image-Only Messages

**Files:**
- Modify: `web/src/hooks/useSessionChat.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/ChatPage.tsx`
- Test: `web/src/hooks/useSessionChat.test.tsx`
- Test: `web/src/pages/ChatPage.test.tsx`

- [x] Write failing tests that `sendMessage` accepts image-only messages, returns send success/failure, and does not echo/running on `send=false`.
- [x] Write failing tests that `ChatPage` enables send when attachments exist.
- [x] Implement `sendMessage(): Promise<boolean>` and text-or-image send gating.
- [x] Update `App.handleSend` to clear input/attachments only after `sendMessage` returns true.
- [x] Run focused tests for `useSessionChat` and `ChatPage`.

### Task 2: Queue Preserves Full Send Payload

**Files:**
- Modify: `web/src/hooks/useSessionChat.ts`
- Modify: `web/src/pages/ChatPage.tsx`
- Test: `web/src/hooks/useSessionChat.test.tsx`
- Test: `web/src/pages/ChatPage.test.tsx`

- [x] Write failing tests that queue mode preserves permission, thinking, images, and queued display text.
- [x] Replace queue `string[]` with payload objects containing text and send options.
- [x] Ensure guide mode delayed send also uses full options.
- [x] Run focused tests.

### Task 3: Notices Render On Mobile

**Files:**
- Modify: `web/src/hooks/useSessionChat.ts`
- Modify: `web/src/pages/ChatPage.tsx`
- Test: `web/src/hooks/useSessionChat.test.tsx`
- Test: `web/src/pages/ChatPage.test.tsx`

- [x] Write failing tests for `session.notice` ingestion and rendering.
- [x] Add a lightweight notice message type and render it as a small system row.
- [x] Run focused tests.

### Task 4: Project List First Arrival Expansion

**Files:**
- Modify: `web/src/pages/ProjectListPage.tsx`
- Test: `web/src/pages/ProjectListPage.test.tsx`

- [x] Write failing test that first async groups arrival expands the first project.
- [x] Add an effect that opens the first project when groups transition from empty to non-empty.
- [x] Run focused tests.

### Task 5: Verification

**Files:**
- No new files.

- [x] Run `pnpm --dir web test -- web/src/hooks/useSessionChat.test.tsx web/src/pages/ChatPage.test.tsx web/src/pages/ProjectListPage.test.tsx`.
- [x] Run `pnpm --dir web build`.
- [x] Run `npx tsc --noEmit`.
- [x] Run `git diff --check`.
