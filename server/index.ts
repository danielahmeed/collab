import { createServer } from "http";

import {} from "../common/types/global";

import express from "express";
import { Collection, MongoClient } from "mongodb";
import next, { NextApiHandler } from "next";
import { Server } from "socket.io";
import { v4 } from "uuid";
import { generateToken, verifyToken } from "../common/lib/jwt";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const mongoDbName = process.env.MONGODB_DB_NAME || "digiboard";
const nextApp = next({ dev });
const nextHandler: NextApiHandler = nextApp.getRequestHandler();

type PersistedRoom = {
  _id: string;
  drawed: Move[];
  createdAt: Date;
  updatedAt: Date;
};

console.log("Preparing nextApp...");
nextApp.prepare().then(async () => {
  console.log("nextApp prepared. Setting up express...");
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  const mongoClient = new MongoClient(mongoUri, {
    // Assumption: this app runs as a long-lived Node server process.
    maxPoolSize: 50,
    minPoolSize: 10,
    maxIdleTimeMS: 5 * 60 * 1000,
    connectTimeoutMS: 10 * 1000,
    socketTimeoutMS: 30 * 1000,
    serverSelectionTimeoutMS: 5 * 1000,
  });

  console.log("Connecting to MongoDB...");
  let roomsCollection: Collection<PersistedRoom> | null = null;
  try {
    await mongoClient.connect();
    console.log("Connected to MongoDB");
    roomsCollection = mongoClient
      .db(mongoDbName)
      .collection<PersistedRoom>("rooms");
  } catch (err) {
    // If MongoDB is not available, continue running with in-memory state only.
    // This prevents the process from crashing on startup in environments
    // where a MongoDB instance isn't provisioned (e.g., quick deploys).
    // Persistence-related operations will become no-ops.
    // eslint-disable-next-line no-console
    console.warn("Could not connect to MongoDB, running without persistence:", err);
  }

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: { origin: "*" },
  });

  // Socket.IO authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string;
    if (!token) {
      socket.emit("auth_required");
      return next(new Error("Authentication required"));
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return next(new Error("Invalid or expired token"));
    }

    // Store user info on socket
    (socket as any).userId = decoded.userId;
    (socket as any).username = decoded.username;
    authenticatedUsers.set(socket.id, { userId: decoded.userId, username: decoded.username });

    next();
  });

  // Track authenticated users by socket ID
  const authenticatedUsers = new Map<string, { userId: string; username: string }>();

  app.get("/health", async (_, res) => {
    res.send("Healthy");
  });

  app.post("/api/auth/login", (req, res) => {
    const { username } = req.body;
    if (!username || typeof username !== "string") {
      res.status(400).json({ error: "Username is required" });
      return;
    }

    const userId = v4();
    const token = generateToken(userId, username);
    res.json({ token, userId, username });
  });

  const rooms = new Map<string, Room>();
  const roomSnapshotTimers = new Map<string, NodeJS.Timeout>();
  const roomLogicalClocks = new Map<string, number>();
  const roomUndoneIds = new Map<string, Set<string>>();

  const getLogicalTimestamp = (roomId: string): number => {
    const current = roomLogicalClocks.get(roomId) ?? 0;
    const next = current + 1;
    roomLogicalClocks.set(roomId, next);
    return next;
  };

  const getRoomSnapshot = (room: Room) => {
    const activeUserMoves = [...room.usersMoves.values()].flat();
    return [...room.drawed, ...activeUserMoves];
  };

  const clearRoomSnapshotTimer = (roomId: string) => {
    const timer = roomSnapshotTimers.get(roomId);
    if (timer) clearTimeout(timer);
    roomSnapshotTimers.delete(roomId);
  };

  const queueRoomSnapshot = (roomId: string, room: Room) => {
    clearRoomSnapshotTimer(roomId);

    const timer = setTimeout(() => {
      roomSnapshotTimers.delete(roomId);
      void saveRoomSnapshot(roomId, room);
    }, 500);

    roomSnapshotTimers.set(roomId, timer);
  };

  const saveRoomSnapshot = async (roomId: string, room: Room) => {
    if (!roomsCollection) return;
    await roomsCollection.updateOne(
      { _id: roomId },
      {
        $set: {
          drawed: getRoomSnapshot(room),
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  };

  const loadRoomFromDb = async (roomId: string) => {
    if (!roomsCollection) return null;
    const savedRoom = await roomsCollection.findOne({ _id: roomId });
    if (!savedRoom) return null;

    const hydratedRoom: Room = {
      usersMoves: new Map(),
      redoMoves: new Map(),
      drawed: savedRoom.drawed || [],
      users: new Map(),
    };

    rooms.set(roomId, hydratedRoom);
    
    // Initialize logical clock based on max logicalTimestamp in drawed moves
    const maxLogical = Math.max(
      0,
      ...savedRoom.drawed.map((m) => m.logicalTimestamp ?? 0)
    );
    roomLogicalClocks.set(roomId, maxLogical);

    return hydratedRoom;
  };

  const getOrLoadRoom = async (roomId: string) => {
    const inMemoryRoom = rooms.get(roomId);
    if (inMemoryRoom) return inMemoryRoom;

    return loadRoomFromDb(roomId);
  };

  const addMove = (roomId: string, socketId: string, move: Move) => {
    const room = rooms.get(roomId);
    if (!room || !room.users.has(socketId)) return false;

    if (!room.usersMoves.has(socketId)) {
      room.usersMoves.set(socketId, []);
    }

    room.redoMoves.set(socketId, []);
    room.usersMoves.get(socketId)!.push(move);

    return true;
  };

  const undoMove = (roomId: string, socketId: string): string | null => {
    const room = rooms.get(roomId);
    if (!room || !room.users.has(socketId)) return null;

    const move = room.usersMoves.get(socketId)?.pop();
    if (!move) return null;

    if (!room.redoMoves.has(socketId)) {
      room.redoMoves.set(socketId, []);
    }

    room.redoMoves.get(socketId)!.push(move);

    // Track this move as undone globally
    if (!roomUndoneIds.has(roomId)) {
      roomUndoneIds.set(roomId, new Set());
    }
    roomUndoneIds.get(roomId)!.add(move.id);

    return move.id;
  };

  const redoMove = (roomId: string, socketId: string): Move | null => {
    const room = rooms.get(roomId);
    if (!room || !room.users.has(socketId)) return null;

    const move = room.redoMoves.get(socketId)?.pop();
    if (!move) return null;

    if (!room.usersMoves.has(socketId)) {
      room.usersMoves.set(socketId, []);
    }

    room.usersMoves.get(socketId)!.push(move);

    // Remove from undone tracking when redone
    if (roomUndoneIds.has(roomId)) {
      roomUndoneIds.get(roomId)!.delete(move.id);
    }

    return move;
  };

  io.on("disconnect", (socket) => {
    authenticatedUsers.delete(socket.id);
  });

  io.on("connection", (socket) => {
    const userId = (socket as any).userId as string;
    const username = (socket as any).username as string;
    const getRoomId = () => {
      const joinedRoom = [...socket.rooms].find((room) => room !== socket.id);

      if (!joinedRoom) return socket.id;

      return joinedRoom;
    };

    const leaveRoom = async (roomId: string, socketId: string) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const userMoves = room.usersMoves.get(socketId);

      // Finalize this user's moves into drawed when they leave
      if (userMoves) room.drawed.push(...userMoves);
      room.usersMoves.delete(socketId);
      room.redoMoves.delete(socketId);
      room.users.delete(socketId);

      clearRoomSnapshotTimer(roomId);

      // Only save to DB when all users leave (finalize session)
      if (room.users.size === 0) {
        await saveRoomSnapshot(roomId, room);
        rooms.delete(roomId);
      } else {
        // Partial save of current state for recovery
        await saveRoomSnapshot(roomId, room);
      }

      socket.leave(roomId);
    };

    socket.on("create_room", async () => {
      let roomId: string;

      do {
        roomId = Math.random().toString(36).substring(2, 6);
      } while (
        rooms.has(roomId) ||
        (roomsCollection && !!(await roomsCollection.findOne({ _id: roomId }, { projection: { _id: 1 } })))
      );

      socket.join(roomId);

      const createdRoom: Room = {
        usersMoves: new Map([[socket.id, []]]),
        redoMoves: new Map([[socket.id, []]]),
        drawed: [],
        users: new Map([[socket.id, username]]),
      };

      rooms.set(roomId, createdRoom);
      roomLogicalClocks.set(roomId, 0);

      // Do NOT save empty room - let drawing happen first for speed

      io.to(socket.id).emit("created", roomId);
    });

    socket.on("check_room", async (roomId) => {
      if (rooms.has(roomId)) {
        socket.emit("room_exists", true);
        return;
      }

      const roomExists =
        rooms.has(roomId) ||
        (roomsCollection &&
          !!(await roomsCollection.findOne(
            { _id: roomId },
            { projection: { _id: 1 } }
          )));

      socket.emit("room_exists", !!roomExists);
    });

    socket.on("join_room", async (roomId) => {
      const room = await getOrLoadRoom(roomId);

      if (room && room.users.size < 12) {
        socket.join(roomId);

        room.users.set(socket.id, username);
        room.usersMoves.set(socket.id, []);
        room.redoMoves.set(socket.id, []);

        // Do NOT save on join - let drawing happen in memory for speed

        io.to(socket.id).emit("joined", roomId);
      } else io.to(socket.id).emit("joined", "", true);
    });

    socket.on("joined_room", async () => {
      const roomId = getRoomId();

      const room = await getOrLoadRoom(roomId);
      if (!room) return;

      const undoneIds = roomUndoneIds.get(roomId) ?? new Set<string>();

      // Collect all moves and sort by [logicalTimestamp, userId] for deterministic ordering
      const allMoves = [
        ...room.drawed,
        ...Array.from(room.usersMoves.values()).flat(),
      ]
        // Filter out any undone moves
        .filter((move) => !undoneIds.has(move.id))
        .sort((a, b) => {
          const tsA = a.logicalTimestamp ?? 0;
          const tsB = b.logicalTimestamp ?? 0;
          if (tsA !== tsB) return tsA - tsB;
          // Tie-break by userId alphabetically for determinism
          return (a.userId || "").localeCompare(b.userId || "");
        });

      // Properly serialize the Map to Array of [key, value] pairs
      const usersMovesSerialized = Array.from(room.usersMoves.entries());
      const usersSerialized = Array.from(room.users.entries());
      const redoMovesSerialized = Array.from(room.redoMoves.entries());

      // Create a plain object compatible with Room type (Maps will be handled by client)
      const roomToSend = {
        drawed: allMoves,  // Send all moves sorted by logical order, excluding undone
        usersMoves: new Map(), // Empty map, will be replaced by client
        redoMoves: new Map(),
        users: new Map(), // Empty map, will be replaced by client
      };

      io.to(socket.id).emit(
        "room",
        roomToSend,
        JSON.stringify(usersMovesSerialized),
        JSON.stringify(usersSerialized),
        JSON.stringify(redoMovesSerialized),
        Array.from(undoneIds)  // Send undone IDs so client knows which moves are inactive
      );

      socket.broadcast
        .to(roomId)
        .emit("new_user", socket.id, room.users.get(socket.id) || "Anonymous");
    });

    socket.on("leave_room", async () => {
      const roomId = getRoomId();
      await leaveRoom(roomId, socket.id);

      io.to(roomId).emit("user_disconnected", socket.id);
    });

    socket.on("draw", async (move) => {
      const roomId = getRoomId();
      const room = await getOrLoadRoom(roomId);
      if (!room || !room.users.has(socket.id)) return;

      const timestamp = Date.now();
      const logicalTimestamp = getLogicalTimestamp(roomId);

      // eslint-disable-next-line no-param-reassign
      move.id = v4();

      const moveWithUser = { ...move, timestamp, userId, logicalTimestamp };
      const added = addMove(roomId, socket.id, moveWithUser);
      if (!added) return;

      queueRoomSnapshot(roomId, room);

      // Broadcast to other users in the room
      socket.broadcast.to(roomId).emit("user_draw", moveWithUser, socket.id);
      // Send confirmation to the sender
      socket.emit("your_move", moveWithUser);
    });

    socket.on("undo", async () => {
      const roomId = getRoomId();
      const room = await getOrLoadRoom(roomId);
      if (!room || !room.users.has(socket.id)) return;

      const undoneId = undoMove(roomId, socket.id);
      if (!undoneId) return;

      queueRoomSnapshot(roomId, room);

      // Broadcast the undone move ID to other users so they remove it from their canvas
      socket.broadcast.to(roomId).emit("user_undo", socket.id, undoneId);
    });

    socket.on("redo", async () => {
      const roomId = getRoomId();
      const room = await getOrLoadRoom(roomId);
      if (!room || !room.users.has(socket.id)) return;

      const redoneMove = redoMove(roomId, socket.id);
      if (!redoneMove) return;

      queueRoomSnapshot(roomId, room);

      // Broadcast the redone move ID to other users
      socket.broadcast.to(roomId).emit("user_redo", socket.id, redoneMove.id);
    });

    socket.on("mouse_move", (x, y) => {
      io.to(getRoomId()).emit("mouse_moved", x, y, socket.id);
    });

    socket.on("send_msg", async (msg) => {
      const roomId = getRoomId();
      const room = await getOrLoadRoom(roomId);
      if (!room || !room.users.has(socket.id)) return;

      io.to(roomId).emit("new_msg", socket.id, msg);
    });

    socket.on("disconnecting", async () => {
      const roomId = getRoomId();
      await leaveRoom(roomId, socket.id);

      io.to(roomId).emit("user_disconnected", socket.id);
    });
  });

  // Cleanup when rooms are deleted
  setInterval(() => {
    for (const roomId of roomLogicalClocks.keys()) {
      if (!rooms.has(roomId)) {
        roomLogicalClocks.delete(roomId);
        roomUndoneIds.delete(roomId);
      }
    }
  }, 60000); // Cleanup every minute

  app.all("*", (req: any, res: any) => nextHandler(req, res));

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`> Ready on http://localhost:${port}`);
  });
});
