const socket = io(); 
let chess = new Chess();
const boardElement = document.querySelector(".chessboard");
const statusElement = document.getElementById("game-status");
const resetButton = document.getElementById("reset-btn");
const messageElement = document.getElementById("game-message");

let selectedSquare = null;
let playerRole = null;
let gameActive = true;
let draggedPiece = null;
let draggedFrom = null;

// Render the chess board
const renderBoard = () => {
  const board = chess.board();
  boardElement.innerHTML = "";
  
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = board[row][col];
      const squareElement = document.createElement("div");
      squareElement.classList.add("square", (row + col) % 2 === 0 ? "light" : "dark");
      squareElement.dataset.row = row;
      squareElement.dataset.col = col;
      
      // Highlight selected square
      if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) {
        squareElement.classList.add("selected");
      }
      
      // Highlight possible moves
      if (selectedSquare && gameActive && playerRole === chess.turn()) {
        const moves = getPossibleMoves(selectedSquare);
        const isPossibleMove = moves.some(move => 
          move.to.row === row && move.to.col === col
        );
        if (isPossibleMove) {
          squareElement.classList.add("possible-move");
        }
      }

      if (square) {
        const pieceElement = document.createElement("div");
        pieceElement.classList.add("piece", square.color === "w" ? "white" : "black");
        pieceElement.innerText = getPieceUnicode(square);
        pieceElement.dataset.type = square.type;
        
        // Make pieces draggable only if it's the player's piece and their turn
        if (square.color === playerRole && playerRole === chess.turn() && gameActive) {
          pieceElement.draggable = true;
          pieceElement.style.cursor = "grab";
          
          // Drag event listeners
          pieceElement.addEventListener("dragstart", (e) => handleDragStart(e, row, col, square));
          pieceElement.addEventListener("dragend", handleDragEnd);
        } else {
          pieceElement.draggable = false;
          pieceElement.style.cursor = square.color === playerRole ? "not-allowed" : "default";
        }
        
        squareElement.appendChild(pieceElement);
      }
      
      // Square event listeners for both click and drop
      squareElement.addEventListener("click", () => handleSquareClick(row, col));
      squareElement.addEventListener("dragover", handleDragOver);
      squareElement.addEventListener("drop", (e) => handleDrop(e, row, col));
      
      boardElement.appendChild(squareElement);
    }
  }
};

// Drag and drop handlers
const handleDragStart = (e, row, col, piece) => {
  if (!gameActive || piece.color !== playerRole || playerRole !== chess.turn()) {
    e.preventDefault();
    return;
  }
  
  draggedPiece = piece;
  draggedFrom = { row, col };
  
  // Add visual feedback
  e.target.style.opacity = "0.5";
  e.target.style.cursor = "grabbing";
  
  // Highlight possible moves
  selectedSquare = { row, col };
  renderBoard();
  
  // Set drag image
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/html", e.target.outerHTML);
};

const handleDragEnd = (e) => {
  // Reset visual feedback
  e.target.style.opacity = "";
  e.target.style.cursor = "grab";
  
  // Clear drag data
  draggedPiece = null;
  draggedFrom = null;
};

const handleDragOver = (e) => {
  e.preventDefault(); // Allow drop
  e.dataTransfer.dropEffect = "move";
};

const handleDrop = (e, row, col) => {
  e.preventDefault();
  
  if (!draggedFrom || !gameActive) return;
  
  // Don't do anything if dropped on same square
  if (draggedFrom.row === row && draggedFrom.col === col) {
    selectedSquare = null;
    renderBoard();
    return;
  }
  
  // Make the move
  makeMove(draggedFrom.row, draggedFrom.col, row, col);
};

// Get possible moves for a square
const getPossibleMoves = (square) => {
  const files = ['a','b','c','d','e','f','g','h'];
  const from = files[square.col] + (8 - square.row);
  const moves = chess.moves({ square: from, verbose: true });
  
  return moves.map(move => ({
    from: square,
    to: {
      row: 8 - parseInt(move.to[1]),
      col: move.to.charCodeAt(0) - 97
    }
  }));
};

