# Claude AI Instructions for QubPiz Project

## General Guidelines

1. **Avoid Pop-ups**: Never use `alert()` or `confirm()` dialogs. They're annoying. Use console logging instead or silent actions.

2. **Update This File Before Major Changes**: Before making significant changes to the codebase, update this file with:
   - What you're about to do
   - Why you're doing it
   - Which files will be affected

   This ensures context is preserved if the session times out.

## Project Context

**QubPiz** is a real-time quiz application with:
- **Backend**: Node.js/Express with PostgreSQL (runs on port 3000)
- **Frontend**: Angular 18 standalone components (runs on port 4200)
- **Architecture**: MC (Quiz Master) controls the game, players join and answer questions

## Multi-Game Session Feature (IN PROGRESS)

### Current Status (as of 2025-10-23)

**Completed Phases**:
- ✅ Phase 1: Database schema with `game_sessions` table
- ✅ Phase 2: Backend session utilities and endpoints
- ✅ Phase 3A: MC UI for creating and managing sessions
- ✅ Phase 3B: Lobby component session support

**What Phase 3B Involved**:
- Added `/lobby` route to Angular routing (was only `/` before)
- Updated lobby component to detect `?session=CODE` query parameter
- Updated `/api/join` and `/api/players` endpoints to support session parameter
- Frontend now loads session info and displays session code in lobby
- Players can join specific sessions via URLs like `/lobby?session=ABC123`

**Key Implementation Details**:
- Session codes are 3-character alphanumeric (e.g., "A3F")
- Sessions auto-expire after 1 hour of inactivity
- Same player names allowed across different sessions
- Both old system (no session) and new system (with session) work simultaneously
- Used `IS NOT DISTINCT FROM` in SQL for proper NULL handling

### Next Steps (Phase 3C) - ✅ COMPLETED

**Phase 3C: Update GameStatusService** ✅
- ✅ Added session code storage in localStorage with `currentSession$` observable
- ✅ Updated polling to include `?session=CODE` parameter when session present
- ✅ Added `setCurrentSession()` and `getCurrentSession()` methods
- ✅ Polling automatically restarts when session changes
- ✅ Lobby component now calls `setCurrentSession()` when loading session URLs
- ✅ Updated backend `/api/game/status` endpoint to support session parameter
- Files: `/workspaces/qubpiz/qubPiz/src/app/game-status-service.ts`, `/workspaces/qubpiz/qubPiz/src/app/lobby/lobby.ts`, `/workspaces/qubpiz/qubPiz/server/index.js`

**What Was Done**: The GameStatusService now stores the current session code in localStorage and includes it in all `/api/game/status` polling requests. The backend endpoint now checks for the session parameter and queries the `game_sessions` table instead of `game_session` when a session is present. This allows session-based games to have independent status tracking.

**Phase 4: Migrate Core Endpoints** ✅ READY FOR TESTING
- Updated core endpoints to support both session-based and legacy modes
- Pattern: Check for `?session=CODE` param, validate session, fall back to `currentQuizId`
- ✅ Migrated `/api/game/toggle-status` (MC start/stop game)
- ✅ Migrated `/api/game/set-round/:id` (MC display round)
- ✅ Updated MC component to store `currentSessionCode` when session created
- ✅ Updated MC `toggleGameStatus()` to pass session parameter
- ✅ Updated round-manager component to receive and pass session parameter
- ✅ Updated round-manager `setDisplayRound()` to pass session parameter
- Files: `/workspaces/qubpiz/qubPiz/server/index.js`, `/workspaces/qubpiz/qubPiz/src/app/mc/mc.ts`, `/workspaces/qubpiz/qubPiz/src/app/mc/round-manager/round-manager.ts`

**Why**: The MC needs to control their specific session's game state, and rounds need to be session-specific.

**Current Testing Status**: ✅ CORE FUNCTIONALITY WORKING

**MC UI Redesign**: ✅ COMPLETED

**Backend Complete**:
- ✅ Added `owner_id` column to `game_sessions` table
- ✅ Updated `/api/sessions/create` to accept and store `owner_id`
- ✅ Added `/api/sessions/my-sessions?owner_id=UUID` endpoint
- ✅ Sessions now created with 'active' status (no 'waiting' status needed)

