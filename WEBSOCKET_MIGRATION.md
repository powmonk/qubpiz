# QubPiz WebSocket Migration Guide

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Architecture Design](#architecture-design)
4. [Implementation Plan](#implementation-plan)
5. [Backend Implementation](#backend-implementation)
6. [Frontend Implementation](#frontend-implementation)
7. [Testing Strategy](#testing-strategy)
8. [Rollback Plan](#rollback-plan)
9. [Performance Monitoring](#performance-monitoring)
10. [Troubleshooting](#troubleshooting)

---

## Overview

### Current State (Polling)
- GameStatusService polls `/api/game/status` every 2 seconds
- MC marking results poll every 3 seconds when marking mode active
- Round component polls `/api/game/display-data` every 2 seconds
- High server load, 2-second latency on all updates

### Target State (WebSockets)
- Persistent WebSocket connections per client
- Server pushes events when state changes
- ~50ms latency, 99% reduction in network traffic
- Polling as fallback for connection failures

### Migration Strategy
**Gradual rollout with fallback:**
1. Add WebSocket infrastructure alongside polling
2. Migrate critical events first
3. Keep polling as fallback for 2 weeks
4. Monitor metrics and user feedback
5. Remove polling code after stable

### Estimated Timeline
- **Week 1-2:** Backend WebSocket server setup
- **Week 3:** Frontend WebSocket service
- **Week 4:** Migrate game status events
- **Week 5:** Migrate marking events
- **Week 6:** Testing and bug fixes
- **Week 7-8:** Monitoring and optimization
- **Week 9:** Remove polling (if stable)

---

## Prerequisites

### Required Dependencies

#### Backend (Node.js)
```bash
cd /workspaces/qubpiz/qubPiz/server
npm install ws@8.14.2
npm install uuid@9.0.1  # For connection tracking
```

**Package:** `ws` - Mature, battle-tested WebSocket library
- Most popular Node.js WebSocket library (21M+ downloads/week)
- Low-level control for custom logic
- Production-ready with good documentation

**Alternatives considered:**
- Socket.io (too heavy, auto-reconnect may interfere with our logic)
- uWebSockets.js (performance overkill, C++ bindings complex)

#### Frontend (Angular)
```bash
cd /workspaces/qubpiz/qubPiz
npm install rxjs@7.8.1  # Already installed, verify version
```

**Built-in WebSocket API:** We'll use native `WebSocket` API
- No external dependencies needed
- Wrap in RxJS Observable for Angular patterns
- Full control over connection lifecycle

### Development Tools
```bash
# WebSocket testing tool
npm install -g wscat

# Usage:
wscat -c ws://localhost:3000
```

### Environment Setup
```bash
# Add to .env (create if doesn't exist)
echo "WS_PORT=3000" >> /workspaces/qubpiz/qubPiz/server/.env
echo "WS_PATH=/ws" >> /workspaces/qubpiz/qubPiz/server/.env
```

---

## Architecture Design

### WebSocket Event Model

```
┌─────────────────────────────────────────────────────────────┐
│                     Event Categories                         │
└─────────────────────────────────────────────────────────────┘

1. SESSION EVENTS (Session lifecycle)
   - session:created
   - session:ended
   - session:expired

2. GAME CONTROL EVENTS (MC actions)
   - game:round-changed
   - game:status-changed
   - game:marking-started
   - game:marking-ended

3. PLAYER EVENTS (Player actions)
   - player:joined
   - player:left
   - player:removed
   - player:answer-submitted

4. MARKING EVENTS (Marking phase)
   - marking:score-updated
   - marking:assignment-created
   - marking:completed

5. SYSTEM EVENTS (Infrastructure)
   - connection:established
   - connection:error
   - connection:closed
   - heartbeat:ping/pong
```

### Connection Management

```
┌─────────────────────────────────────────────────────────────┐
│            Connection Lifecycle & Structure                  │
└─────────────────────────────────────────────────────────────┘

Step 1: Initial Connection
Client                              Server
  |                                    |
  |--- HTTP Upgrade Request ---------->|
  |<-- 101 Switching Protocols --------|
  |                                    |
  |====== WebSocket Connection ========|

Step 2: Authentication/Session Join
  |                                    |
  |-- {type: 'join', session: 'K7P'} ->|
  |                                    | [Validate session]
  |                                    | [Add to session pool]
  |<- {type: 'joined', players: [...]}|

Step 3: Active Communication
  |                                    |
  |<----- Event: round-changed --------|
  |                                    |
  |-- Event: answer-submitted -------->|
  |                                    |

Step 4: Heartbeat (every 30s)
  |                                    |
  |<-------- ping --------------------|
  |--------- pong -------------------->|
  |                                    |

Step 5: Disconnection
  |                                    |
  |-------- close -------------------->|
  |                                    | [Remove from session pool]
  |                                    | [Cleanup resources]
```

### Server-Side Data Structures

```typescript
// Connection Pool Structure
interface ConnectionPool {
  // Map: sessionCode -> Set of connections
  sessions: Map<string, Set<WebSocketConnection>>;

  // Map: connectionId -> connection metadata
  connections: Map<string, ConnectionMetadata>;
}

interface ConnectionMetadata {
  id: string;              // UUID for this connection
  sessionCode: string;     // Session this connection belongs to
  role: 'mc' | 'player';   // User role
  userId: string;          // MC owner_id or player name
  socket: WebSocket;       // Actual WebSocket instance
  joinedAt: Date;
  lastHeartbeat: Date;
}

// In-memory storage (consider Redis for scaling)
const connectionPool: ConnectionPool = {
  sessions: new Map(),
  connections: new Map()
};
```

### Message Protocol

```typescript
// All messages follow this structure
interface WebSocketMessage {
  type: string;           // Event type (e.g., 'game:round-changed')
  sessionCode?: string;   // Session context
  data?: any;             // Event payload
  timestamp: number;      // Unix timestamp
  messageId?: string;     // For acknowledgment tracking
}

// Example messages
{
  type: 'join',
  sessionCode: 'K7P',
  data: { role: 'player', playerName: 'Alice' },
  timestamp: 1698765432000
}

{
  type: 'game:round-changed',
  sessionCode: 'K7P',
  data: {
    roundId: 5,
    roundType: 'picture',
    roundName: 'Famous Landmarks'
  },
  timestamp: 1698765433000
}

{
  type: 'player:joined',
  sessionCode: 'K7P',
  data: {
    playerName: 'Bob',
    totalPlayers: 12
  },
  timestamp: 1698765434000
}
```

---

## Implementation Plan

### Phase 1: Backend WebSocket Server (Week 1-2)

**Goal:** Set up WebSocket server infrastructure

**Tasks:**
1. ✅ Install `ws` package
2. ✅ Create WebSocket server module
3. ✅ Implement connection management
4. ✅ Add heartbeat mechanism
5. ✅ Create broadcast utilities
6. ✅ Add error handling
7. ✅ Write unit tests

**Deliverables:**
- `server/websocket-server.js` - Main WebSocket server
- `server/connection-manager.js` - Connection pool management
- `server/message-handlers.js` - Event handlers
- `server/tests/websocket.test.js` - Unit tests

### Phase 2: Integrate with Existing Endpoints (Week 2-3)

**Goal:** Trigger WebSocket events from existing API endpoints

**Tasks:**
1. ✅ Import WebSocket broadcast in `index.js`
2. ✅ Add broadcasts to critical endpoints:
   - `/api/game/set-round/:id` → broadcast `game:round-changed`
   - `/api/join` → broadcast `player:joined`
   - `/api/player/remove/:name` → broadcast `player:left`
   - `/api/marking/toggle-mode` → broadcast `game:marking-started`
   - `/api/marking/submit` → broadcast `marking:score-updated`
3. ✅ Add session validation to broadcasts
4. ✅ Test broadcasts with wscat

**Example Integration:**
```javascript
// Before
app.post('/api/game/set-round/:id', async (req, res) => {
  await updateCurrentRound(sessionCode, roundId);
  res.json({ success: true });
});

// After
app.post('/api/game/set-round/:id', async (req, res) => {
  const result = await updateCurrentRound(sessionCode, roundId);

  // Broadcast to all clients in session
  wsServer.broadcastToSession(sessionCode, {
    type: 'game:round-changed',
    data: {
      roundId: result.id,
      roundType: result.round_type,
      roundName: result.name
    }
  });

  res.json({ success: true });
});
```

### Phase 3: Frontend WebSocket Service (Week 3-4)

**Goal:** Create Angular service for WebSocket communication

**Tasks:**
1. ✅ Create `WebSocketService`
2. ✅ Implement connection logic with reconnection
3. ✅ Create Observable streams for events
4. ✅ Add error handling and fallback to polling
5. ✅ Integrate with `GameStatusService`
6. ✅ Write unit tests

**Deliverables:**
- `src/app/websocket.service.ts`
- `src/app/websocket.service.spec.ts`

### Phase 4: Migrate Game Status (Week 4)

**Goal:** Replace game status polling with WebSocket events

**Tasks:**
1. ✅ Update `GameStatusService` to use WebSocket
2. ✅ Keep polling as fallback
3. ✅ Update all components subscribing to `gameStatus$`
4. ✅ Test round transitions
5. ✅ Test marking mode toggle

**Components to Update:**
- `lobby.ts` - Detect game start
- `round.ts` - Detect round changes
- `marking.ts` - Detect marking end
- `mc.ts` - Update UI state

### Phase 5: Migrate Marking Results (Week 5)

**Goal:** Replace marking results polling with WebSocket events

**Tasks:**
1. ✅ Add `marking:score-updated` event to MC
2. ✅ Update MC component to listen for WebSocket events
3. ✅ Remove `startMarkingResultsPolling()` method
4. ✅ Test real-time score updates

### Phase 6: Testing & Stabilization (Week 6)

**Goal:** Comprehensive testing and bug fixes

**Tasks:**
1. ✅ Load testing (100+ concurrent connections)
2. ✅ Network reliability testing (disconnect/reconnect)
3. ✅ Cross-browser testing
4. ✅ Mobile testing (iOS Safari, Android Chrome)
5. ✅ Fix bugs and edge cases

### Phase 7: Monitoring & Optimization (Week 7-8)

**Goal:** Monitor production usage and optimize

**Tasks:**
1. ✅ Add logging and metrics
2. ✅ Monitor connection counts
3. ✅ Track message volumes
4. ✅ Measure latency improvements
5. ✅ Optimize message payloads

### Phase 8: Remove Polling (Week 9)

**Goal:** Clean up polling code if WebSocket stable

**Tasks:**
1. ✅ Remove polling from `GameStatusService`
2. ✅ Remove polling from MC marking results
3. ✅ Remove polling from round component
4. ✅ Update documentation
5. ✅ Clean up unused code

---

## Backend Implementation

### File Structure

```
server/
├── index.js                    # Main Express app (existing)
├── websocket-server.js         # NEW: WebSocket server setup
├── connection-manager.js       # NEW: Connection pool management
├── message-handlers.js         # NEW: WebSocket message handlers
├── broadcast-utils.js          # NEW: Broadcasting utilities
└── tests/
    └── websocket.test.js       # NEW: WebSocket tests
```

### Step 1: Create WebSocket Server (`websocket-server.js`)

```javascript
// server/websocket-server.js
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const ConnectionManager = require('./connection-manager');
const MessageHandlers = require('./message-handlers');

class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({
      server: httpServer,
      path: '/ws'
    });

    this.connectionManager = new ConnectionManager();
    this.messageHandlers = new MessageHandlers(this.connectionManager);

    this.setupServer();
    this.startHeartbeat();
  }

  setupServer() {
    this.wss.on('connection', (ws, req) => {
      const connectionId = uuidv4();

      console.log(`[WS] New connection: ${connectionId}`);

      // Store connection temporarily (needs session join)
      ws.connectionId = connectionId;
      ws.isAlive = true;

      // Handle incoming messages
      ws.on('message', (message) => {
        this.handleMessage(ws, message);
      });

      // Handle pong responses (heartbeat)
      ws.on('pong', () => {
        ws.isAlive = true;
        this.connectionManager.updateHeartbeat(connectionId);
      });

      // Handle disconnection
      ws.on('close', () => {
        console.log(`[WS] Connection closed: ${connectionId}`);
        this.connectionManager.removeConnection(connectionId);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`[WS] Connection error ${connectionId}:`, error);
        this.connectionManager.removeConnection(connectionId);
      });

      // Send connection established event
      this.send(ws, {
        type: 'connection:established',
        data: { connectionId }
      });
    });
  }

  handleMessage(ws, rawMessage) {
    try {
      const message = JSON.parse(rawMessage);
      console.log(`[WS] Received:`, message.type);

      // Route to appropriate handler
      this.messageHandlers.handle(ws, message);

    } catch (error) {
      console.error('[WS] Message parse error:', error);
      this.send(ws, {
        type: 'error',
        data: { message: 'Invalid message format' }
      });
    }
  }

  // Send message to specific connection
  send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        ...message,
        timestamp: Date.now()
      }));
    }
  }

  // Broadcast to all connections in a session
  broadcastToSession(sessionCode, message) {
    const connections = this.connectionManager.getSessionConnections(sessionCode);

    if (!connections || connections.size === 0) {
      console.log(`[WS] No connections for session ${sessionCode}`);
      return;
    }

    console.log(`[WS] Broadcasting to ${connections.size} connections in ${sessionCode}`);

    const payload = JSON.stringify({
      ...message,
      sessionCode,
      timestamp: Date.now()
    });

    connections.forEach(conn => {
      if (conn.socket.readyState === WebSocket.OPEN) {
        conn.socket.send(payload);
      }
    });
  }

  // Broadcast to specific role in session (e.g., only MC)
  broadcastToRole(sessionCode, role, message) {
    const connections = this.connectionManager.getSessionConnections(sessionCode);

    if (!connections) return;

    const payload = JSON.stringify({
      ...message,
      sessionCode,
      timestamp: Date.now()
    });

    connections.forEach(conn => {
      if (conn.role === role && conn.socket.readyState === WebSocket.OPEN) {
        conn.socket.send(payload);
      }
    });
  }

  // Heartbeat mechanism (detect dead connections)
  startHeartbeat() {
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          console.log(`[WS] Terminating dead connection: ${ws.connectionId}`);
          this.connectionManager.removeConnection(ws.connectionId);
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // Every 30 seconds
  }

  // Get statistics
  getStats() {
    return {
      totalConnections: this.connectionManager.getTotalConnections(),
      activeSessions: this.connectionManager.getActiveSessions(),
      connections: this.connectionManager.getAllConnections()
    };
  }
}

module.exports = WebSocketServer;
```

### Step 2: Create Connection Manager (`connection-manager.js`)

```javascript
// server/connection-manager.js
class ConnectionManager {
  constructor() {
    // sessionCode -> Set of ConnectionMetadata
    this.sessions = new Map();

    // connectionId -> ConnectionMetadata
    this.connections = new Map();
  }

  // Add connection to session
  addConnection(metadata) {
    const { id, sessionCode } = metadata;

    // Store in connections map
    this.connections.set(id, metadata);

    // Add to session pool
    if (!this.sessions.has(sessionCode)) {
      this.sessions.set(sessionCode, new Set());
    }
    this.sessions.get(sessionCode).add(metadata);

    console.log(`[CM] Added connection ${id} to session ${sessionCode}`);
    console.log(`[CM] Session ${sessionCode} now has ${this.sessions.get(sessionCode).size} connections`);
  }

  // Remove connection
  removeConnection(connectionId) {
    const metadata = this.connections.get(connectionId);

    if (!metadata) return;

    const { sessionCode } = metadata;

    // Remove from connections map
    this.connections.delete(connectionId);

    // Remove from session pool
    if (this.sessions.has(sessionCode)) {
      this.sessions.get(sessionCode).delete(metadata);

      // Clean up empty sessions
      if (this.sessions.get(sessionCode).size === 0) {
        this.sessions.delete(sessionCode);
        console.log(`[CM] Removed empty session ${sessionCode}`);
      }
    }

    console.log(`[CM] Removed connection ${connectionId}`);
  }

  // Get all connections for a session
  getSessionConnections(sessionCode) {
    return this.sessions.get(sessionCode);
  }

  // Get connection metadata by ID
  getConnection(connectionId) {
    return this.connections.get(connectionId);
  }

  // Update last heartbeat timestamp
  updateHeartbeat(connectionId) {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.lastHeartbeat = new Date();
    }
  }

  // Get statistics
  getTotalConnections() {
    return this.connections.size;
  }

  getActiveSessions() {
    return this.sessions.size;
  }

  getAllConnections() {
    return Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      sessionCode: conn.sessionCode,
      role: conn.role,
      userId: conn.userId,
      joinedAt: conn.joinedAt,
      lastHeartbeat: conn.lastHeartbeat
    }));
  }
}

module.exports = ConnectionManager;
```

### Step 3: Create Message Handlers (`message-handlers.js`)

```javascript
// server/message-handlers.js
class MessageHandlers {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;

    this.handlers = {
      'join': this.handleJoin.bind(this),
      'leave': this.handleLeave.bind(this),
      'ping': this.handlePing.bind(this)
    };
  }

  handle(ws, message) {
    const handler = this.handlers[message.type];

    if (handler) {
      handler(ws, message);
    } else {
      console.log(`[MH] Unknown message type: ${message.type}`);
    }
  }

  // Handle session join
  handleJoin(ws, message) {
    const { sessionCode, role, userId } = message.data;

    if (!sessionCode) {
      this.sendError(ws, 'Session code required');
      return;
    }

    // TODO: Validate session exists in database

    // Create connection metadata
    const metadata = {
      id: ws.connectionId,
      sessionCode,
      role: role || 'player',
      userId: userId || 'anonymous',
      socket: ws,
      joinedAt: new Date(),
      lastHeartbeat: new Date()
    };

    // Add to connection pool
    this.connectionManager.addConnection(metadata);

    // Send confirmation
    this.send(ws, {
      type: 'joined',
      data: {
        sessionCode,
        role: metadata.role,
        connectionId: ws.connectionId
      }
    });

    console.log(`[MH] ${userId} (${role}) joined session ${sessionCode}`);
  }

  // Handle session leave
  handleLeave(ws, message) {
    this.connectionManager.removeConnection(ws.connectionId);

    this.send(ws, {
      type: 'left',
      data: { success: true }
    });
  }

  // Handle ping (for testing)
  handlePing(ws, message) {
    this.send(ws, {
      type: 'pong',
      data: { timestamp: Date.now() }
    });
  }

  send(ws, message) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({
        ...message,
        timestamp: Date.now()
      }));
    }
  }

  sendError(ws, errorMessage) {
    this.send(ws, {
      type: 'error',
      data: { message: errorMessage }
    });
  }
}

module.exports = MessageHandlers;
```

### Step 4: Create Broadcast Utilities (`broadcast-utils.js`)

```javascript
// server/broadcast-utils.js

/**
 * Utility functions for broadcasting events
 * Import this in index.js and call from API endpoints
 */

let wsServerInstance = null;

function setWebSocketServer(wsServer) {
  wsServerInstance = wsServer;
}

function broadcastToSession(sessionCode, eventType, data) {
  if (!wsServerInstance) {
    console.warn('[Broadcast] WebSocket server not initialized');
    return;
  }

  wsServerInstance.broadcastToSession(sessionCode, {
    type: eventType,
    data
  });
}

function broadcastToRole(sessionCode, role, eventType, data) {
  if (!wsServerInstance) {
    console.warn('[Broadcast] WebSocket server not initialized');
    return;
  }

  wsServerInstance.broadcastToRole(sessionCode, role, {
    type: eventType,
    data
  });
}

module.exports = {
  setWebSocketServer,
  broadcastToSession,
  broadcastToRole
};
```

### Step 5: Integrate into Express App (`index.js`)

```javascript
// server/index.js (modifications)

const express = require('express');
const http = require('http');
const WebSocketServer = require('./websocket-server');
const { setWebSocketServer, broadcastToSession, broadcastToRole } = require('./broadcast-utils');

const app = express();

// ... existing middleware ...

// Create HTTP server (important: use http.createServer, not app.listen)
const server = http.createServer(app);

// Initialize WebSocket server
const wsServer = new WebSocketServer(server);
setWebSocketServer(wsServer);

console.log('[WS] WebSocket server initialized at ws://localhost:3000/ws');

// ... existing routes ...

// EXAMPLE: Update existing endpoint to broadcast
app.post('/api/game/set-round/:id', async (req, res) => {
  try {
    const sessionCode = req.query.session;
    const roundId = parseInt(req.params.id);

    if (!sessionCode) {
      return res.status(400).json({ error: 'Session code required' });
    }

    // Update database
    const result = await pool.query(
      'UPDATE game_sessions SET current_round_id = $1, last_activity = NOW() WHERE session_code = $2 RETURNING *',
      [roundId, sessionCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get round details
    const roundResult = await pool.query(
      'SELECT id, name, round_type FROM rounds WHERE id = $1',
      [roundId]
    );

    const round = roundResult.rows[0];

    // BROADCAST TO ALL PLAYERS IN SESSION
    broadcastToSession(sessionCode, 'game:round-changed', {
      roundId: round.id,
      roundType: round.round_type,
      roundName: round.name
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Error setting round:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add WebSocket stats endpoint (for monitoring)
app.get('/api/ws/stats', (req, res) => {
  res.json(wsServer.getStats());
});

// Start server (use server.listen, not app.listen)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
```

### Step 6: Update All API Endpoints to Broadcast

**Endpoints to Update:**

```javascript
// 1. Player joins
app.post('/api/join', async (req, res) => {
  // ... existing logic ...

  broadcastToSession(sessionCode, 'player:joined', {
    playerName: name,
    totalPlayers: result.rows.length
  });
});

// 2. Player removed
app.delete('/api/player/remove/:name', async (req, res) => {
  // ... existing logic ...

  broadcastToSession(sessionCode, 'player:removed', {
    playerName: name,
    totalPlayers: result.rows.length
  });
});

// 3. All players cleared
app.post('/api/reset', async (req, res) => {
  // ... existing logic ...

  broadcastToSession(sessionCode, 'player:all-cleared', {
    totalPlayers: 0
  });
});

// 4. Marking mode toggle
app.post('/api/marking/toggle-mode', async (req, res) => {
  // ... existing logic ...

  const eventType = markingMode ? 'game:marking-started' : 'game:marking-ended';

  broadcastToSession(sessionCode, eventType, {
    markingMode
  });
});

// 5. Mark submitted
app.post('/api/marking/submit', async (req, res) => {
  // ... existing logic ...

  // Only broadcast to MC (not all players)
  broadcastToRole(sessionCode, 'mc', 'marking:score-updated', {
    assignmentId: assignment_id,
    questionId: question_id,
    score
  });
});

// 6. Answer submitted
app.post('/api/answers/submit', async (req, res) => {
  // ... existing logic ...

  // Only broadcast to MC
  broadcastToRole(sessionCode, 'mc', 'player:answer-submitted', {
    playerName: player_name,
    questionId: question_id,
    roundId: round_id
  });
});

// 7. Session ended
app.post('/api/sessions/:code/end', async (req, res) => {
  // ... existing logic ...

  broadcastToSession(sessionCode, 'session:ended', {
    sessionCode
  });
});
```

---

## Frontend Implementation

### File Structure

```
src/app/
├── websocket.service.ts         # NEW: WebSocket service
├── websocket.service.spec.ts    # NEW: Tests
├── game-status-service.ts       # UPDATE: Use WebSocket
├── mc/
│   └── mc.ts                    # UPDATE: Use WebSocket for marking
└── ... (other components)
```

### Step 1: Create WebSocket Service

```typescript
// src/app/websocket.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, BehaviorSubject, fromEvent, timer } from 'rxjs';
import { filter, map, retry, delay, tap } from 'rxjs/operators';

export interface WebSocketMessage {
  type: string;
  sessionCode?: string;
  data?: any;
  timestamp: number;
}

export enum ConnectionState {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  RECONNECTING = 'RECONNECTING',
  FAILED = 'FAILED'
}

@Injectable({
  providedIn: 'root'
})
export class WebSocketService implements OnDestroy {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<WebSocketMessage>();
  private connectionStateSubject = new BehaviorSubject<ConnectionState>(ConnectionState.DISCONNECTED);

  private currentSessionCode: string | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY_MS = 2000;

  // Observable streams
  public messages$ = this.messageSubject.asObservable();
  public connectionState$ = this.connectionStateSubject.asObservable();

  constructor() {
    console.log('[WS Service] Initialized');
  }

  /**
   * Connect to WebSocket server and join session
   */
  connect(sessionCode: string, role: 'mc' | 'player' = 'player', userId?: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log('[WS Service] Already connected');
      return;
    }

    this.currentSessionCode = sessionCode;
    this.connectionStateSubject.next(ConnectionState.CONNECTING);

    try {
      // Determine WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      const port = '3000'; // Backend port
      const wsUrl = `${protocol}//${host}:${port}/ws`;

      console.log(`[WS Service] Connecting to ${wsUrl}`);

      this.socket = new WebSocket(wsUrl);

      // Connection opened
      this.socket.onopen = () => {
        console.log('[WS Service] Connected');
        this.connectionStateSubject.next(ConnectionState.CONNECTED);
        this.reconnectAttempts = 0;

        // Join session
        this.send({
          type: 'join',
          data: { sessionCode, role, userId }
        });
      };

      // Message received
      this.socket.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('[WS Service] Received:', message.type);
          this.messageSubject.next(message);
        } catch (error) {
          console.error('[WS Service] Failed to parse message:', error);
        }
      };

      // Connection closed
      this.socket.onclose = (event) => {
        console.log('[WS Service] Disconnected:', event.code, event.reason);
        this.connectionStateSubject.next(ConnectionState.DISCONNECTED);

        // Attempt reconnection if not a clean close
        if (!event.wasClean && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
          this.reconnect();
        }
      };

      // Connection error
      this.socket.onerror = (error) => {
        console.error('[WS Service] Error:', error);
        this.connectionStateSubject.next(ConnectionState.FAILED);
      };

    } catch (error) {
      console.error('[WS Service] Connection failed:', error);
      this.connectionStateSubject.next(ConnectionState.FAILED);
    }
  }

  /**
   * Reconnect after disconnection
   */
  private reconnect(): void {
    this.reconnectAttempts++;
    this.connectionStateSubject.next(ConnectionState.RECONNECTING);

    console.log(`[WS Service] Reconnecting... (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);

    timer(this.RECONNECT_DELAY_MS * this.reconnectAttempts).subscribe(() => {
      if (this.currentSessionCode) {
        this.connect(this.currentSessionCode);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.socket) {
      console.log('[WS Service] Disconnecting');
      this.send({ type: 'leave', data: {} });
      this.socket.close();
      this.socket = null;
      this.currentSessionCode = null;
      this.connectionStateSubject.next(ConnectionState.DISCONNECTED);
    }
  }

  /**
   * Send message to server
   */
  send(message: Partial<WebSocketMessage>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        ...message,
        timestamp: Date.now()
      }));
    } else {
      console.warn('[WS Service] Cannot send, not connected');
    }
  }

  /**
   * Listen for specific event type
   */
  on<T = any>(eventType: string): Observable<T> {
    return this.messages$.pipe(
      filter(msg => msg.type === eventType),
      map(msg => msg.data as T),
      tap(data => console.log(`[WS Service] Event ${eventType}:`, data))
    );
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.messageSubject.complete();
    this.connectionStateSubject.complete();
  }
}
```

### Step 2: Update GameStatusService

```typescript
// src/app/game-status-service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { switchMap, startWith, shareReplay, catchError } from 'rxjs/operators';
import { ApiService } from './api.service';
import { WebSocketService, ConnectionState } from './websocket.service';
import { GameStatus } from './shared/types';

@Injectable({
  providedIn: 'root'
})
export class GameStatusService implements OnDestroy {
  private gameStatusSubject = new BehaviorSubject<GameStatus | null>(null);
  private currentSessionSubject = new BehaviorSubject<string | null>(null);

  private pollingSubscription?: Subscription;
  private wsSubscription?: Subscription;

  private readonly SESSION_KEY = 'qubpiz_current_session';
  private readonly PLAYER_KEY = 'qubpiz_current_player';

  // Use WebSocket by default, fall back to polling if WebSocket fails
  private useWebSocket = true;

  gameStatus$ = this.gameStatusSubject.asObservable();
  currentSession$ = this.currentSessionSubject.asObservable().pipe(shareReplay(1));

  constructor(
    private api: ApiService,
    private ws: WebSocketService
  ) {
    this.loadSessionFromStorage();

    // Subscribe to WebSocket connection state
    this.ws.connectionState$.subscribe(state => {
      if (state === ConnectionState.FAILED) {
        console.warn('[GameStatus] WebSocket failed, falling back to polling');
        this.useWebSocket = false;
        this.startPolling();
      } else if (state === ConnectionState.CONNECTED) {
        console.log('[GameStatus] WebSocket connected, stopping polling');
        this.useWebSocket = true;
        this.stopPolling();
      }
    });
  }

  setCurrentSession(sessionCode: string | null): void {
    if (this.currentSessionSubject.value === sessionCode) {
      return;
    }

    console.log('[GameStatus] Setting session:', sessionCode);

    // Disconnect from old session
    if (this.currentSessionSubject.value) {
      this.ws.disconnect();
      this.stopPolling();
    }

    this.currentSessionSubject.next(sessionCode);

    if (sessionCode) {
      // Save to localStorage
      localStorage.setItem(this.SESSION_KEY, sessionCode);

      // Try WebSocket first
      if (this.useWebSocket) {
        this.connectWebSocket(sessionCode);
      } else {
        // Fall back to polling
        this.startPolling();
      }
    } else {
      // Clear localStorage
      localStorage.removeItem(this.SESSION_KEY);
    }
  }

  getCurrentSession(): string | null {
    return this.currentSessionSubject.value;
  }

  private loadSessionFromStorage(): void {
    const session = localStorage.getItem(this.SESSION_KEY);
    if (session) {
      this.currentSessionSubject.next(session);
    }
  }

  /**
   * Connect to WebSocket and listen for game status events
   */
  private connectWebSocket(sessionCode: string): void {
    const role = window.location.pathname.includes('/mc') ? 'mc' : 'player';
    const userId = role === 'mc'
      ? localStorage.getItem('qubpiz_mc_owner_id') || undefined
      : this.getCurrentPlayer() || undefined;

    // Connect to WebSocket
    this.ws.connect(sessionCode, role, userId);

    // Subscribe to game status events
    this.wsSubscription = this.ws.on<GameStatus>('game:status-changed').subscribe(status => {
      console.log('[GameStatus] Status update via WebSocket:', status);
      this.gameStatusSubject.next(status);
    });

    // Subscribe to round changes
    this.ws.on('game:round-changed').subscribe((data: any) => {
      console.log('[GameStatus] Round changed via WebSocket:', data);
      this.updateGameStatus({
        current_round_id: data.roundId,
        current_round_type: data.roundType,
        current_round_name: data.roundName
      });
    });

    // Subscribe to marking mode changes
    this.ws.on('game:marking-started').subscribe(() => {
      console.log('[GameStatus] Marking started via WebSocket');
      this.updateGameStatus({ marking_mode: true });
    });

    this.ws.on('game:marking-ended').subscribe(() => {
      console.log('[GameStatus] Marking ended via WebSocket');
      this.updateGameStatus({ marking_mode: false });
    });

    // Do one initial poll to get current state
    this.pollOnce();
  }

  /**
   * Update game status (merge with existing)
   */
  private updateGameStatus(updates: Partial<GameStatus>): void {
    const current = this.gameStatusSubject.value || {} as GameStatus;
    this.gameStatusSubject.next({
      ...current,
      ...updates
    });
  }

  /**
   * Start polling (fallback when WebSocket unavailable)
   */
  private startPolling(): void {
    if (this.pollingSubscription) {
      return; // Already polling
    }

    console.log('[GameStatus] Starting polling fallback');

    this.pollingSubscription = interval(2000).pipe(
      startWith(0),
      switchMap(() => {
        const session = this.getCurrentSession();
        const url = session ? `/api/game/status?session=${session}` : '/api/game/status';
        return this.api.get<GameStatus>(url);
      }),
      catchError(err => {
        console.error('[GameStatus] Polling error:', err);
        return [];
      })
    ).subscribe(status => {
      if (status) {
        this.gameStatusSubject.next(status);
      }
    });
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingSubscription) {
      console.log('[GameStatus] Stopping polling');
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = undefined;
    }
  }

  /**
   * Poll once (for initial state)
   */
  private pollOnce(): void {
    const session = this.getCurrentSession();
    const url = session ? `/api/game/status?session=${session}` : '/api/game/status';

    this.api.get<GameStatus>(url).subscribe({
      next: status => {
        this.gameStatusSubject.next(status);
      },
      error: err => {
        console.error('[GameStatus] Failed to get initial status:', err);
      }
    });
  }

  // Player management
  setCurrentPlayer(name: string): void {
    localStorage.setItem(this.PLAYER_KEY, name);
  }

  getCurrentPlayer(): string | null {
    return localStorage.getItem(this.PLAYER_KEY);
  }

  clearCurrentPlayer(): void {
    localStorage.removeItem(this.PLAYER_KEY);
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.ws.disconnect();
    if (this.wsSubscription) {
      this.wsSubscription.unsubscribe();
    }
  }
}
```

### Step 3: Update MC Component for Real-time Marking

```typescript
// src/app/mc/mc.ts (modifications)

export class Mc implements OnInit, OnDestroy {
  // ... existing properties ...

  private markingScoreSubscription?: Subscription;

  constructor(
    private api: ApiService,
    private gameStatusService: GameStatusService,
    private urlBuilder: UrlBuilderService,
    private ws: WebSocketService  // ADD THIS
  ) {
    this.ownerId = this.getOrCreateOwnerId();
  }

  ngOnInit() {
    // ... existing code ...

    // Subscribe to WebSocket marking score updates
    this.markingScoreSubscription = this.ws.on('marking:score-updated')
      .subscribe(() => {
        // Reload marking results when any score is updated
        this.loadMarkingResults();
      });
  }

  // REMOVE startMarkingResultsPolling() - no longer needed!
  // WebSocket will push updates automatically

  // NEW: Load marking results once (called on WebSocket event)
  loadMarkingResults() {
    if (!this.markingMode) return;

    const url = this.urlBuilder.buildUrl('/api/marking/results');
    this.api.get<{results: any[]}>(url).subscribe({
      next: (data) => {
        if (data.results.length === 0) {
          this.markingResults = [];
          return;
        }

        // Group results by player and calculate totals
        const playerScores: {[player: string]: {total: number, possible: number, markedBy: string}} = {};

        data.results.forEach(result => {
          if (!playerScores[result.markee_name]) {
            playerScores[result.markee_name] = {total: 0, possible: 0, markedBy: result.marker_name};
          }
          playerScores[result.markee_name].possible += 1;
          if (result.score !== null) {
            playerScores[result.markee_name].total += parseFloat(result.score);
          }
        });

        // Convert to array and sort by score
        this.markingResults = Object.entries(playerScores)
          .map(([player, scores]) => ({
            player: player,
            score: scores.total,
            possible: scores.possible,
            markedBy: scores.markedBy
          }))
          .sort((a, b) => b.score - a.score);
      },
      error: (err) => {
        console.error('Error loading marking results', err);
      }
    });
  }

  ngOnDestroy() {
    // ... existing cleanup ...

    if (this.markingScoreSubscription) {
      this.markingScoreSubscription.unsubscribe();
    }
  }
}
```

### Step 4: Update Components to React to WebSocket Events

```typescript
// src/app/lobby/lobby.ts
// No changes needed! GameStatusService handles WebSocket automatically

// src/app/round/round.ts
// No changes needed! GameStatusService handles WebSocket automatically

// src/app/marking/marking.ts
// No changes needed! GameStatusService handles WebSocket automatically
```

---

## Testing Strategy

### Unit Tests

```typescript
// src/app/websocket.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { WebSocketService } from './websocket.service';

describe('WebSocketService', () => {
  let service: WebSocketService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WebSocketService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // TODO: Add tests for:
  // - Connection establishment
  // - Message sending/receiving
  // - Reconnection logic
  // - Event filtering
  // - Disconnection cleanup
});
```

### Integration Tests

```bash
# Test with wscat
wscat -c ws://localhost:3000/ws

# After connection:
> {"type": "join", "data": {"sessionCode": "K7P", "role": "player", "userId": "Alice"}}
< {"type": "joined", "data": {...}, "timestamp": 1234567890}

> {"type": "ping"}
< {"type": "pong", "data": {...}, "timestamp": 1234567890}
```

### Load Testing

```javascript
// server/tests/load-test.js
const WebSocket = require('ws');

async function loadTest() {
  const connections = [];
  const SESSION_CODE = 'TEST';
  const NUM_CONNECTIONS = 100;

  console.log(`Creating ${NUM_CONNECTIONS} connections...`);

  for (let i = 0; i < NUM_CONNECTIONS; i++) {
    const ws = new WebSocket('ws://localhost:3000/ws');

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'join',
        data: {
          sessionCode: SESSION_CODE,
          role: 'player',
          userId: `Player${i}`
        }
      }));
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data);
      console.log(`Player${i} received: ${message.type}`);
    });

    connections.push(ws);

    // Stagger connections slightly
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  console.log(`${NUM_CONNECTIONS} connections established`);

  // Wait 5 seconds
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Simulate MC broadcasting event
  console.log('Simulating broadcast...');
  // (Trigger via HTTP POST to API)

  // Wait for responses
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Close all connections
  connections.forEach(ws => ws.close());

  console.log('Load test complete');
}

loadTest();
```

### Manual Testing Checklist

```
□ MC creates session
□ Player joins via URL
□ Both see each other connect (check WS stats endpoint)
□ MC displays round
□ Player sees round change instantly (<100ms)
□ Multiple players join
□ MC removes player
□ Other players see update instantly
□ MC enables marking mode
□ All players redirect to marking page
□ Player submits marks
□ MC sees results update in real-time
□ Test network disconnection (unplug ethernet)
□ Verify reconnection works
□ Verify fallback to polling if WebSocket fails
□ Test on mobile devices (iOS Safari, Android Chrome)
□ Test across different networks (WiFi, 4G, 5G)
```

---

## Rollback Plan

### If WebSocket Issues Occur

**Symptoms:**
- Connections fail to establish
- High disconnection rate
- Events not received
- Performance degradation

**Rollback Steps:**

1. **Disable WebSocket on Backend (5 minutes)**
```javascript
// server/index.js
// Comment out WebSocket initialization
// const wsServer = new WebSocketServer(server);
// setWebSocketServer(wsServer);

// Keep broadcasts (they'll just do nothing)
```

2. **Force Polling on Frontend (5 minutes)**
```typescript
// src/app/game-status-service.ts
constructor(private api: ApiService, private ws: WebSocketService) {
  this.useWebSocket = false;  // Force polling
  this.startPolling();
}
```

3. **Deploy Hotfix**
```bash
# Backend
cd /workspaces/qubpiz/qubPiz/server
pm2 restart qubpiz-backend

# Frontend
cd /workspaces/qubpiz/qubPiz
npm run build
# Deploy dist/ to hosting
```

**Result:** Application reverts to polling behavior, fully functional

### Feature Flag Approach (Recommended)

```typescript
// Environment variable to toggle WebSocket
const ENABLE_WEBSOCKET = process.env.ENABLE_WEBSOCKET === 'true';

// Backend
if (ENABLE_WEBSOCKET) {
  const wsServer = new WebSocketServer(server);
  setWebSocketServer(wsServer);
}

// Frontend
export const environment = {
  enableWebSocket: true  // Set to false to disable
};
```

**Benefits:**
- Toggle feature without code changes
- Gradual rollout (10% users → 50% → 100%)
- A/B testing capability
- Instant rollback via config change

---

## Performance Monitoring

### Metrics to Track

```javascript
// server/websocket-server.js

class WebSocketServer {
  constructor() {
    // ... existing code ...

    this.metrics = {
      totalConnectionsCreated: 0,
      totalConnectionsClosed: 0,
      totalMessagesReceived: 0,
      totalMessagesSent: 0,
      totalBroadcasts: 0,
      connectionErrors: 0,
      reconnections: 0,
      averageConnectionDuration: 0
    };
  }

  getMetrics() {
    return {
      ...this.metrics,
      currentConnections: this.connectionManager.getTotalConnections(),
      activeSessions: this.connectionManager.getActiveSessions(),
      uptime: process.uptime()
    };
  }

  // Update metrics in various methods
  setupServer() {
    this.wss.on('connection', (ws) => {
      this.metrics.totalConnectionsCreated++;
      // ... rest of code ...
    });
  }
}

// Expose metrics endpoint
app.get('/api/ws/metrics', (req, res) => {
  res.json(wsServer.getMetrics());
});
```

### Monitoring Dashboard (Future Enhancement)

```html
<!-- Simple HTML dashboard -->
<!DOCTYPE html>
<html>
<head>
  <title>WebSocket Metrics</title>
  <script>
    async function fetchMetrics() {
      const response = await fetch('/api/ws/metrics');
      const metrics = await response.json();

      document.getElementById('metrics').innerHTML = `
        <pre>${JSON.stringify(metrics, null, 2)}</pre>
      `;
    }

    setInterval(fetchMetrics, 5000);
    fetchMetrics();
  </script>
</head>
<body>
  <h1>WebSocket Metrics</h1>
  <div id="metrics">Loading...</div>
</body>
</html>
```

### Logging

```javascript
// Use structured logging
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'websocket.log' })
  ]
});

// Log important events
logger.info('WebSocket connection established', {
  connectionId,
  sessionCode,
  role,
  userId
});

logger.error('WebSocket connection error', {
  connectionId,
  error: error.message
});

logger.info('Broadcast sent', {
  sessionCode,
  eventType,
  recipientCount
});
```

---

## Troubleshooting

### Common Issues

#### 1. WebSocket Connection Fails

**Symptoms:**
- Console error: "WebSocket connection failed"
- ConnectionState stuck in CONNECTING

**Possible Causes:**
- Backend not running
- Wrong WebSocket URL
- Firewall blocking WebSocket
- CORS issues

**Solutions:**
```javascript
// Check backend is running
curl http://localhost:3000/api/ws/stats

// Test WebSocket connection
wscat -c ws://localhost:3000/ws

// Check firewall rules
sudo ufw status

// Enable CORS for WebSocket (if needed)
// server/index.js
const cors = require('cors');
app.use(cors({
  origin: 'http://localhost:4200',
  credentials: true
}));
```

#### 2. Events Not Received

**Symptoms:**
- Connection established but no events
- Events work for some users, not others

**Debugging:**
```javascript
// Add extensive logging
console.log('[WS] Message received:', message);
console.log('[WS] Current connections:', connectionManager.getAllConnections());
console.log('[WS] Broadcasting to:', sessionCode, connections.size);

// Check session membership
const conn = connectionManager.getConnection(connectionId);
console.log('Connection metadata:', conn);

// Verify message format
console.log('Broadcast payload:', JSON.stringify(message));
```

**Solutions:**
- Verify session join completed (`joined` event received)
- Check connection is in correct session pool
- Ensure broadcast called with correct session code

#### 3. Reconnection Loop

**Symptoms:**
- Rapid connect/disconnect cycles
- Console spam with reconnection messages

**Possible Causes:**
- Heartbeat timeout too aggressive
- Network instability
- Server rejecting connection

**Solutions:**
```typescript
// Increase reconnection delay
private readonly RECONNECT_DELAY_MS = 5000;  // 5 seconds instead of 2

// Add exponential backoff
private getReconnectDelay(): number {
  return this.RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts);
}

// Limit reconnection attempts
if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
  console.error('[WS] Max reconnection attempts reached, giving up');
  this.connectionStateSubject.next(ConnectionState.FAILED);
  return;
}
```

#### 4. Memory Leak (Connections Not Cleaned Up)

**Symptoms:**
- Memory usage grows over time
- Connection count increases without bound
- Server becomes unresponsive

**Debugging:**
```javascript
// Add connection cleanup logging
console.log('[CM] Total connections before cleanup:', this.connections.size);
console.log('[CM] Session map size:', this.sessions.size);

// Monitor with endpoint
app.get('/api/ws/debug', (req, res) => {
  res.json({
    connections: wsServer.connectionManager.getAllConnections(),
    sessions: Array.from(wsServer.connectionManager.sessions.keys())
  });
});
```

**Solutions:**
```javascript
// Ensure cleanup in all code paths
ws.on('close', () => {
  console.log('[WS] Cleanup on close:', ws.connectionId);
  connectionManager.removeConnection(ws.connectionId);
});

ws.on('error', () => {
  console.log('[WS] Cleanup on error:', ws.connectionId);
  connectionManager.removeConnection(ws.connectionId);
});

// Add periodic cleanup of stale connections
setInterval(() => {
  const staleTimeout = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();

  connectionManager.connections.forEach((conn, id) => {
    if (now - conn.lastHeartbeat.getTime() > staleTimeout) {
      console.log('[WS] Removing stale connection:', id);
      connectionManager.removeConnection(id);
      conn.socket.terminate();
    }
  });
}, 60000); // Check every minute
```

#### 5. CORS Errors with WebSocket

**Symptoms:**
- "Cross-Origin Request Blocked" in browser console
- Connection fails immediately

**Solution:**
```javascript
// WebSocket doesn't use CORS directly, but check:

// 1. Origin header in request
wss.on('connection', (ws, req) => {
  console.log('WebSocket origin:', req.headers.origin);

  // Optionally validate origin
  const allowedOrigins = ['http://localhost:4200', 'https://yourdomain.com'];
  if (!allowedOrigins.includes(req.headers.origin)) {
    ws.close();
    return;
  }
});

// 2. For proxy setups (nginx, etc.)
// Ensure WebSocket headers are passed:
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
```

---

## Success Criteria

### Metrics to Achieve

| Metric | Current (Polling) | Target (WebSocket) | Measurement |
|--------|-------------------|-------------------|-------------|
| Update Latency | 0-2000ms | 0-100ms | Time from MC action to player seeing update |
| Server Requests/Min | 3000 (100 players) | <100 | Monitor API logs |
| Network Traffic | ~1 MB/player/session | <50 KB/player/session | Browser DevTools Network tab |
| Connection Overhead | 800 bytes/request | 2 bytes/message | Wireshark packet analysis |
| Battery Usage (mobile) | High (constant polling) | Low (idle when quiet) | Android Battery Historian |
| Concurrent Users Supported | ~500 | 5000+ | Load testing |

### User Experience Targets

✅ Round changes feel instant (<100ms perceived delay)
✅ No visible lag when players join
✅ Marking scores update smoothly in real-time
✅ Works reliably on mobile devices (iOS/Android)
✅ Graceful fallback to polling if WebSocket fails
✅ No increase in bug reports or support tickets

---

## Timeline Summary

```
Week 1-2: Backend Infrastructure
  ├─ Install dependencies
  ├─ Create WebSocket server
  ├─ Implement connection management
  ├─ Add heartbeat mechanism
  └─ Write unit tests

Week 3: Frontend WebSocket Service
  ├─ Create WebSocketService
  ├─ Implement reconnection logic
  ├─ Add event filtering
  └─ Write unit tests

Week 4: Integrate with Existing Endpoints
  ├─ Add broadcasts to API endpoints
  ├─ Update GameStatusService
  ├─ Test with wscat
  └─ Fix integration bugs

Week 5: Migrate Marking Results
  ├─ Update MC component
  ├─ Remove polling code
  ├─ Test real-time updates
  └─ Fix edge cases

Week 6: Testing & Bug Fixes
  ├─ Integration testing
  ├─ Cross-browser testing
  ├─ Mobile device testing
  └─ Fix reported bugs

Week 7-8: Monitoring & Optimization
  ├─ Deploy to staging
  ├─ Monitor metrics
  ├─ Optimize performance
  └─ Gradual rollout to production

Week 9: Cleanup (if stable)
  ├─ Remove polling code
  ├─ Update documentation
  ├─ Celebrate! 🎉
  └─ Plan next enhancements
```

---

## Next Steps

### Immediate Actions (This Week)

1. **Install Dependencies**
```bash
cd /workspaces/qubpiz/qubPiz/server
npm install ws uuid
```

2. **Create WebSocket Server Files**
- Copy code from this document to create:
  - `server/websocket-server.js`
  - `server/connection-manager.js`
  - `server/message-handlers.js`
  - `server/broadcast-utils.js`

3. **Update `server/index.js`**
- Import WebSocket server
- Initialize on HTTP server
- Add WebSocket stats endpoint

4. **Test Basic Connection**
```bash
# Start backend
node server/index.js

# In another terminal, test connection
wscat -c ws://localhost:3000/ws

# Should see: {"type":"connection:established",...}
```

5. **Review & Commit**
```bash
git checkout -b feature/websocket-implementation
git add server/websocket-server.js server/connection-manager.js ...
git commit -m "Add WebSocket server infrastructure"
```

### Follow-Up (Next Week)

- Implement frontend WebSocketService
- Update GameStatusService
- Add broadcasts to critical endpoints
- Begin testing

---

## Conclusion

This migration will transform QubPiz from a polling-based to a real-time WebSocket application, dramatically improving responsiveness and reducing server load. The gradual migration strategy ensures stability, and the fallback mechanism provides resilience.

**Key Benefits:**
- ⚡ 40x faster updates (2000ms → 50ms)
- 📉 99% reduction in server requests
- 🔋 Lower mobile battery usage
- 🚀 Enables future real-time features

**Risk Mitigation:**
- Fallback to polling if WebSocket fails
- Feature flag for instant rollback
- Comprehensive testing plan
- Monitoring and metrics

**Estimated Impact:**
- Current: 100 players = 60,000 requests/session
- After: 100 players = ~500 messages/session
- **120x reduction in network traffic!**

---

**Document Version:** 1.0
**Created:** 2025-10-24
**Author:** Claude AI
**Status:** Ready for Implementation
