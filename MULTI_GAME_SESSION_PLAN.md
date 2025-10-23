# Multi-Game Session Support Implementation Plan

## Overview
Adding support for multiple concurrent game sessions with unique lobby URLs. Each session has a 6-character code (e.g., ABC123) that players use to join specific games.

## Requirements (User-Specified)
1. **Session Codes**: Short 6-character codes (easy to share verbally)
2. **MC Workflow**: MC manually clicks "Create Game Session" for a quiz
3. **Session Lifetime**: Auto-expire after 1 hour of inactivity + manual "End Session" button
4. **URL Structure**: Query param format: `/lobby?session=ABC123`
5. **Player Scope**: Same player name allowed in different sessions
6. **Quiz Reuse**: Multiple sessions can use the same quiz template simultaneously

## Architecture Strategy
**Incremental, non-breaking implementation** - Add new functionality alongside existing code, gradually migrate.

## Current Status

### ✅ COMPLETED (Phase 1 & 2A-C)

#### Phase 1A: Database Schema - New Tables
- Added `game_sessions` table with columns:
  - `id` (PRIMARY KEY)
  - `session_code` (VARCHAR(6) UNIQUE)
  - `quiz_id` (references game_session.id)
  - `status` (waiting/active/closed)
  - `current_round_id` (references rounds.id)
  - `marking_mode` (BOOLEAN)
  - `created_at` (TIMESTAMP)
  - `last_activity` (TIMESTAMP)
- Added index on `session_code` for fast lookups

#### Phase 1B: Database Schema - Column Additions
- Updated `players` table:
  - Removed UNIQUE constraint on `name` column
  - Added `session_id` (references game_sessions.id)
  - Added UNIQUE constraint on `(session_id, name)` - allows same name across sessions
- Added `session_id` to `marking_assignments` table
- Added `session_id` to `triggered_rounds` table

#### Phase 2A: Session Code Generator
Location: `/workspaces/qubpiz/qubPiz/server/index.js` (lines ~73-97)
- Function: `generateSessionCode()`
- Generates random 6-character codes from A-Z, 0-9
- Collision detection (max 10 attempts)

#### Phase 2C: Session Validation
Location: `/workspaces/qubpiz/qubPiz/server/index.js` (lines ~99-127)
- Function: `validateSession(sessionCode)`
- Checks if session exists
- Auto-deletes sessions older than 1 hour
- Updates `last_activity` timestamp on valid sessions
- Returns session object or null

### ✅ COMPLETED (Phase 2B)

#### Phase 2B: New Session Endpoints
**Location**: `/workspaces/qubpiz/qubPiz/server/index.js` lines 1147-1260

**Endpoints to Add**:

