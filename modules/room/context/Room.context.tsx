import {
  createContext,
  Dispatch,
  ReactChild,
  RefObject,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import { MotionValue, useMotionValue } from "framer-motion";
import { toast } from "react-toastify";

import { COLORS_ARRAY } from "@/common/constants/colors";
import { getSocket } from "@/common/lib/socket";
import { useSetUsers } from "@/common/recoil/room";
import { useSetRoom, useRoom } from "@/common/recoil/room/room.hooks";

export const roomContext = createContext<{
  x: MotionValue<number>;
  y: MotionValue<number>;
  undoRef: RefObject<HTMLButtonElement>;
  redoRef: RefObject<HTMLButtonElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  bgRef: RefObject<HTMLCanvasElement>;
  selectionRefs: RefObject<HTMLButtonElement[]>;
  minimapRef: RefObject<HTMLCanvasElement>;
  moveImage: { base64: string; x?: number; y?: number };
  setMoveImage: Dispatch<
    SetStateAction<{
      base64: string;
      x?: number | undefined;
      y?: number | undefined;
    }>
  >;
  undoneIds: Set<string>;
}>(null!);

const RoomContextProvider = ({ children }: { children: ReactChild }) => {
  const setRoom = useSetRoom();
  const { users } = useRoom();
  const { handleAddUser, handleRemoveUser } = useSetUsers();

  const undoRef = useRef<HTMLButtonElement>(null);
  const redoRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const selectionRefs = useRef<HTMLButtonElement[]>([]);

  const [moveImage, setMoveImage] = useState<{
    base64: string;
    x?: number;
    y?: number;
  }>({ base64: "" });

  const [undoneIds, setUndoneIds] = useState<Set<string>>(new Set());

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => {
    try {
      const socket = getSocket();

      socket.on(
        "room",
        (
          room: { drawed: Move[] },
          usersMovesToParse: string,
          usersToParse: string,
          redoMovesToParse: string,
          undoneIds?: string[]
        ) => {
          const usersMoves = new Map<string, Move[]>(JSON.parse(usersMovesToParse));
          const redoMoves = new Map<string, Move[]>(JSON.parse(redoMovesToParse));
          const usersParsed = new Map<string, string>(JSON.parse(usersToParse));

          const newUsers = new Map<string, User>();

          usersParsed.forEach((name: string, id: string) => {
            if (id === socket.id) return;

            const index = [...usersParsed.keys()].indexOf(id);

            const color = COLORS_ARRAY[index % COLORS_ARRAY.length];

            newUsers.set(id, {
              name,
              color,
              userId: id,
            });
          });

          setRoom((prev) => ({
            ...prev,
            users: newUsers,
            usersMoves,
            redoMoves,
            movesWithoutUser: room.drawed,
          }));

          // Track which move IDs have been undone globally
          setUndoneIds(new Set(undoneIds ?? []));
        }
      );

      socket.on("new_user", (userId: string, username: string) => {
        toast(`${username} has joined the room.`, {
          position: "top-center",
          theme: "colored",
        });

        handleAddUser(userId, username);
      });

      socket.on("user_disconnected", (userId: string) => {
        toast(`${users.get(userId)?.name || "Anonymous"} has left the room.`, {
          position: "top-center",
          theme: "colored",
        });

        handleRemoveUser(userId);
      });

      socket.on("user_undo", (userId: string, moveId: string) => {
        // Mark this move ID as undone globally
        setUndoneIds((prev) => {
          const updated = new Set(prev);
          updated.add(moveId);
          return updated;
        });
      });

      socket.on("user_redo", (userId: string, moveId: string) => {
        // Move is no longer undone
        setUndoneIds((prev) => {
          const updated = new Set(prev);
          updated.delete(moveId);
          return updated;
        });
      });

      return () => {
        socket.off("room");
        socket.off("new_user");
        socket.off("user_disconnected");
        socket.off("user_undo");
        socket.off("user_redo");
      };
    } catch {
      // Socket not initialized
    }
  }, [handleAddUser, handleRemoveUser, setRoom, users]);

  return (
    <roomContext.Provider
      value={{
        x,
        y,
        bgRef,
        undoRef,
        redoRef,
        canvasRef,
        setMoveImage,
        moveImage,
        minimapRef,
        selectionRefs,
        undoneIds,
      }}
    >
      {children}
    </roomContext.Provider>
  );
};

export default RoomContextProvider;
