import { io, Socket } from "socket.io-client";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export const initSocket = (token: string) => {
  if (socket) {
    socket.disconnect();
  }

  socket = io({
    auth: {
      token,
    },
  });

  return socket;
};

export const getSocket = (): Socket<ServerToClientEvents, ClientToServerEvents> => {
  if (!socket) {
    throw new Error("Socket not initialized. Call initSocket with a token first.");
  }
  return socket;
};
