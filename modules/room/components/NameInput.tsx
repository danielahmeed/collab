import { FormEvent, useEffect, useState } from "react";

import { useRouter } from "next/router";

import { getSocket } from "@/common/lib/socket";
import { useModal } from "@/common/recoil/modal";
import { useSetRoomId } from "@/common/recoil/room";
import NotFoundModal from "@/modules/home/modals/NotFound";

const NameInput = () => {
  const setRoomId = useSetRoomId();
  const { openModal } = useModal();

  const router = useRouter();
  const roomId = (router.query.roomId || "").toString();

  useEffect(() => {
    if (!roomId) return;

    try {
      const socket = getSocket();
      socket.emit("check_room", roomId);

      socket.on("room_exists", (exists) => {
        if (!exists) {
          router.push("/");
        }
      });

      // eslint-disable-next-line consistent-return
      return () => {
        socket.off("room_exists");
      };
    } catch {
      // Socket not initialized yet, redirect to home
      router.push("/");
    }
  }, [roomId, router]);

  useEffect(() => {
    try {
      const socket = getSocket();
      const handleJoined = (roomIdFromServer: string, failed?: boolean) => {
        if (failed) {
          router.push("/");
          openModal(<NotFoundModal id={roomIdFromServer} />);
        } else setRoomId(roomIdFromServer);
      };

      socket.on("joined", handleJoined);

      return () => {
        socket.off("joined", handleJoined);
      };
    } catch {
      // Socket not initialized
    }
  }, [openModal, router, setRoomId]);

  const handleJoinRoom = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      const socket = getSocket();
      socket.emit("join_room", roomId);
    } catch {
      router.push("/");
    }
  };

  return (
    <form
      className="my-24 flex flex-col items-center"
      onSubmit={handleJoinRoom}
    >
      <h1 className="text-5xl font-extrabold leading-tight sm:text-extra">
        Digiboard
      </h1>
      <h3 className="text-xl sm:text-2xl">Real-time whiteboard</h3>

      <div className="mt-10 mb-3 flex flex-col gap-2">
        <label className="self-start font-bold leading-tight">
          Entering room {roomId}
        </label>
      </div>

      <button className="btn" type="submit">
        Enter room
      </button>
    </form>
  );
};

export default NameInput;
