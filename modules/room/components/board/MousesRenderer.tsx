import { useEffect, useState } from "react";

import { getSocket } from "@/common/lib/socket";
import { useRoom } from "@/common/recoil/room";

import UserMouse from "./UserMouse";

const MousesRenderer = () => {
  const { users } = useRoom();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const socket = getSocket();
      setCurrentUserId(socket.id);
    } catch {
      // Socket not available
    }
  }, []);

  return (
    <>
      {[...users.keys()].map((userId) => {
        if (userId === currentUserId) return null;
        return <UserMouse userId={userId} key={userId} />;
      })}
    </>
  );
};

export default MousesRenderer;