```javascript
// ============= SESSION ENDPOINTS (NEW - MULTI-GAME SUPPORT) =============

// Create a new game session from a quiz template
app.post('/api/sessions/create', async (req, res) => {
  const { quiz_id } = req.body;
  try {
    // Verify quiz exists
    const quizResult = await pool.query(
      'SELECT id, quiz_name, quiz_date FROM game_session WHERE id = $1',
      [quiz_id]
    );

    if (quizResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Generate unique session code
    const sessionCode = await generateSessionCode();

    // Create game session
    const result = await pool.query(
      `INSERT INTO game_sessions (session_code, quiz_id, status, current_round_id, marking_mode)
       VALUES ($1, $2, 'waiting', NULL, FALSE)
       RETURNING *`,
      [sessionCode, quiz_id]
    );

    const session = result.rows[0];
    const quiz = quizResult.rows[0];

    // Generate lobby URL
    const lobbyUrl = `/lobby?session=${sessionCode}`;

    res.json({
      success: true,
      session: session,
      quiz: quiz,
      sessionCode: sessionCode,
      lobbyUrl: lobbyUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get session details by code
app.get('/api/sessions/:code', async (req, res) => {
  try {
    const sessionCode = req.params.code.toUpperCase();
    const session = await validateSession(sessionCode);

    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    // Get quiz details
    const quizResult = await pool.query(
      'SELECT id, quiz_name, quiz_date FROM game_session WHERE id = $1',
      [session.quiz_id]
    );

    res.json({
      session: session,
      quiz: quizResult.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all active sessions for MC view
app.get('/api/sessions/active/all', async (req, res) => {
  try {
    const oneHourAgo = new Date(Date.now() - 3600000);

    const result = await pool.query(
      `SELECT gs.*, q.quiz_name, q.quiz_date,
              (SELECT COUNT(*) FROM players WHERE session_id = gs.id) as player_count
       FROM game_sessions gs
       JOIN game_session q ON gs.quiz_id = q.id
       WHERE gs.last_activity > $1
       ORDER BY gs.created_at DESC`,
      [oneHourAgo]
    );

    res.json({ sessions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// End a game session manually
app.post('/api/sessions/:code/end', async (req, res) => {
  try {
    const sessionCode = req.params.code.toUpperCase();

    const result = await pool.query(
      'DELETE FROM game_sessions WHERE session_code = $1 RETURNING *',
      [sessionCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      success: true,
      message: 'Session ended successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Endpoints Added**:
- ✅ `POST /api/sessions/create` - Create session from quiz (tested)
- ✅ `GET /api/sessions/:code` - Get session details (tested)
- ✅ `GET /api/sessions/active/all` - List all active sessions (tested)
- ✅ `POST /api/sessions/:code/end` - End session manually (tested)

### ✅ COMPLETED (Phase 3A)

#### Phase 3A: Update MC Component
**Files Modified**:
- ✅ `/workspaces/qubpiz/qubPiz/src/app/mc/mc.ts` (lines 35-37, 290-351)
- ✅ `/workspaces/qubpiz/qubPiz/src/app/mc/mc.html` (lines 52-86)
- ✅ `/workspaces/qubpiz/qubPiz/src/app/mc/mc.css` (lines 323-380)

**Changes Completed**:
1. ✅ Added "Create Game Session" button with toggle for active sessions view
2. ✅ Added state variables:
   ```typescript
   activeSessions: any[] = [];
   showSessionManagement: boolean = false;
   ```
3. ✅ Added methods:
   ```typescript
   createGameSession() {
     if (!this.currentQuiz) return;
     this.api.post('/api/sessions/create', { quiz_id: this.currentQuiz.id })
       .subscribe(data => {
         this.activeSessions.push(data.session);
         this.currentSession = data.session;
         // Show copyable URL to MC
       });
   }

   loadActiveSessions() {
     this.api.get('/api/sessions/active/all')
       .subscribe(data => {
         this.activeSessions = data.sessions;
       });
   }

   endSession(sessionCode: string) {
     this.api.post(`/api/sessions/${sessionCode}/end`, {})
       .subscribe(() => {
         this.loadActiveSessions();
       });
   }
   ```

4. ✅ UI Features Implemented:
   - Session management buttons (Create + View/Hide toggle)
   - Active sessions panel with:
     - Session code display (monospace, highlighted)
     - Quiz name and player count
     - Status badge
     - "Copy Lobby URL" button (uses clipboard API)
     - "End Session" button with confirmation
   - Styled with dark theme consistency

#### Phase 3B: Update Lobby Component ✅ COMPLETED
**Files**:
- `/workspaces/qubpiz/qubPiz/src/app/lobby/lobby.ts`
- `/workspaces/qubpiz/qubPiz/src/app/lobby/lobby.html`
- `/workspaces/qubpiz/qubPiz/src/app/lobby/lobby.css`
- `/workspaces/qubpiz/qubPiz/server/index.js` (endpoints updated)

**Changes Implemented**:
1. ✅ Added `ActivatedRoute` to read query params from URL
2. ✅ Added `sessionCode`, `sessionInfo`, `sessionError` properties
3. ✅ Updated `ngOnInit()` to detect session from `?session=CODE` query param
4. ✅ Added `loadSessionInfo()` method to fetch session details from `/api/sessions/:code`
5. ✅ Updated `loadPlayers()` to pass session parameter when present
6. ✅ Updated `onSubmit()` (player join) to pass session parameter
7. ✅ Updated initial player verification check to use session parameter
8. ✅ Added session header display in HTML showing session code and quiz name
9. ✅ Added error handling UI for invalid/expired sessions
10. ✅ Added CSS styling for session display (monospace code, dark theme)

**Backend Changes**:
11. ✅ Updated `/api/join` endpoint to support `?session=CODE` query parameter
    - Validates session code and gets session_id
    - Checks for existing player with `IS NOT DISTINCT FROM` for NULL handling
    - Inserts player with correct session_id
    - Returns players for that session only
12. ✅ Updated `/api/players` endpoint to support `?session=CODE` query parameter
    - Validates session and filters players by session_id
    - Uses `IS NOT DISTINCT FROM` for proper NULL handling
    - Maintains backwards compatibility with old system (session_id IS NULL)

#### Phase 3C: Update GameStatusService ✅ COMPLETED
**Files**:
- `/workspaces/qubpiz/qubPiz/src/app/game-status-service.ts`
- `/workspaces/qubpiz/qubPiz/src/app/lobby/lobby.ts`
- `/workspaces/qubpiz/qubPiz/server/index.js`

**Changes Implemented**:
1. ✅ Added session code storage in localStorage:
   - Added `SESSION_KEY = 'qubpiz_session_code'` constant
   - Added `currentSession$` BehaviorSubject observable
   - Added `getStoredSession()`, `setCurrentSession()`, `getCurrentSession()` methods
   - Session persists across page refreshes

2. ✅ Updated polling to include session parameter:
   - Modified `startPolling()` to check `getCurrentSession()`
   - URL becomes `/api/game/status?session=CODE` when session present
   - Polling automatically restarts when `setCurrentSession()` is called

3. ✅ Updated lobby component integration:
   - Lobby calls `gameStatusService.setCurrentSession(code)` when loading session
   - Lobby calls `gameStatusService.setCurrentSession(null)` for old system
   - Ensures correct polling mode for each context

4. ✅ Updated backend `/api/game/status` endpoint:
   - Checks for `req.query.session` parameter
   - Validates session with `validateSession()` function
   - Queries `game_sessions` table instead of `game_session` for sessions
   - Maintains full backwards compatibility with old system

#### Phase 4A: Migrate Endpoints to Dual-Mode
**Strategy**: Each endpoint should check for `?session=CODE` param first, fall back to `currentQuizId` if not present.

**Example Pattern**:
```javascript
app.get('/api/game/status', async (req, res) => {
  try {
    const sessionCode = req.query.session;

    // NEW: Session-based mode
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.json({
          active: false,
          status: 'waiting',
          error: 'Session not found or expired'
        });
      }

      // Get round details if current_round_id exists
      const roundResult = await pool.query(
        `SELECT r.round_type, r.name as round_name
         FROM rounds r WHERE r.id = $1`,
        [session.current_round_id]
      );

      return res.json({
        active: session.status === 'active',
        status: session.status,
        current_round_id: session.current_round_id,
        current_round_type: roundResult.rows[0]?.round_type,
        current_round_name: roundResult.rows[0]?.round_name,
        marking_mode: session.marking_mode
      });
    }

    // OLD: currentQuizId mode (backwards compatible)
    if (!currentQuizId) {
      return res.json({
        active: false,
        status: 'waiting',
        /* ... */
      });
    }
    // ... existing code
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Endpoints to Migrate** (41 total):
- `/api/game/status` ✓ (example above)
- `/api/game/toggle-status`
- `/api/game/set-round/:roundId`
- `/api/game/display-data`
- `/api/players`
- `/api/join`
- `/api/reset`
- `/api/player/remove/:name`
- `/api/rounds`
- `/api/rounds` (POST)
- `/api/marking/trigger-all-rounds`
- `/api/marking/toggle-mode`
- `/api/marking/assignments/:playerName`
- `/api/marking/results`
- `/api/marking/clear`
- All other endpoints using `currentQuizId`

#### Phase 4B: Testing
1. Test old workflow (no session) still works
2. Test new workflow (with session)
3. Test multiple sessions simultaneously
4. Test session expiry after 1 hour
5. Test player isolation across sessions
6. Test same quiz in multiple sessions

#### Phase 5: Cleanup (Optional)
Once all endpoints migrated and tested:
- Remove `currentQuizId` global variable
- Remove old code paths
- Update documentation

## Key Design Decisions

### Backwards Compatibility
- All schema changes are additive (new columns nullable or with defaults)
- New endpoints don't conflict with existing ones
- Existing functionality continues to work during migration

### Session Lifecycle
1. **Creation**: MC selects quiz → clicks "Create Session" → gets unique code
2. **Active**: Players join via URL, MC controls rounds, marking happens
3. **Expiry**: Auto-deleted after 1 hour of inactivity OR manual end
4. **Cleanup**: CASCADE deletes handle players, marking data, etc.

### Data Isolation
- Players scoped to sessions via `session_id` column
- Marking assignments scoped to sessions
- Same player name allowed in different sessions
- Multiple sessions can share same quiz template

## Testing Checklist

### Basic Functionality
- [ ] Server starts without errors
- [ ] Old MC workflow (select quiz, start game) still works
- [ ] Can create new game session
- [ ] Session code is 6 characters, uppercase alphanumeric
- [ ] Lobby URL is copyable and works

### Multi-Session
- [ ] Can create multiple sessions for same quiz
- [ ] Can create sessions for different quizzes
- [ ] Players in session A don't see players in session B
- [ ] Same player name can join different sessions
- [ ] Each session maintains independent game state

### Session Lifecycle
- [ ] New session starts with 0 players
- [ ] Session accepts player joins
- [ ] Session expires after 1 hour of inactivity
- [ ] "End Session" button immediately terminates session
- [ ] Expired sessions are auto-deleted
- [ ] CASCADE properly deletes related data (players, marking)

### Edge Cases
- [ ] Invalid session code returns proper error
- [ ] Expired session redirects to error page
- [ ] Session collision handling (duplicate codes)
- [ ] Very old sessions are cleaned up on server restart

## Rollback Plan
If issues arise:
1. New endpoints can be commented out without affecting old code
2. Database schema is additive - no data loss
3. Old workflow using `currentQuizId` remains functional
4. Can roll back incrementally by phase

## Current Implementation Files

### Modified Files
- `/workspaces/qubpiz/qubPiz/server/index.js` - Schema + utilities added

### Files to Modify (Pending)
- `/workspaces/qubpiz/qubPiz/server/index.js` - Add endpoints, migrate existing
- `/workspaces/qubpiz/qubPiz/src/app/mc/mc.ts` - Session management
- `/workspaces/qubpiz/qubPiz/src/app/mc/mc.html` - Session UI
- `/workspaces/qubpiz/qubPiz/src/app/lobby/lobby.ts` - Session param handling
- `/workspaces/qubpiz/qubPiz/src/app/game-status-service.ts` - Session-aware polling
- `/workspaces/qubpiz/qubPiz/src/app/round/round.ts` - Pass session through
- `/workspaces/qubpiz/qubPiz/src/app/marking/marking.ts` - Pass session through

## Notes for Future Sessions

### Quick Context
- This is a quiz/trivia game app with MC (host) and players
- Current: Single global game, all players in same session
- Goal: Multiple concurrent games with isolated player groups
- Approach: Incremental migration, non-breaking changes

### Where We Left Off
- Database schema complete ✅
- Utility functions added ✅
- **Next step**: Add session endpoints (Phase 2B)

### How to Continue
1. Check server is running: `lsof -i:3000`
2. Add session endpoints to `index.js` around line 1146
3. Test endpoints with curl
4. Move to Phase 3A (MC UI)

### Useful Commands
```bash
# Start server
cd /workspaces/qubpiz/qubPiz/server && node index.js

# Test session creation
curl -X POST http://localhost:3000/api/sessions/create \
  -H "Content-Type: application/json" \
  -d '{"quiz_id": 1}'

# Test session lookup
curl http://localhost:3000/api/sessions/ABC123

# View active sessions
curl http://localhost:3000/api/sessions/active/all
```

### 📋 NEXT STEPS (Phases 3B-C)

#### Phase 3B: Update Lobby Component (NEXT)
This is the next task to work on. See detailed instructions above.

#### Phase 3C: Update GameStatusService
After Lobby is updated, make GameStatusService session-aware.

## Testing Completed So Far

### Session Endpoints (curl)
- ✅ Create session: Returns unique 6-char code
- ✅ Get session: Returns session + quiz details
- ✅ List active: Shows all sessions with player counts
- ✅ End session: Deletes session successfully
- ✅ Multiple sessions: Can create multiple for same quiz

### MC UI (Ready for Browser Testing)
- Ready to test in browser once Angular dev server is running
- Should see session management buttons in MC panel
- Should be able to create sessions and copy URLs

## Current Status Summary

**Completed**: Phases 1A-B, 2A-C, 3A ✅
**Next**: Phase 3B - Update Lobby for session support 🚧
**Remaining**: Phase 3C (GameStatusService), Phase 4 (Endpoint migration), Phase 5 (Cleanup)

**Estimated Progress**: ~40% complete

## Last Updated
2025-10-23 - Phases 1, 2, and 3A complete
