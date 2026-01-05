# DKA - Backend Documentation

## 📖 Overview
The backend is a **Node.js** application using **Socket.io** to enable real-time multiplayer functionality. It acts as the "source of truth" for room management and game synchronization.

## 🗂 File Structure

*   **`index.js`**: Contains 100% of the server logic.
*   **`package.json`**: Dependencies (`express`, `socket.io`, `cors`).

## ⚙️ Core Features & Logic

### 1. Room Management
*   **Data Structure**: Stores rooms in memory.
*   **Capacity**: Strictly limits rooms to **10 players max**.
*   **Cleanup**: Automatically removes players on disconnect and deletes empty rooms.

### 2. Event API (Socket.io)

#### Client -> Server Events
| Event Name | Payload | Description |
| :--- | :--- | :--- |
| `join_room` | `{ roomId, name }` | Player attempts to enter a lobby. |
| `toggle_ready` | `roomId` | Switches player status between Ready/Not Ready. |
| `start_game` | `roomId` | **Strict Logic**: Triggers ONLY if **10 Players** are connected AND **All are Ready**. |
| `update_player` | `{ score, status }` | Sends current score or death status to the server. |

#### Server -> Client Events
| Event Name | Payload | Description |
| :--- | :--- | :--- |
| `room_update` | `[Player Objects]` | Sent whenever someone joins, leaves, or changes readiness. |
| `start_game` | `{ startTime }` | Sends a future timestamp (Server Time + 3s) so all clients start simultaneously. |
| `player_updated` | `Player Object` | Forwards one player's score update to everyone else in the room. |
| `error_msg` | `String` | Sent if room is full, game already started, or start conditions not met. |

## 🚀 Deployment (Render.com)

This server is optimized for **Render.com**'s Free Tier.

1.  Push this folder to a GitHub repository.
2.  Create a new **Web Service** on Render.
3.  Set **Runtime** to `Node`.
4.  Set **Start Command** to `node index.js`.
5.  **Important**: The free tier spins down after 15 minutes of inactivity. The first request might take ~50 seconds to wake it up. The frontend handles this by showing a "Connecting..." state.