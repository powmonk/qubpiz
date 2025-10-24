# QubPiz - Design Document

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Core Concepts & Data Model](#core-concepts--data-model)
4. [User Flows](#user-flows)
5. [Component Design](#component-design)
6. [API Design](#api-design)
7. [Real-time Features](#real-time-features)
8. [Security & Data Integrity](#security--data-integrity)
9. [UI/UX Design](#uiux-design)
10. [Areas for Improvement](#areas-for-improvement)
11. [Future Enhancements](#future-enhancements)

---

## Executive Summary

**QubPiz** is a real-time multiplayer quiz application designed for pub quiz-style events. The system supports:
- Multiple concurrent game sessions
- Quiz master (MC) controls and live content management
- Real-time player participation
- Peer-to-peer answer marking system
- Multiple question types (text, picture, music, multiple choice)
- Session-based architecture for scalability

**Technology Stack:**
- **Frontend:** Angular 18 (Standalone Components), TypeScript, RxJS
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Architecture:** REST API with polling-based real-time updates

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend (Angular 18)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Lobby   │  │  MC Panel│  │  Round   │  │  Marking │   │
│  │Component │  │Component │  │Component │  │Component │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │              │              │          │
│  ┌────┴─────────────┴──────────────┴──────────────┴─────┐  │
│  │         Shared Services (GameStatusService,          │  │
│  │         ApiService, UrlBuilderService)               │  │
│  └───────────────────────┬──────────────────────────────┘  │
└────────────────────────────┼────────────────────────────────┘
                             │ HTTP/REST + Polling
┌────────────────────────────┼────────────────────────────────┐
│                    Backend (Node.js/Express)                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           RESTful API Endpoints                      │   │
│  │  /api/sessions/*  /api/game/*  /api/marking/*       │   │
│  └───────────────────────┬──────────────────────────────┘   │
│  ┌───────────────────────┴──────────────────────────────┐   │
│  │         Business Logic & Session Management          │   │
│  └───────────────────────┬──────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────┐
│                    Database (PostgreSQL)                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Quizzes   │  │  Sessions  │  │  Players   │            │
│  ├────────────┤  ├────────────┤  ├────────────┤            │
│  │  Rounds    │  │  Answers   │  │  Marking   │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### Frontend Architecture

**Component Hierarchy:**
```
App
├── Lobby (/)
│   └── Session Join/Player Registration
├── MC Panel (/mc)
│   ├── Session Lobby View
│   │   ├── Quiz Selector
│   │   └── My Sessions List
│   └── Session Control View
│       ├── Round Manager
│       ├── Question Manager
│       ├── Player Management
│       └── Marking Results
├── Round (/round/{type})
│   ├── Picture Round
│   ├── Music Round
│   └── Question Round
└── Marking (/marking)
    └── Assignment Review
```

**Service Layer:**
- `ApiService`: HTTP client wrapper with base URL management
- `GameStatusService`: Centralized game state management with polling
- `UrlBuilderService`: Session-aware URL construction

---

## Core Concepts & Data Model

### 1. Quiz vs Session

**Quiz (Template):**
- Reusable quiz blueprint
- Contains rounds and questions
- Can be used to create multiple sessions
- Managed by MC

**GameSession (Instance):**
- Active game instance created from a quiz
- Has unique 3-character session code (e.g., "A3F")
- Tracks its own players, answers, and state
- Isolated from other sessions
- Auto-expires after 1 hour of inactivity

### 2. Database Schema

**Key Tables:**

```sql
-- Quiz Templates
quizzes (
  id SERIAL PRIMARY KEY,
  quiz_name TEXT,
  quiz_date TEXT,
  created_at TIMESTAMP
)

-- Active Game Sessions
game_sessions (
  id SERIAL PRIMARY KEY,
  session_code VARCHAR(3) UNIQUE,
  quiz_id INTEGER REFERENCES quizzes(id),
  owner_id VARCHAR(36),              -- MC's UUID
  status TEXT,                       -- 'active', 'closed'
  current_round_id INTEGER,
  marking_mode BOOLEAN,
  created_at TIMESTAMP,
  last_activity TIMESTAMP
)

-- Quiz Structure
rounds (
  id SERIAL PRIMARY KEY,
  quiz_id INTEGER REFERENCES quizzes(id),
  name TEXT,
  round_type TEXT,                   -- 'question', 'picture', 'music', 'multiple_choice'
  round_order INTEGER
)

questions (
  id SERIAL PRIMARY KEY,
  round_id INTEGER REFERENCES rounds(id),
  question_text TEXT,
  answer TEXT,
  image_url TEXT,
  audio_url TEXT,
  question_order INTEGER,
  options JSONB                      -- For multiple choice
)

-- Session Players (Scoped to Sessions)
players (
  session_id INTEGER REFERENCES game_sessions(id),
  name TEXT,
  joined_at TIMESTAMP,
  UNIQUE (session_id, name)          -- Same name allowed in different sessions
)

-- Player Answers (Session-Scoped)
player_answers (
  session_id INTEGER REFERENCES game_sessions(id),
  player_name TEXT,
  question_id INTEGER REFERENCES questions(id),
  round_id INTEGER REFERENCES rounds(id),
  answer_text TEXT,
  submitted_at TIMESTAMP,
  UNIQUE (session_id, player_name, question_id)
)

-- Marking System
marking_assignments (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES game_sessions(id),
  marker_name TEXT,                  -- Player doing the marking
  markee_name TEXT,                  -- Player being marked
  round_id INTEGER REFERENCES rounds(id)
)

marking_scores (
  assignment_id INTEGER REFERENCES marking_assignments(id),
  question_id INTEGER REFERENCES questions(id),
  score DECIMAL(3,1),                -- 0.0 to 1.0
  marked_at TIMESTAMP
)
```

### 3. Session Lifecycle

```
1. MC creates session from quiz → generates session_code
2. Session status = 'active'
3. Players join via /lobby?session=CODE
4. MC controls rounds via session_code parameter
5. Players answer questions (answers tagged with session_id)
6. MC triggers marking mode
7. Players mark each other's answers
8. MC views real-time results
9. MC ends session → status = 'closed'
10. Session auto-expires after 1 hour inactivity
```

---

## User Flows

### Flow 1: MC Creates and Runs a Quiz Session

```
┌─────────────────────────────────────────────────────────────┐
│ MC Journey                                                   │
└─────────────────────────────────────────────────────────────┘

1. MC visits /mc
   └─> Loads "Session Lobby View"
   └─> System generates/retrieves owner_id (UUID in localStorage)

2. MC creates/selects a quiz
   ├─> Option A: Create new quiz
   │   ├─> Enter quiz name and date
   │   └─> Click "Create Quiz"
   └─> Option B: Select existing quiz from list

3. MC clicks "Start Session" on quiz card
   └─> Backend creates GameSession
   └─> Generates 3-char session code (e.g., "K7P")
   └─> MC automatically enters "Session Control View"

4. MC shares session URL with players
   └─> /lobby?session=K7P

5. MC manages session:
   ├─> View players joining in real-time (polling every 2s)
   ├─> Create/manage rounds
   │   ├─> Add questions (text/image/audio/multiple choice)
   │   └─> Set round order
   ├─> Display round to players
   │   └─> Click "Display" button on round
   │   └─> Players see round immediately (via polling)
   └─> Remove players if needed (with confirmation)

6. MC ends game and starts marking
   └─> Click "Enter Marking Mode"
   └─> System assigns marking pairs
   └─> MC sees real-time marking results table (polls every 3s)

7. MC ends session
   └─> Click "End This Session" (with confirmation)
   └─> Returns to Session Lobby View
```

### Flow 2: Player Joins and Plays

```
┌─────────────────────────────────────────────────────────────┐
│ Player Journey                                               │
└─────────────────────────────────────────────────────────────┘

1. Player receives lobby URL from MC
   └─> /lobby?session=K7P

2. Player enters name
   └─> Submits via form
   └─> Stored in localStorage
   └─> Added to players table with session_id

3. Player waits in lobby
   └─> Sees current player list
   └─> Polls game status every 2s
   └─> Waits for MC to display first round

4. MC displays a round
   └─> Player auto-redirected to /round/{type}
   └─> Round type determined by round_type field

5. Player answers questions
   ├─> Sees questions (without correct answers)
   ├─> Types answers in text fields
   ├─> Answers auto-save after 300ms debounce
   └─> Answers stored with session_id tag

6. MC displays next round
   └─> Player auto-redirected to new round type
   └─> Previous answers saved automatically

7. Marking phase begins
   └─> Player auto-redirected to /marking
   └─> Sees assigned player's answers
   ├─> Views answers alongside correct answers
   ├─> Marks each question (0, 0.5, or 1 point)
   └─> Scores saved immediately to backend

8. Session ends
   └─> Player can leave or join another session
```

### Flow 3: Marking Assignment Algorithm

```
┌─────────────────────────────────────────────────────────────┐
│ Marking Assignment Logic                                     │
└─────────────────────────────────────────────────────────────┘

Input: List of players in session
Output: Marking assignments (who marks whom)

Algorithm:
1. Get all players in session: [A, B, C, D, E]
2. For each round in quiz:
   ├─> Shuffle player list randomly
   ├─> Create circular assignment chain:
   │   └─> A marks B, B marks C, C marks D, D marks E, E marks A
   └─> Store assignments in marking_assignments table

Result:
- Each player marks exactly one other player per round
- Fair distribution (everyone marked once per round)
- Players cannot mark themselves
- Assignment persists across page refreshes
```

### Flow 4: Real-time Polling Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Polling Mechanism                                            │
└─────────────────────────────────────────────────────────────┘

GameStatusService (Centralized):
├─> Polls /api/game/status?session=CODE every 2s
├─> Emits game state via Observable (gameStatus$)
├─> All components subscribe to gameStatus$
└─> Components react to state changes

Component Reactions:
├─> Lobby: Detects game start → redirect to round
├─> Round: Detects round change → save answers and switch
├─> Round: Detects marking mode → redirect to marking
├─> Marking: Detects marking end → redirect to lobby
└─> MC: Updates marking results table every 3s

Benefits:
- Single source of truth
- Consistent state across all components
- Reduced API calls (shared polling)
- Automatic cleanup on component destroy
```

---

## Component Design

### 1. Lobby Component (`/lobby`)

**Responsibilities:**
- Player registration
- Session code handling
- Waiting area display

**Key Features:**
- Auto-fills name from localStorage if returning player
- Displays session code prominently
- Shows current player list
- Polls game status to detect round start
- Redirects to marking if marking mode enabled

**State Management:**
```typescript
sessionCode: string | null          // From URL ?session=CODE
sessionInfo: GameSession | null     // Session details
players: string[]                   // Current players
isPlayerLoggedIn: boolean           // Player join status
```

### 2. MC Component (`/mc`)

**Two View Modes:**

**A. Session Lobby View (Entry Point)**
- Shows all MC's active sessions
- Quiz selector for creating new sessions
- Create/delete quiz functionality
- Archived quiz management

**B. Session Control View (Active Session)**
- Session header with code display
- Player management table
- Round Manager (child component)
- Question Manager (child component)
- Marking mode controls
- Real-time marking results table
- End session button

**Key Features:**
- Owner ID persistence in localStorage
- Real-time player list updates
- Confirmation dialogs on all deletions
- Automatic marking results polling when in marking mode

**State Management:**
```typescript
viewMode: 'session-lobby' | 'session-control'
currentSessionCode: string | null
selectedSession: GameSession | null
currentQuiz: Quiz | null
players: string[]
markingMode: boolean
markingResults: Array<{player, score, possible, markedBy}>
```

### 3. Round Manager (Child of MC)

**Responsibilities:**
- Create/edit/delete rounds
- Set round display order
- Control which round is currently shown to players

**Features:**
- Round type selector (question, picture, music, multiple_choice)
- Round list with display buttons
- Currently displayed round highlighting
- Session-aware API calls

**Props:**
```typescript
@Input() currentQuizId: number
@Input() currentDisplayedRoundId: number | null
@Input() sessionCode: string | null
@Output() roundSelected: EventEmitter<Round>
@Output() displayStateChanged: EventEmitter<void>
```

### 4. Question Manager (Child of MC)

**Responsibilities:**
- Add/edit/delete questions for selected round
- Upload images (picture rounds)
- Upload audio (music rounds)
- Create multiple choice options

**Features:**
- Question text input
- Correct answer input
- Image upload with preview
- Audio upload with playback
- Multiple choice option management (4 options)
- Deletion confirmation

**Props:**
```typescript
@Input() currentRound: Round
```

### 5. Round Component (`/round/{type}`)

**Three Round Types:**
- `/round/question` - Standard text questions
- `/round/picture` - Image-based questions
- `/round/music` - Audio-based questions

**Responsibilities:**
- Display questions appropriate to round type
- Collect player answers
- Auto-save answers (300ms debounce)
- Handle round transitions

**Key Features:**
- Polls display data every 2s
- Auto-saves answers on typing
- Saves all pending answers before round change
- Handles marking mode redirect
- Type-specific layouts (grid for pictures, list for questions)

**State Management:**
```typescript
roundType: 'picture' | 'question' | 'music'
currentRound: RoundDisplayData['round']
questions: PlayerQuestion[]
playerAnswers: {[questionId: number]: string}
playerName: string
```

### 6. Marking Component (`/marking`)

**Responsibilities:**
- Display marking assignments
- Show player answers alongside correct answers
- Collect scores for each question
- Submit scores to backend

**Key Features:**
- Loads assignments for current player
- Displays markee's name
- Shows correct answer for reference
- Score buttons (0, 0.5, 1)
- Progress tracking (questions marked vs total)
- Auto-redirects when marking mode disabled

**State Management:**
```typescript
assignments: Assignment[]           // Assigned rounds to mark
playerName: string                  // Current marker
loading: boolean
errorMessage: string
```

---

## API Design

### Session Endpoints

```
POST /api/sessions/create
Body: { quiz_id, owner_id }
Response: { sessionCode, session, quiz }
Description: Creates new game session

GET /api/sessions/:code
Response: { session, quiz }
Description: Loads session details

GET /api/sessions/my-sessions?owner_id=UUID
Response: { sessions[] }
Description: Gets MC's active sessions

POST /api/sessions/:code/end
Response: { success }
Description: Ends session, sets status to 'closed'
```

### Game Control Endpoints

```
GET /api/game/status?session=CODE
Response: {
  active, status, current_round_id,
  current_round_type, current_round_name,
  marking_mode
}
Description: Polls current game state

POST /api/game/toggle-status?session=CODE
Description: Start/stop accepting players (legacy)

POST /api/game/set-round/:id?session=CODE
Description: Display round to players

GET /api/game/display-data?session=CODE
Response: { round, questions }
Description: Gets current round data for players
```

### Player Endpoints

```
POST /api/join?session=CODE
Body: { name }
Response: { players[] }
Description: Add player to session

GET /api/players?session=CODE
Response: { players[] }
Description: Get players in session

DELETE /api/player/remove/:name?session=CODE
Response: { players[] }
Description: Remove player from session

POST /api/reset?session=CODE
Response: { players[] }
Description: Clear all players from session
```

### Quiz & Round Endpoints

```
GET /api/quizzes
Response: { quizzes[] }
Description: Get all quizzes

POST /api/quiz/create
Body: { quiz_name, quiz_date }
Response: { quiz }

GET /api/quiz/:id
Response: { quiz }

DELETE /api/quiz/:id

GET /api/rounds?quiz_id=X
Response: { rounds[] }

POST /api/rounds/create
Body: { quiz_id, name, round_type }

DELETE /api/rounds/:id
```

### Question Endpoints

```
GET /api/questions?round_id=X
Response: { questions[] }

POST /api/questions/create
Body: { round_id, question_text, answer, image_url, audio_url, options }

DELETE /api/questions/:id
```

### Answer Endpoints

```
POST /api/answers/submit?session=CODE
Body: { player_name, question_id, round_id, answer_text }
Description: Submit/update player answer

GET /api/answers/:playerName/:roundId?session=CODE
Response: { answers: {questionId: answerText} }
Description: Load player's answers for round
```

### Marking Endpoints

```
POST /api/marking/toggle-mode?session=CODE
Response: { marking_mode }
Description: Enable/disable marking mode

POST /api/marking/trigger-all-rounds?session=CODE
Description: Create marking assignments for all rounds

GET /api/marking/assignments/:playerName?session=CODE
Response: { assignments[] }
Description: Get marking assignments for player

POST /api/marking/submit
Body: { assignment_id, question_id, score }
Description: Submit mark for question

GET /api/marking/results?session=CODE
Response: { results[] }
Description: Get aggregated marking results

POST /api/marking/clear?session=CODE
Description: Clear all marking data for session
```

---

## Real-time Features

### 1. Game Status Polling

**Implementation:**
```typescript
// GameStatusService
startPolling(sessionCode: string | null) {
  interval(2000).pipe(
    switchMap(() => this.api.get('/api/game/status', {session}))
  ).subscribe(status => {
    this.gameStatus$.next(status);
  });
}
```

**What's Polled:**
- Current round ID
- Round type and name
- Marking mode status
- Session active status

**Who Subscribes:**
- Lobby (detects round start)
- Round component (detects round change)
- Marking component (detects marking end)
- MC panel (updates UI state)

### 2. Marking Results Real-time

**Implementation:**
```typescript
// MC Component
startMarkingResultsPolling() {
  interval(3000).pipe(
    switchMap(() => this.api.get('/api/marking/results', {session}))
  ).subscribe(results => {
    // Process and sort results
    this.markingResults = processResults(results);
  });
}
```

**Started:** When marking mode is enabled
**Stopped:** When marking mode is disabled or component destroyed
**Displayed:** Live updating table with rank, player, score, marker

### 3. Answer Auto-save

**Implementation:**
```typescript
// Round Component
answerChanged$ = new Subject<{questionId, answer}>();

setupAutoSave() {
  this.answerChanged$.pipe(
    debounceTime(300),
    distinctUntilChanged()
  ).subscribe(({questionId, answer}) => {
    this.saveAnswer(questionId, answer);
  });
}
```

**Trigger:** Player types in answer field
**Delay:** 300ms after last keystroke
**Benefit:** No "save" button needed, no lost answers

---

## Security & Data Integrity

### 1. Session Isolation

**Implementation:**
- All player data tagged with `session_id`
- API endpoints validate session ownership
- Database constraints enforce isolation

**SQL Example:**
```sql
-- Players unique per session, not globally
UNIQUE (session_id, name)

-- Answers scoped to session
WHERE session_id = ? AND player_name = ?
```

### 2. Owner Verification

**MC Operations:**
- MC identified by `owner_id` (UUID in localStorage)
- Only session owner can control session
- Backend validates owner_id on sensitive operations

**TODO:** Currently no backend validation - security risk!

### 3. Data Validation

**Backend Validates:**
- Session codes exist and are active
- Players joined before answering
- Questions belong to current round
- Assignments exist before marking

**Frontend Validates:**
- Non-empty inputs
- Confirmation on deletions
- Session code format (3 characters)

### 4. Duplicate Prevention

**Database Constraints:**
```sql
-- Prevent duplicate answers
UNIQUE (session_id, player_name, question_id)

-- Prevent duplicate players
UNIQUE (session_id, name)

-- Prevent duplicate sessions
UNIQUE (session_code)
```

### 5. Answer Privacy

**Player Questions:**
- Questions sent without correct answers
- `PlayerQuestion` interface excludes answer field
- Correct answers only visible to MC and marker

**Marking View:**
- Marker sees correct answer for reference
- Markee doesn't see their own marks until MC reveals

---

## UI/UX Design

### 1. Design System

**CSS Variables (src/styles.css):**
```css
/* Dark Theme Colors */
--bg-primary: #1a1a1a
--bg-secondary: #2d2d2d
--bg-tertiary: #3d3d3d
--bg-hover: #4d4d4d

--text-primary: #e0e0e0
--text-secondary: #b0b0b0
--text-muted: #808080

--color-primary: #007bff (blue)
--color-success: #28a745 (green)
--color-danger: #dc3545 (red)
--color-warning: #ffc107 (yellow)

/* Spacing Scale */
--spacing-xs: 5px
--spacing-sm: 10px
--spacing-md: 15px
--spacing-lg: 20px
--spacing-xl: 30px

/* Border Radius */
--radius-sm: 5px
--radius-md: 8px
--radius-lg: 12px
```

**Component CSS Philosophy:**
- Master CSS handles all colors, spacing, buttons
- Component CSS only handles layout (flexbox, grid)
- No duplicate style definitions
- Consistent spacing throughout

### 2. Button Patterns

**Button Classes:**
- `.primary-btn` - Main actions (blue)
- `.success-btn` - Create/save actions (green)
- `.danger-btn` - Destructive actions (red)
- `.warning-btn` - Caution actions (yellow)
- `.secondary-btn` - Less emphasis (gray)
- `.delete-btn-small` - Small circular × buttons

**All buttons:**
- Hover states
- Disabled states
- Consistent padding
- Smooth transitions

### 3. Table Design

**Data Tables:**
- `.data-table` class for consistent styling
- Header row with darker background
- Zebra striping (`.odd` class on rows)
- Hover effects on rows
- Consistent cell padding

**Used in:**
- Player list (MC)
- Marking results (MC)
- Assignments (Marking view)

### 4. Form Design

**Input Fields:**
- Full width by default
- 2px solid border (color changes on focus)
- Consistent padding (12px)
- Label above input
- Dark theme optimized

**Upload Components:**
- Custom file input styling
- Image/audio preview
- Clear button for uploaded files

### 5. Responsive Layout

**Breakpoints:**
- Max width 1200px for main content
- Grid layouts adjust to screen size
- Cards use `minmax(300px, 1fr)` for responsiveness

**Mobile Considerations:**
- Touch-friendly button sizes (min 44px)
- Larger tap targets
- Simplified layouts on small screens

### 6. Confirmation Dialogs

**All Destructive Actions Use `confirm()`:**
- Delete quiz
- Remove player
- Clear all players
- End session
- Delete round (existing)
- Delete question (existing)

**Message Pattern:**
```javascript
confirm(`Action "${targetName}"? Details. [Cannot be undone.]`)
```

**Benefits:**
- Native browser UI (familiar to users)
- Blocking (prevents accidental clicks)
- Clear consequences
- Contextual information (names, counts)

### 7. Loading States

**Patterns:**
- Loading spinners where appropriate
- Disabled buttons during operations
- Error messages in-line
- Console logging for debugging

**TODO:** More loading indicators needed throughout

### 8. Session Code Display

**Design:**
- Large monospace font (24px)
- High contrast (blue on black)
- Letter spacing for readability
- Prominent placement
- Easy to read from distance

**Purpose:**
- Players can easily find and enter code
- MC can clearly see and communicate code

---

## Areas for Improvement

### 1. Security Vulnerabilities

**Issue:** No backend validation of MC ownership
**Impact:** Any user with a session code can control the session
**Fix Required:**
```javascript
// Backend should check:
if (session.owner_id !== req.body.owner_id) {
  return res.status(403).json({error: 'Not authorized'});
}
```

**Issue:** Session codes are predictable (3 characters = only 46,656 combinations)
**Impact:** Easy to guess active session codes
**Fix Required:**
- Increase to 6 characters (2+ billion combinations)
- Add rate limiting on session API
- Add session password option

**Issue:** No CSRF protection
**Impact:** Cross-site request forgery possible
**Fix Required:**
- Implement CSRF tokens
- Add origin validation
- Use SameSite cookies

### 2. Data Integrity Issues

**Issue:** No database transactions for multi-step operations
**Impact:** Partial data on failures
**Fix Required:**
```javascript
// Example: Creating session should be atomic
await db.query('BEGIN');
try {
  const session = await createSession();
  await copyQuizStructure();
  await db.query('COMMIT');
} catch (err) {
  await db.query('ROLLBACK');
}
```

**Issue:** No foreign key cascade rules specified
**Impact:** Orphaned data when parent deleted
**Fix Required:**
```sql
ALTER TABLE rounds
  ADD CONSTRAINT fk_quiz
  FOREIGN KEY (quiz_id)
  REFERENCES quizzes(id)
  ON DELETE CASCADE;
```

**Issue:** Session cleanup not implemented
**Impact:** Database fills with old sessions
**Fix Required:**
- Implement cron job to delete sessions older than 24 hours
- Add `last_activity` update on every API call
- Clean up related data (players, answers, assignments)

### 3. Performance Issues

**Issue:** Polling creates unnecessary API calls
**Impact:** High server load with many concurrent users
**Fix Required:**
- Implement WebSockets for real-time updates
- Use Server-Sent Events (SSE) as alternative
- Add exponential backoff when no changes detected

**Issue:** No pagination on quiz/session lists
**Impact:** Slow loading with many quizzes
**Fix Required:**
- Add pagination to GET /api/quizzes
- Implement infinite scroll or page numbers
- Add search/filter functionality

**Issue:** Large images not optimized
**Impact:** Slow loading of picture rounds
**Fix Required:**
- Resize images server-side
- Generate thumbnails
- Implement lazy loading
- Use modern formats (WebP, AVIF)

**Issue:** N+1 query problem in marking results
**Impact:** Slow response with many players
**Fix Required:**
```sql
-- Instead of separate queries per player, use JOIN
SELECT
  pa.player_name,
  COUNT(*) as total_questions,
  SUM(ms.score) as total_score,
  ma.marker_name
FROM player_answers pa
JOIN marking_scores ms ON ...
JOIN marking_assignments ma ON ...
GROUP BY pa.player_name, ma.marker_name;
```

### 4. Error Handling Gaps

**Issue:** Generic error messages
**Impact:** Users don't know what went wrong
**Fix Required:**
- Specific error messages for each failure case
- User-friendly error UI (toasts/alerts)
- Structured error responses from backend

**Issue:** No retry logic on failed requests
**Impact:** Temporary network issues cause permanent failures
**Fix Required:**
```typescript
// Add retry logic with exponential backoff
this.api.get(url).pipe(
  retry({count: 3, delay: 1000}),
  catchError(err => {
    // Show user-friendly error
    return of(null);
  })
)
```

**Issue:** Uncaught promise rejections
**Impact:** Silent failures, no user feedback
**Fix Required:**
- Add .catch() to all promises
- Global error handler in Angular
- Log errors to monitoring service

### 5. Accessibility Issues

**Issue:** No ARIA labels or roles
**Impact:** Screen readers can't navigate properly
**Fix Required:**
```html
<button aria-label="Delete player">×</button>
<table role="table" aria-label="Player list">
<div role="alert" aria-live="polite">Score updated</div>
```

**Issue:** Poor keyboard navigation
**Impact:** Can't use app without mouse
**Fix Required:**
- Add tab index to interactive elements
- Implement keyboard shortcuts (Enter to submit, Esc to cancel)
- Focus management on dialogs

**Issue:** Low contrast text in some areas
**Impact:** Hard to read for visually impaired
**Fix Required:**
- Audit all text/background combinations
- Ensure WCAG AA compliance (4.5:1 contrast)
- Increase font sizes for small text

**Issue:** No audio captions/transcripts
**Impact:** Deaf users can't participate in music rounds
**Fix Required:**
- Add optional transcript field for audio questions
- Provide alternative round types

### 6. Code Quality Issues

**Issue:** Large component files (MC: 585 lines)
**Impact:** Hard to maintain and test
**Fix Required:**
- Split MC into smaller sub-components
- Extract business logic into services
- Create facade services for complex operations

**Issue:** Tight coupling between components
**Impact:** Hard to change one without affecting others
**Fix Required:**
- Use more @Input/@Output for communication
- Implement state management (NgRx or similar)
- Create interface boundaries

**Issue:** Limited test coverage
**Impact:** Regressions not caught
**Fix Required:**
- Write unit tests for services
- Add integration tests for critical flows
- Implement E2E tests for user journeys

**Issue:** Magic numbers and strings throughout code
**Impact:** Hard to maintain, easy to break
**Fix Required:**
```typescript
// Instead of:
interval(2000)

// Use:
const POLLING_INTERVAL_MS = 2000;
interval(POLLING_INTERVAL_MS)

// Instead of:
if (status === 'active')

// Use:
enum SessionStatus {
  Active = 'active',
  Closed = 'closed'
}
if (status === SessionStatus.Active)
```

### 7. UX Friction Points

**Issue:** No visual feedback on auto-save
**Impact:** Players unsure if answers saved
**Fix Required:**
- Add checkmark icon when saved
- Show "Saving..." indicator during save
- Toast notification on save error

**Issue:** No session rejoin mechanism
**Impact:** Players kicked out if they refresh
**Fix Required:**
- Store session code in localStorage
- Auto-rejoin on page load if session active
- Show "Reconnecting..." message

**Issue:** No progress indicators
**Impact:** Users don't know how far through quiz
**Fix Required:**
- Show "Round X of Y" to players
- Progress bar for MC
- Question counter (5/20)

**Issue:** Can't edit answers after submission
**Impact:** Typos can't be fixed
**Fix Required:**
- Allow answer editing until round ends
- Show visual indication of submitted status
- Confirmation before final submit

**Issue:** No undo functionality
**Impact:** Accidental actions can't be reversed
**Fix Required:**
- Soft delete (archive) instead of hard delete
- Implement restore from archive
- 5-second undo toast for critical actions

### 8. Missing Features (Affecting UX)

**Issue:** No score display to players
**Impact:** Players don't know their performance
**Fix Required:**
- Add leaderboard view after marking
- Personal score breakdown per round
- Historical scores across sessions

**Issue:** No chat or communication
**Impact:** MC can't send messages to players
**Fix Required:**
- Add announcement banner
- Toast notifications from MC
- Optional team chat

**Issue:** No sound effects/notifications
**Impact:** Players might miss round changes
**Fix Required:**
- Sound on round start
- Notification when marking assigned
- Optional background music

**Issue:** No export functionality
**Impact:** Can't save results for later
**Fix Required:**
- Export results to CSV
- PDF certificate generation
- Share results via link

---

## Future Enhancements

### Phase 1: Foundation Improvements (High Priority)

**1. WebSocket Implementation**
- Replace polling with WebSocket connections
- Real-time updates without delay
- Reduced server load
- Better user experience

**2. Proper Authentication System**
- User accounts for MCs
- Email/password or OAuth login
- Session ownership validation
- Player authentication (optional)

**3. Database Optimization**
- Add indexes on foreign keys
- Implement connection pooling
- Add query caching
- Optimize slow queries

**4. Error Handling Overhaul**
- Structured error responses
- User-friendly error UI
- Retry logic with exponential backoff
- Error logging and monitoring

**5. Automated Testing Suite**
- Unit tests for all services
- Integration tests for API endpoints
- E2E tests for critical user flows
- CI/CD pipeline with automated testing

### Phase 2: Feature Additions (Medium Priority)

**1. Advanced Question Types**
- Video questions
- Audio clues (play snippet)
- True/False questions
- Fill-in-the-blank
- Ordering/ranking questions

**2. Team Mode**
- Group players into teams
- Team-based scoring
- Team chat
- Collaborative answering

**3. Timed Rounds**
- Countdown timer per question/round
- Auto-submit on timeout
- Speed bonus points
- Pressure mode for competitive quizzes

**4. Difficulty Levels**
- Easy/Medium/Hard questions
- Dynamic difficulty adjustment
- Weighted scoring based on difficulty
- Handicap system for mixed skill levels

**5. Media Library**
- Centralized image/audio storage
- Reusable media across quizzes
- Search and filter media
- Bulk upload

**6. Quiz Templates**
- Pre-made quiz templates
- Theme-based templates (Sports, Music, Movies)
- Import/export quiz format (JSON/CSV)
- Public quiz library (community sharing)

### Phase 3: Advanced Features (Low Priority)

**1. Analytics Dashboard**
- Player performance over time
- Question difficulty analysis
- Round completion rates
- Popular quiz topics
- MC activity metrics

**2. Gamification**
- Player badges and achievements
- Leaderboard history
- Streak tracking
- Experience points and levels

**3. Mobile Apps**
- Native iOS app
- Native Android app
- Offline mode support
- Push notifications

**4. Monetization Options**
- Premium features (advanced analytics, more storage)
- White-label option for businesses
- Subscription tiers
- Ad-supported free tier

**5. Social Features**
- Friend system
- Follow favorite MCs
- Quiz recommendations
- Social media integration (share results)

**6. Accessibility Features**
- Text-to-speech for questions
- High contrast mode
- Adjustable font sizes
- Simplified mode for cognitive accessibility
- Multi-language support

**7. Advanced Marking**
- AI-assisted marking (partial credit detection)
- Manual override for AI marks
- Peer review (multiple markers per answer)
- Appeals system

### Phase 4: Enterprise Features (Future Vision)

**1. Multi-tenant Architecture**
- Organization accounts
- Sub-accounts for departments
- Role-based access control (RBAC)
- Custom branding per organization

**2. Integration APIs**
- REST API for third-party integrations
- Webhooks for events (quiz start, end, player join)
- SSO integration (SAML, OAuth)
- LMS integration (Moodle, Canvas)

**3. Advanced Reporting**
- Custom report builder
- Scheduled reports (email daily/weekly)
- Data warehouse integration
- Business intelligence dashboards

**4. Compliance & Security**
- GDPR compliance tools
- Data export/deletion requests
- Audit logs
- Two-factor authentication
- IP whitelisting

**5. Scalability**
- Microservices architecture
- Horizontal scaling support
- CDN for media delivery
- Multi-region deployment
- Load balancing

---

## Implementation Priorities

### Critical (Fix Immediately)
1. ✅ Session isolation (already implemented)
2. ⚠️ Owner ID validation on backend
3. ⚠️ Error handling improvements
4. ⚠️ Session cleanup cron job

### High Priority (Next Sprint)
1. WebSocket implementation
2. Proper authentication
3. Database indexes and optimization
4. Comprehensive error UI
5. Loading indicators throughout

### Medium Priority (Next Quarter)
1. Advanced question types
2. Timed rounds
3. Team mode
4. Analytics dashboard
5. Mobile responsive improvements

### Low Priority (Long-term Roadmap)
1. Native mobile apps
2. Gamification features
3. Enterprise features
4. Third-party integrations
5. Multi-language support

---

## Conclusion

QubPiz is a functional real-time quiz application with a solid foundation. The session-based architecture provides good scalability, and the recent UI improvements have modernized the MC experience.

**Strengths:**
- Clean session isolation
- Real-time feel via polling
- Intuitive user flows
- Scalable database schema
- Modern Angular architecture

**Critical Needs:**
- Backend security validation
- WebSocket migration
- Better error handling
- Performance optimization
- Test coverage

With the improvements outlined in this document, QubPiz can evolve from a functional MVP to a production-ready, scalable quiz platform suitable for commercial use.

---

**Document Version:** 1.0
**Last Updated:** 2025-10-24
**Author:** Claude AI (Design analysis based on codebase review)
