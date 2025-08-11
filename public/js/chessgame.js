const socket=io(); 
const chess=new Chess();
const boardElement=document.querySelector(".chessboard");

let draggedPiece=null;
let sourceSquare=null;
let playerRole=null;

const renderBoard=()=>{
    const board=chess.board();
    boardElement.innerHTML="";
    board.forEach((row,rowindex)=>{
        row.forEach((square,squareindex)=>{
            const squareElement=document.createElement("div");
            squareElement.classList.add("square",
             (rowindex + squareindex)%2==0?"light":"dark" 
            );

            // Add missing dataset attributes
            squareElement.dataset.row = rowindex;
            squareElement.dataset.col = squareindex;

            if(square){
                const pieceElement=document.createElement("div");
                pieceElement.classList.add("piece",
                    square.color==="w"?"white":"black"
                );
                pieceElement.innerText=getPieceUnicode(square);
                pieceElement.draggable=playerRole===square.color;

                pieceElement.addEventListener("dragstart",(e)=>{
                    if(pieceElement.draggable){
                        draggedPiece=pieceElement;
                        // Fixed: change column to col
                        sourceSquare={row:rowindex,col:squareindex};
                        e.dataTransfer.setData("text/plain","");
                    }
                });

                pieceElement.addEventListener("dragend",(e)=>{
                    draggedPiece=null;
                    sourceSquare=null;
                });
                squareElement.append(pieceElement);
            }
            squareElement.addEventListener('dragover',function(e){
                e.preventDefault();
            });
            
            // Move handleMove to drop event
            squareElement.addEventListener('drop',function(e){
                e.preventDefault();
                if(draggedPiece){
                    const targetSource={
                        row:parseInt(squareElement.dataset.row),
                        col:parseInt(squareElement.dataset.col)
                    };
                    handleMove(sourceSquare,targetSource);
                }
            });
            boardElement.appendChild(squareElement);
        });
    });
};

const handleMove=(source,target)=>{
    // Fixed chess notation conversion
    const files = ['a','b','c','d','e','f','g','h'];
    const from = files[source.col] + (8 - source.row);
    const to = files[target.col] + (8 - target.row);
    
    socket.emit("move",{
        from: from,
        to: to,
        promotion: 'q'
    });
    
};

const getPieceUnicode = (piece) => {
    const unicodePieces = {
        p: "♟",
        r: "♜",
        n: "♞",
        b: "♝",
        q: "♛",
        k: "♚",
        P: "♙",
        R: "♖",
        N: "♘",
        B: "♗",
        Q: "♕",
        K: "♔",
    };
    return unicodePieces[piece.type] || "";
};

socket.on("playerRole",function(role){
    playerRole=role;
    renderBoard();
});

socket.on("spectatorRole",function(){
    playerRole=null;
    renderBoard();
})
socket.on("boardState",function(fen){
    chess.load(fen);
    renderBoard();
})
socket.on("move",function(fen){
    chess.move(fen);
    renderBoard();
})

renderBoard();