// Consolidated move making function
const makeMove = (fromRow, fromCol, toRow, toCol) => {
  const files = ['a','b','c','d','e','f','g','h'];
  const from = files[fromCol] + (8 - fromRow);
  const to = files[toCol] + (8 - toRow);
  
  // Handle promotion
  const moveData = { from, to };
  if (chess.get(from)?.type === 'p' && (toRow === 0 || toRow === 7)) {
    moveData.promotion = 'q';
  }
  
  socket.emit("move", moveData);
  selectedSquare = null;
  renderBoard();
};

// Handle square click (for click-to-move)
const handleSquareClick = (row, col) => {
  if (!gameActive) return;
  
  const files = ['a','b','c','d','e','f','g','h'];
  const square = { row, col };
  const squareKey = files[col] + (8 - row);
  const piece = chess.get(squareKey);
  
  // If a piece is already selected
  if (selectedSquare) {
    // Check if clicking on own piece - change selection
    if (piece && piece.color === playerRole) {
      selectedSquare = square;
      renderBoard();
      return;
    }
    
    // Make the move
    makeMove(selectedSquare.row, selectedSquare.col, row, col);
  } 
  // Select piece if it's player's turn and piece matches player color
  else if (piece && piece.color === playerRole && playerRole === chess.turn()) {
    selectedSquare = square;
    renderBoard();
  }
};

// Update game status display
const updateStatus = (state) => {
  let statusText = "";
  
  if (!state.active) {
    statusText = "Game Over";
    if (state.result) {
      messageElement.innerHTML = getResultMessage(state.result);
      messageElement.classList.remove("hidden");
    }
  } else if (playerRole) {
    statusText = playerRole === state.turn ? "Your turn" : "Opponent's turn";
  } else {
    statusText = "Spectating";
  }
  
  statusElement.textContent = statusText;
};

// Get chess piece Unicode symbols
const getPieceUnicode = (piece) => {
  const unicodePieces = {
    p: "♟", r: "♜", n: "♞", b: "♝", 
    q: "♛", k: "♚", 
    P: "♙", R: "♖", N: "♘", 
    B: "♗", Q: "♕", K: "♔",
  };
  return unicodePieces[piece.type] || "";
};

// Helper to get result message
function getResultMessage(result) {
  switch (result.type) {
    case "checkmate": 
      return `Checkmate! <span class="text-yellow-300">${result.winner === "white" ? "White" : "Black"}</span> wins!`;
    case "stalemate": 
      return "Stalemate! Game drawn";
    case "draw": 
      return "Game drawn";
    case "threefold": 
      return "Draw by threefold repetition";
    case "insufficient": 
      return "Draw by insufficient material";
    default: 
      return "Game over";
  }
}

// Socket event handlers
socket.on("playerRole", (role) => {
  playerRole = role;
  renderBoard();
  updateStatus({turn: chess.turn(), active: true});
});

socket.on("spectatorRole", () => {
  playerRole = null;
  renderBoard();
  updateStatus({turn: chess.turn(), active: true});
});

socket.on("gameState", (state) => {
  chess.load(state.fen);
  gameActive = state.active;
  selectedSquare = null;
  
  // Update UI
  renderBoard();
  updateStatus({
    active: state.active,
    turn: state.turn,
    result: state.result
  });
  
  // Hide message if game is active
  if (state.active) {
    messageElement.classList.add("hidden");
  }
});

socket.on("aiError", (message) => {
  const notification = document.createElement("div");
  notification.classList.add("notification", "bg-red-500", "text-white", "p-3", "rounded", "mb-4");
  notification.textContent = message;
});

// Reset button handler
resetButton.addEventListener("click", () => {
  socket.emit("resetGame");
});

// Play Again button handler
document.getElementById("play-again-btn").addEventListener("click", () => {
  socket.emit("resetGame");
});

// Initial render
renderBoard();
updateStatus({ active: true, turn: "w" });