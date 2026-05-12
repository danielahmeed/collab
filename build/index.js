"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const express_1 = __importDefault(require("express"));
const mongodb_1 = require("mongodb");
const next_1 = __importDefault(require("next"));
const socket_io_1 = require("socket.io");
const uuid_1 = require("uuid");
const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const mongoDbName = process.env.MONGODB_DB_NAME || "digiboard";
const nextApp = (0, next_1.default)({ dev });
const nextHandler = nextApp.getRequestHandler();
nextApp.prepare().then(async () => {
    const app = (0, express_1.default)();
    const server = (0, http_1.createServer)(app);
    const mongoClient = new mongodb_1.MongoClient(mongoUri, {
        // Assumption: this app runs as a long-lived Node server process.
        maxPoolSize: 50,
        minPoolSize: 10,
        maxIdleTimeMS: 5 * 60 * 1000,
        connectTimeoutMS: 10 * 1000,
        socketTimeoutMS: 30 * 1000,
        serverSelectionTimeoutMS: 5 * 1000,
    });
    await mongoClient.connect();
    const roomsCollection = mongoClient
        .db(mongoDbName)
        .collection("rooms");
    const io = new socket_io_1.Server(server);
    app.get("/health", async (_, res) => {
        res.send("Healthy");
    });
    const rooms = new Map();
    const roomSnapshotTimers = new Map();
    const getRoomSnapshot = (room) => {
        const activeUserMoves = [...room.usersMoves.values()].flat();
        return [...room.drawed, ...activeUserMoves];
    };
    const clearRoomSnapshotTimer = (roomId) => {
        const timer = roomSnapshotTimers.get(roomId);
        if (timer)
            clearTimeout(timer);
        roomSnapshotTimers.delete(roomId);
    };
    const queueRoomSnapshot = (roomId, room) => {
        clearRoomSnapshotTimer(roomId);
        const timer = setTimeout(() => {
            roomSnapshotTimers.delete(roomId);
            void saveRoomSnapshot(roomId, room);
        }, 500);
        roomSnapshotTimers.set(roomId, timer);
    };
    const saveRoomSnapshot = async (roomId, room) => {
        await roomsCollection.updateOne({ _id: roomId }, {
            $set: {
                drawed: getRoomSnapshot(room),
                updatedAt: new Date(),
            },
            $setOnInsert: {
                createdAt: new Date(),
            },
        }, { upsert: true });
    };
    const loadRoomFromDb = async (roomId) => {
        const savedRoom = await roomsCollection.findOne({ _id: roomId });
        if (!savedRoom)
            return null;
        const hydratedRoom = {
            usersMoves: new Map(),
            redoMoves: new Map(),
            drawed: savedRoom.drawed || [],
            users: new Map(),
        };
        rooms.set(roomId, hydratedRoom);
        return hydratedRoom;
    };
    const getOrLoadRoom = async (roomId) => {
        const inMemoryRoom = rooms.get(roomId);
        if (inMemoryRoom)
            return inMemoryRoom;
        return loadRoomFromDb(roomId);
    };
    const addMove = (roomId, socketId, move) => {
        const room = rooms.get(roomId);
        if (!room || !room.users.has(socketId))
            return false;
        if (!room.usersMoves.has(socketId)) {
            room.usersMoves.set(socketId, []);
        }
        room.redoMoves.set(socketId, []);
        room.usersMoves.get(socketId).push(move);
        return true;
    };
    const undoMove = (roomId, socketId) => {
        var _a;
        const room = rooms.get(roomId);
        if (!room || !room.users.has(socketId))
            return false;
        const move = (_a = room.usersMoves.get(socketId)) === null || _a === void 0 ? void 0 : _a.pop();
        if (!move)
            return false;
        if (!room.redoMoves.has(socketId)) {
            room.redoMoves.set(socketId, []);
        }
        room.redoMoves.get(socketId).push(move);
        return true;
    };
    const redoMove = (roomId, socketId) => {
        var _a;
        const room = rooms.get(roomId);
        if (!room || !room.users.has(socketId))
            return false;
        const move = (_a = room.redoMoves.get(socketId)) === null || _a === void 0 ? void 0 : _a.pop();
        if (!move)
            return false;
        if (!room.usersMoves.has(socketId)) {
            room.usersMoves.set(socketId, []);
        }
        room.usersMoves.get(socketId).push(move);
        return move;
    };
    io.on("connection", (socket) => {
        const getRoomId = () => {
            const joinedRoom = [...socket.rooms].find((room) => room !== socket.id);
            if (!joinedRoom)
                return socket.id;
            return joinedRoom;
        };
        const leaveRoom = async (roomId, socketId) => {
            const room = rooms.get(roomId);
            if (!room)
                return;
            const userMoves = room.usersMoves.get(socketId);
            // Finalize this user's moves into drawed when they leave
            if (userMoves)
                room.drawed.push(...userMoves);
            room.usersMoves.delete(socketId);
            room.redoMoves.delete(socketId);
            room.users.delete(socketId);
            clearRoomSnapshotTimer(roomId);
            // Only save to DB when all users leave (finalize session)
            if (room.users.size === 0) {
                await saveRoomSnapshot(roomId, room);
                rooms.delete(roomId);
            }
            else {
                // Partial save of current state for recovery
                await saveRoomSnapshot(roomId, room);
            }
            socket.leave(roomId);
        };
        socket.on("create_room", async (username) => {
            let roomId;
            do {
                roomId = Math.random().toString(36).substring(2, 6);
            } while (rooms.has(roomId) ||
                !!(await roomsCollection.findOne({ _id: roomId }, { projection: { _id: 1 } })));
            socket.join(roomId);
            const createdRoom = {
                usersMoves: new Map([[socket.id, []]]),
                redoMoves: new Map([[socket.id, []]]),
                drawed: [],
                users: new Map([[socket.id, username]]),
            };
            rooms.set(roomId, createdRoom);
            // Do NOT save empty room - let drawing happen first for speed
            io.to(socket.id).emit("created", roomId);
        });
        socket.on("check_room", async (roomId) => {
            if (rooms.has(roomId)) {
                socket.emit("room_exists", true);
                return;
            }
            const roomExists = !!(await roomsCollection.findOne({ _id: roomId }, { projection: { _id: 1 } }));
            socket.emit("room_exists", roomExists);
        });
        socket.on("join_room", async (roomId, username) => {
            const room = await getOrLoadRoom(roomId);
            if (room && room.users.size < 12) {
                socket.join(roomId);
                room.users.set(socket.id, username);
                room.usersMoves.set(socket.id, []);
                room.redoMoves.set(socket.id, []);
                // Do NOT save on join - let drawing happen in memory for speed
                io.to(socket.id).emit("joined", roomId);
            }
            else
                io.to(socket.id).emit("joined", "", true);
        });
        socket.on("joined_room", async () => {
            const roomId = getRoomId();
            const room = await getOrLoadRoom(roomId);
            if (!room)
                return;
            // Properly serialize the Map to Array of [key, value] pairs
            const usersMovesSerialized = Array.from(room.usersMoves.entries());
            const usersSerialized = Array.from(room.users.entries());
            const redoMovesSerialized = Array.from(room.redoMoves.entries());
            // Create a plain object compatible with Room type (Maps will be handled by client)
            const roomToSend = {
                drawed: room.drawed,
                usersMoves: new Map(),
                redoMoves: new Map(),
                users: new Map(), // Empty map, will be replaced by client
            };
            io.to(socket.id).emit("room", roomToSend, JSON.stringify(usersMovesSerialized), JSON.stringify(usersSerialized), JSON.stringify(redoMovesSerialized));
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
            if (!room || !room.users.has(socket.id))
                return;
            const timestamp = Date.now();
            // eslint-disable-next-line no-param-reassign
            move.id = (0, uuid_1.v4)();
            const added = addMove(roomId, socket.id, Object.assign(Object.assign({}, move), { timestamp }));
            if (!added)
                return;
            queueRoomSnapshot(roomId, room);
            // Broadcast to ALL users in the room (including sender for consistency)
            // Note: Do NOT save to DB on every draw - keep it in memory for speed
            io.to(roomId).emit("user_draw", Object.assign(Object.assign({}, move), { timestamp }), socket.id);
        });
        socket.on("undo", async () => {
            const roomId = getRoomId();
            const room = await getOrLoadRoom(roomId);
            if (!room || !room.users.has(socket.id))
                return;
            const removed = undoMove(roomId, socket.id);
            if (!removed)
                return;
            queueRoomSnapshot(roomId, room);
            // Broadcast to ALL users in the room
            // Note: Do NOT save to DB on undo - keep it in memory for speed
            io.to(roomId).emit("user_undo", socket.id);
        });
        socket.on("redo", async () => {
            const roomId = getRoomId();
            const room = await getOrLoadRoom(roomId);
            if (!room || !room.users.has(socket.id))
                return;
            const restored = redoMove(roomId, socket.id);
            if (!restored)
                return;
            queueRoomSnapshot(roomId, room);
            io.to(roomId).emit("user_draw", restored, socket.id);
        });
        socket.on("mouse_move", (x, y) => {
            io.to(getRoomId()).emit("mouse_moved", x, y, socket.id);
        });
        socket.on("send_msg", async (msg) => {
            const roomId = getRoomId();
            const room = await getOrLoadRoom(roomId);
            if (!room || !room.users.has(socket.id))
                return;
            io.to(roomId).emit("new_msg", socket.id, msg);
        });
        socket.on("disconnecting", async () => {
            const roomId = getRoomId();
            await leaveRoom(roomId, socket.id);
            io.to(roomId).emit("user_disconnected", socket.id);
        });
    });
    app.all("*", (req, res) => nextHandler(req, res));
    server.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`> Ready on http://localhost:${port}`);
    });
});
