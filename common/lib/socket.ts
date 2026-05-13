import { io, Socket } from "socket.io-client";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export const initSocket = () => {
  if (socket) {
    socket.disconnect();
  }

  socket = io({
    withCredentials: true,
  });

  return socket;
};

export const disconnectSocket = () => {
  if (!socket) return;

  socket.disconnect();
  socket = null;
};

export const getSocket = (): Socket<ServerToClientEvents, ClientToServerEvents> => {
  if (!socket) {
    throw new Error("Socket not initialized. Call initSocket after authentication.");
  }
  return socket;
};
