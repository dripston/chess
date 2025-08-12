require('dotenv').config();
console.log("Loaded GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "[OK]" : "[MISSING]");
if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY not found in .env");
}

const express = require('express');
const socket = require('socket.io');
const http = require('http');
const { Chess } = require("chess.js");
const path = require("path");
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const io = socket(server);

// Gemini setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// AI Configuration
const AI_CONFIG = {
  maxRetries: 3,
  baseDelay: 2000, // 2 seconds
  timeout: 10000,  // 10 seconds
  fallbackToRandom: true
};

// Game state management
class ChessGame {
  constructor() {
    this.chess = new Chess();
    this.players = {};
    this.movesHistory = [];
    this.gameActive = true;
  }

  reset() {
    this.chess = new Chess();
    this.movesHistory = [];
    this.gameActive = true;
    return this.getState();
  }

  getState() {
    return {
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      moves: this.movesHistory,
      active: this.gameActive,
      result: this.getGameResult()
    };
  }

  getGameResult() {
    if (!this.chess.isGameOver()) return null;
    
    if (this.chess.isCheckmate()) {
      return {
        type: "checkmate",
        winner: this.chess.turn() === "w" ? "black" : "white"
      };
    } else if (this.chess.isDraw()) {
      return { type: "draw" };
    } else if (this.chess.isStalemate()) {
      return { type: "stalemate" };
    } else if (this.chess.isThreefoldRepetition()) {
      return { type: "threefold" };
    } else if (this.chess.isInsufficientMaterial()) {
      return { type: "insufficient" };
    }
    return { type: "unknown" };
  }

  makeMove(move) {
    try {
      const result = this.chess.move(move);
      if (result) {
        this.movesHistory.push(result.san);
        this.gameActive = !this.chess.isGameOver();
        return true;
      }
      return false;
    } catch (err) {
      console.error("Invalid move attempted:", move, err.message);
      return false;
    }
  }

  assignPlayer(socketId) {
    if (!this.players.white) {
      this.players.white = socketId;
      return "w";
    } else if (!this.players.black) {
      this.players.black = socketId;
      return "b";
    }
    return null;
  }

  removePlayer(socketId) {
    if (this.players.white === socketId) {
      delete this.players.white;
    } else if (this.players.black === socketId) {
      delete this.players.black;
    }
  }
}

// Enhanced AI Helper Class
class ChessAI {
  constructor() {
    this.retryCount = 0;
    this.lastRequestTime = 0;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getGeminiMoveWithRetry(fen, moveHistory, validMoves, retryCount = 0) {
    try {
      // Rate limiting - ensure at least 1 second between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < 1000) {
        await this.sleep(1000 - timeSinceLastRequest);
      }
      this.lastRequestTime = Date.now();

      console.log(`Gemini attempt ${retryCount + 1}/${AI_CONFIG.maxRetries + 1}`);

      // Create a list of valid moves to help Gemini
      const moveOptions = validMoves.slice(0, 20).join(', '); // Show first 20 moves to avoid token limits

      const prompt = `You are a chess engine playing as Black. 

Position: ${fen}
Game moves: ${moveHistory.join(' ')}

IMPORTANT: You must choose ONLY from these valid moves:
${moveOptions}

Choose the best move considering:
1. Captures and threats
2. Piece development 
3. King safety
4. Center control

Respond with EXACTLY ONE move from the list above. No explanation, just the move.

Move:`;

      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), AI_CONFIG.timeout);
      });

      // Race between API call and timeout
      const apiCall = model.generateContent(prompt);
      const result = await Promise.race([apiCall, timeoutPromise]);
      
      const response = await result.response;
      let move = response.text().trim();
      
      // Clean up the response - be more aggressive
      move = move.split('\n')[0].split(' ')[0].trim();
      move = move.replace(/[^a-zA-Z0-9+#=\-O]/g, '');
      
      if (!move) {
        throw new Error('Empty response from Gemini');
      }

      // Validate the move is in our legal moves list
      if (!validMoves.includes(move)) {
        throw new Error(`Invalid move: ${move} not in legal moves [${validMoves.slice(0,5).join(',')}...]`);
      }
      
      console.log(`✅ Gemini suggested move: ${move}`);
      return move;
      
    } catch (error) {
      console.log(`❌ Gemini attempt ${retryCount + 1} failed:`, error.message);
      
      // Check if we should retry
      const shouldRetry = retryCount < AI_CONFIG.maxRetries && (
        error.status === 503 || 
        error.message.includes('overloaded') ||
        error.message.includes('timeout') ||
        error.message.includes('Service Unavailable') ||
        error.message.includes('Invalid move')
      );
      
      if (shouldRetry) {
        // Exponential backoff with jitter
        const delay = AI_CONFIG.baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
        console.log(`⏳ Retrying in ${Math.round(delay)}ms...`);
        await this.sleep(delay);
        return this.getGeminiMoveWithRetry(fen, moveHistory, validMoves, retryCount + 1);
      }
      
      // All retries failed
      throw error;
    }
  }

  makeSmartRandomMove(chess) {
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;

    // Prioritize certain types of moves
    const captures = moves.filter(move => move.flags.includes('c'));
    const checks = moves.filter(move => move.flags.includes('+'));
    const castling = moves.filter(move => move.flags.includes('k') || move.flags.includes('q'));
    const centerMoves = moves.filter(move => 
      ['e4', 'e5', 'd4', 'd5'].includes(move.san)
    );

    // Prioritize moves in order: captures, checks, castling, center control, then random
    let candidateMoves = captures.length > 0 ? captures :
                        checks.length > 0 ? checks :
                        castling.length > 0 ? castling :
                        centerMoves.length > 0 ? centerMoves :
                        moves;

    const randomMove = candidateMoves[Math.floor(Math.random() * candidateMoves.length)];
    console.log(`🎲 Making smart random move: ${randomMove.san} (from ${candidateMoves.length} candidates)`);
    return randomMove.san;
  }
}

