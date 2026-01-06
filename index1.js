const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Create HTTP Server
const server = http.createServer(app);

// Init Socket.io
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// --- MANUAL CONFIGURATION ---
const SERVER_CONFIG = {
  REQUIRED_PLAYERS: 2, // Must match the frontend config
  LEADERBOARD_DURATION: 10000 // 10 Seconds to show leaderboard before purge
};

app.get('/', (req, res) => {
  res.send(`DKA Game Server Running. Mode: ${SERVER_CONFIG.REQUIRED_PLAYERS} Players Auto-Start.`);
});

const rooms = {};

// Helper: Check start conditions and start if met
const checkAndStartGame = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;

  const playerCount = room.players.length;
  const allReady = room.players.every(p => p.isReady);

  // Auto-start condition: Room is full AND everyone is ready
  if (playerCount === SERVER_CONFIG.REQUIRED_PLAYERS && allReady) {
    if (room.status !== 'PLAYING') {
      console.log(`Room ${roomId}: All ${SERVER_CONFIG.REQUIRED_PLAYERS} players ready. Auto-starting...`);
      room.status = 'PLAYING';
      // Sync Start: Start in 3 seconds
      const startTime = Date.now() + 3000;
      io.to(roomId).emit('start_game', { startTime });
    }
  }
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join Room
  socket.on('join_room', ({ roomId, name }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], status: 'LOBBY' };
    }
    const room = rooms[roomId];

    // Check if game is already running
    if (room.status === 'PLAYING') {
      socket.emit('error_msg', 'Mission already in progress. Access Denied.');
      return;
    }
    
    // Check room capacity
    if (room.players.length >= SERVER_CONFIG.REQUIRED_PLAYERS) {
      socket.emit('error_msg', `Team is full (Max ${SERVER_CONFIG.REQUIRED_PLAYERS} Agents).`);
      return;
    }

    const newPlayer = {
      id: socket.id,
      name: name || `Agent ${socket.id.substr(0,4)}`,
      isReady: false,
      score: 0,
      status: 'ALIVE' // ALIVE, DEAD, FINISHED
    };
    
    room.players.push(newPlayer);
    socket.join(roomId);
    
    // Broadcast update
    io.to(roomId).emit('room_update', room.players);

    // Check if this new player completes the room (unlikely since they join as unready, but good practice)
    checkAndStartGame(roomId);
  });

  // Toggle Ready
  socket.on('toggle_ready', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isReady = !player.isReady;
      io.to(roomId).emit('room_update', room.players);
      
      // Check for auto-start whenever someone toggles ready
      checkAndStartGame(roomId);
    }
  });

  // Kick Player (Only Captain/Player 1 can kick)
  socket.on('kick_player', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Validation: Only the first player (Captain) can kick
    if (room.players.length > 0 && room.players[0].id === socket.id) {
        // Prevent kicking self (though UI shouldn't allow it)
        if (targetId === socket.id) return;

        const targetIndex = room.players.findIndex(p => p.id === targetId);
        if (targetIndex !== -1) {
            // Remove from array
            room.players.splice(targetIndex, 1);
            
            // Notify the specific target client they were kicked
            // We use io.to(targetId) assuming targetId IS the socketId
            io.to(targetId).emit('kicked');
            
            // Update everyone else
            io.to(roomId).emit('room_update', room.players);
        }
    }
  });

  // Update Player State (Score/Status)
  socket.on('update_player', ({ roomId, score, status }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.score = score;
      player.status = status;
      
      io.to(roomId).emit('player_updated', player); 

      // Check if everyone is finished/dead to end game early
      const allDone = room.players.every(p => p.status === 'DEAD' || p.status === 'FINISHED');
      if (allDone && room.status === 'PLAYING') {
          console.log(`Room ${roomId}: All players finished. Forcing Game Over.`);
          room.status = 'GAME_OVER'; 
          
          // Calculate reset time
          const resetTime = Date.now() + SERVER_CONFIG.LEADERBOARD_DURATION;

          // Emit final state to everyone with the reset timestamp
          io.to(roomId).emit('force_game_over', { players: room.players, resetTime });
          
          // SERVER SIDE RESET LOGIC
          setTimeout(() => {
              // Ensure room still exists
              if (!rooms[roomId]) return;
              
              const currentRoom = rooms[roomId];
              if (currentRoom.status !== 'GAME_OVER') return; // State safety check

              console.log(`Room ${roomId}: Resetting logic. Purging non-captains.`);

              // 1. Identify Captain (Index 0)
              if (currentRoom.players.length > 0) {
                  const captain = currentRoom.players[0];
                  
                  // 2. Identify others
                  const others = currentRoom.players.slice(1);
                  
                  // 3. Kick others
                  others.forEach(p => {
                      io.to(p.id).emit('kicked');
                      // Note: We don't need to manually leave socket room, the client 'kicked' handler 
                      // should trigger disconnect/reset. But effectively they are out of the game logic.
                  });

                  // 4. Reset Captain State
                  captain.isReady = false;
                  captain.score = 0;
                  captain.status = 'ALIVE';

                  // 5. Reset Room Data
                  currentRoom.players = [captain]; // Only captain remains
                  currentRoom.status = 'LOBBY';

                  // 6. Notify Captain (This will trigger their transition back to Waiting Room)
                  io.to(roomId).emit('room_update', currentRoom.players);
              } else {
                  // Room empty, delete
                  delete rooms[roomId];
              }

          }, SERVER_CONFIG.LEADERBOARD_DURATION);
      }
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        
        // If room is empty, delete it
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          // If game was LOBBY, just update list.
          io.to(roomId).emit('room_update', room.players);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});