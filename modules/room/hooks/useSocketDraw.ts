import { useEffect } from "react";

import { getSocket } from "@/common/lib/socket";
import { useSetUsers } from "@/common/recoil/room";

export const useSocketDraw = (drawing: boolean) => {
  const { handleAddMoveToUser, handleRemoveMoveFromUser } = useSetUsers();

  // Keep user_draw listener alive (don't resubscribe on drawing state change)
  useEffect(() => {
    try {
      const socket = getSocket();
      socket.on("user_draw", (move, userId) => {
        handleAddMoveToUser(userId, move);
      });

      return () => {
        socket.off("user_draw");
      };
    } catch {
      // Socket not available
    }
  }, [handleAddMoveToUser]);

  useEffect(() => {
    try {
      const socket = getSocket();
      socket.on("user_undo", (userId) => {
        handleRemoveMoveFromUser(userId);
      });

      return () => {
        socket.off("user_undo");
      };
    } catch {
      // Socket not available
    }
  }, [handleRemoveMoveFromUser]);
};