// Create instances
const game = new ChessGame();
const chessAI = new ChessAI();

// Middleware
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.get("/", (req, res) => {
  res.render("index", { title: "Chess Game" });
});

app.get("/test-gemini", async (req, res) => {
  try {
    const result = await model.generateContent("Say 'Hello from Gemini API!'");
    res.send(`✅ Gemini API working: ${result.response.text()}`);
  } catch (err) {
    console.error("Gemini API Error:", err);
    res.status(500).send(`❌ Gemini API failed: ${err.message}`);
  }
});

// Socket events
io.on("connection", (socket) => {
  console.log("🔌 Player connected:", socket.id);
  
  // Assign player role
  const role = game.assignPlayer(socket.id);
  if (role) {
    socket.emit("playerRole", role);
    console.log(`👤 Assigned role ${role === 'w' ? 'White' : 'Black'} to ${socket.id}`);
  } else {
    socket.emit("spectatorRole");
    console.log(`👁️ ${socket.id} is spectating`);
  }
  
  // Send initial state
  socket.emit("gameState", game.getState());

  // On disconnect
  socket.on("disconnect", () => {
    game.removePlayer(socket.id);
    console.log("🔌 Player disconnected:", socket.id);
  });

  // On move
  socket.on("move", async (clientMove) => {
    const state = game.getState();
    if (!state.active) return;
    
    // Enforce turns
    const isWhiteTurn = state.turn === "w";
    if (isWhiteTurn && socket.id !== game.players.white) {
      socket.emit("invalidMove", { reason: "Not your turn" });
      return;
    }
    if (!isWhiteTurn && socket.id !== game.players.black) {
      socket.emit("invalidMove", { reason: "Not your turn" });
      return;
    }

    console.log(`🎯 Player move: ${JSON.stringify(clientMove)}`);

    // Attempt move
    if (game.makeMove(clientMove)) {
      const newState = game.getState();
      io.emit("gameState", newState);
      
      // If it's AI's turn (black) and game is still active
      if (newState.turn === "b" && newState.active) {
        console.log("🤖 AI thinking...");
        
        try {
          // Get list of valid moves for Gemini
          const validMoves = game.chess.moves();
          
          const aiMove = await chessAI.getGeminiMoveWithRetry(
            newState.fen, 
            game.movesHistory,
            validMoves
          );
          
          if (game.makeMove(aiMove)) {
            console.log(`✅ AI played: ${aiMove}`);
            io.emit("gameState", game.getState());
          } else {
            throw new Error(`AI move validation failed: ${aiMove}`);
          }
          
        } catch (err) {
          console.error("🚨 All Gemini attempts failed:", err.message);
          
          if (AI_CONFIG.fallbackToRandom) {
            const randomMove = chessAI.makeSmartRandomMove(game.chess);
            if (randomMove && game.makeMove(randomMove)) {
              console.log("🎲 Fell back to smart random move");
              io.emit("aiError", "AI is temporarily unavailable. Made strategic random move.");
              io.emit("gameState", game.getState());
            }
          } else {
            io.emit("aiError", "AI is currently unavailable. Please try again later.");
          }
        }
      }
    } else {
      console.log(`❌ Invalid move: ${JSON.stringify(clientMove)}`);
      socket.emit("invalidMove", clientMove);
    }
  });

  // Handle game reset request
  socket.on("resetGame", () => {
    console.log("🔄 Game reset requested");
    io.emit("gameState", game.reset());
  });
});

server.listen(3000, () => {
  console.log("🚀 Server is running on port 3000");
  console.log("🤖 AI Config:", {
    maxRetries: AI_CONFIG.maxRetries,
    baseDelay: AI_CONFIG.baseDelay + 'ms',
    timeout: AI_CONFIG.timeout + 'ms',
    fallbackEnabled: AI_CONFIG.fallbackToRandom
  });
});