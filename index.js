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
  cors: {
    origin: "*", // Allow all origins for simplicity
    methods: ["GET", "POST"]
  }
});

app.get('/', (req, res) => {
  res.send('DKA Game Server is Running (Strict Mode: 10 Players)');
});

const rooms = {};

// Constants
const REQUIRED_PLAYERS = 10;

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
    if (room.players.length >= REQUIRED_PLAYERS) {
      socket.emit('error_msg', 'Team is full (Max 10 Agents).');
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
  });

  // Toggle Ready
  socket.on('toggle_ready', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isReady = !player.isReady;
      io.to(roomId).emit('room_update', room.players);
    }
  });

  // Start Game
  socket.on('start_game', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    
    const allReady = room.players.every(p => p.isReady);
    const playerCount = room.players.length;

    // STRICT CHECK: Must have exactly 10 players and all must be ready
    if (allReady && playerCount === REQUIRED_PLAYERS) {
      room.status = 'PLAYING';
      // Sync Start: Start in 3 seconds
      const startTime = Date.now() + 3000;
      io.to(roomId).emit('start_game', { startTime });
    } else {
       // Optional: Emit error if someone tries to force start
       if (playerCount !== REQUIRED_PLAYERS) {
           console.log(`Start failed: Only ${playerCount}/${REQUIRED_PLAYERS} players connected.`);
       } else if (!allReady) {
           console.log("Start failed: Not all players are ready.");
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
      // Broadcast to others
      socket.to(roomId).emit('player_updated', player);
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
          // If game was playing and someone left, we might want to keep it running for others, 
          // or if it was LOBBY, just update list.
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