**Frontend Implementation**: ✅ COMPLETED
- ✅ Generate UUID for MC in localStorage (`getOrCreateOwnerId()`)
- ✅ Added view mode state (`session-lobby` | `session-control`)
- ✅ Added `mySessions`, `selectedSession` properties
- ✅ Added `loadMySessions()` method to fetch MC's sessions
- ✅ Updated `createGameSession()` to pass `owner_id` and auto-enter session
- ✅ Added `enterSession()` and `exitSession()` methods
- ✅ Built HTML templates for two view modes
- ✅ Removed "Start Game/Open Lobby" button (not needed with sessions)
- ✅ Added session code input box on player entry page
- ✅ Fixed lobby to always show when valid session exists

**What's Working**:
- MC gets unique owner ID on first visit
- MC can create sessions (automatically set to 'active')
- MC sees only their own sessions
- MC can enter/exit sessions
- Players can enter session codes manually
- Players stay in lobby after joining a session
- No more "game active" checks for sessions

**Phase 5: Marking Endpoints Migration** ✅ COMPLETED

All marking endpoints have been updated to support both session-based and legacy modes:
- ✅ `/api/marking/toggle-mode` - Toggle marking mode for session/quiz
- ✅ `/api/marking/trigger-all-rounds` - Create marking assignments for session
- ✅ `/api/marking/assignments/:playerName` - Get assignments for player in session
- ✅ `/api/marking/results` - Get marking results for session
- ✅ `/api/marking/clear` - Clear marking data for session
- ✅ MC frontend updated to pass `?session=CODE` parameter to all marking endpoints

**Phase 6: Player Answer Endpoints Migration** ✅ COMPLETED

All player answer endpoints have been updated to support sessions:
- ✅ `/api/answers/submit` - Now accepts `?session=CODE` parameter and stores `session_id`
- ✅ `/api/answers/:playerName/:roundId` - Retrieves answers filtered by session
- ✅ Updated `round.ts` component to pass session parameter when saving/loading answers
- ✅ Updated marking assignment logic to use players table instead of player_answers

**Key Changes**:
- Answer submissions now include `session_id` in the database
- Unique constraint changed from `(player_name, question_id)` to `(session_id, player_name, question_id)`
- Marking assignments created for all joined players, not just players with answers

**Remaining Work**:
- Migrate `/api/rounds` endpoints (GET, POST, DELETE) for full session support

## Common Issues and Solutions

### Issue: Blank Screen on Session URL
**Cause**: Missing `/lobby` route in Angular routing
**Solution**: Added `{ path: 'lobby', component: Lobby }` to app.routes.ts

### Issue: Players Stuck After "Close Lobby"
**Cause**: `isActive` only checked for `status === 'active'`
**Solution**: Changed to `status === 'active' || status === 'closed'` in index.js:425

### Issue: Players Can't Join After Schema Migration
**Cause**: UNIQUE constraint changed from `(name)` to `(session_id, name)`
**Solution**: Updated `/api/join` to use explicit checks instead of `ON CONFLICT`

## File Locations

**Key Files**:
- Backend: `/workspaces/qubpiz/qubPiz/server/index.js`
- Frontend App: `/workspaces/qubpiz/qubPiz/src/app/`
- Routes: `/workspaces/qubpiz/qubPiz/src/app/app.routes.ts`
- Lobby: `/workspaces/qubpiz/qubPiz/src/app/lobby/lobby.ts`
- MC Panel: `/workspaces/qubpiz/qubPiz/src/app/mc/mc.ts`
- Game Status: `/workspaces/qubpiz/qubPiz/src/app/game-status-service.ts`
- Master CSS: `/workspaces/qubpiz/qubPiz/src/styles.css`
- Implementation Plan: `/workspaces/qubpiz/MULTI_GAME_SESSION_PLAN.md`

## Running the Application

**Start Backend**:
```bash
cd /workspaces/qubpiz/qubPiz/server && node index.js
```

**Start Frontend**:
```bash
cd /workspaces/qubpiz/qubPiz && npm start
```

**Kill Port 3000** (if needed):
```bash
fuser -k 3000/tcp
```

## CSS Guidelines

- Use CSS variables defined in `/workspaces/qubpiz/qubPiz/src/styles.css`
- Dark theme: `--bg-primary: #1a1a1a`, `--text-primary: #e0e0e0`
- Keep component CSS files minimal, only layout-specific rules
- All common styles should be in master CSS file

## Database

- PostgreSQL with connection pooling
- Auto-creates tables on startup with conditional migrations
- Old workflow uses `session_id IS NULL`
- New workflow uses `session_id` foreign key to `game_sessions(id)`
