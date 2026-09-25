# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Software developers using Foundry Desktop to do AI-assisted coding work across local project folders.

## Product Purpose

Foundry Desktop is a local-first workspace for coding conversations. It lets developers work with an AI assistant in the context of local projects, continue chats across sessions, choose available models, and follow work as it streams. Success means a developer can move from a project folder to useful, persistent AI-assisted coding work without losing the context of their chats or branches.

## Positioning

A local-first desktop AI workspace connected to the Foundry service: project chats and working state remain organized around the developer's local folders, while the authenticated service provides account access, available models, and assistant responses.

## Operating Context

Developers use the app as a desktop companion to local coding projects. Chats are organized around projects and folders, can be continued across sessions, and may include branches, drafts, queued messages, streaming responses, model selection, and usage information. Sign-in begins in the system browser and returns to the desktop app.

## Capabilities and Constraints

- The product is an Electron desktop application with a renderer UI and a main-process boundary.
- Chats are project-local and persisted on the device so multiple chats can work in the same project folder.
- Chat history supports branches, drafts, queued messages, streaming state, archiving, and deletion confirmation.
- The app depends on an authenticated Foundry service for account state and available model-backed assistant work.
- Preserve the existing terminology: chats, projects, branches, models, usage, and drafts.
- Desktop-native behavior, including system-browser authentication and keyboard-oriented interaction, is a first-class constraint.

## Brand Commitments

- Product name: Foundry.
- Preserve the established Foundry terminology used throughout the desktop experience.

## Evidence on Hand

- Existing desktop implementation under `apps/desktop/src`.
- Chat, project, branch, draft, model, usage, authentication, and streaming flows are represented in the current renderer and main-process code.
- Local thread and project persistence is implemented in `apps/desktop/src/main/db/threads.ts`.
- Existing visual implementation is the authority for the current interface until it is documented or intentionally replaced.

## Product Principles

- Keep coding context close to the developer's local project.
- Preserve continuity across chats, branches, drafts, and sessions.
- Make active work and streaming progress legible without interrupting the developer.
- Treat authentication and service state as part of the product experience, not incidental plumbing.
- Favor desktop-native, keyboard-friendly workflows.
