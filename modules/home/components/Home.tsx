import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { useRouter } from "next/router";

import { disconnectSocket, getSocket, initSocket } from "@/common/lib/socket";
import { useModal } from "@/common/recoil/modal";
import { useSetRoomId } from "@/common/recoil/room";

import NotFoundModal from "../modals/NotFound";

const Home = () => {
  const { openModal } = useModal();
  const setAtomRoomId = useSetRoomId();

  const [roomId, setRoomId] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");

  const router = useRouter();

  useEffect(() => {
    document.body.style.backgroundColor = "white";

    const restoreSession = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          authenticated: boolean;
          userId: string;
          username: string;
          email: string;
          picture?: string | null;
        };

        if (data.authenticated) {
          setDisplayName(data.username);
          initSocket();
          setIsAuthenticated(true);
        }
      } catch {
        return;
      }
    };

    void restoreSession();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = getSocket();

    socket.on("created", (roomIdFromServer) => {
      setAtomRoomId(roomIdFromServer);
      router.push(roomIdFromServer);
    });

    const handleJoinedRoom = (roomIdFromServer: string, failed?: boolean) => {
      if (!failed) {
        setAtomRoomId(roomIdFromServer);
        router.push(roomIdFromServer);
      } else {
        openModal(<NotFoundModal id={roomId} />);
      }
    };

    socket.on("joined", handleJoinedRoom);

    return () => {
      socket.off("created");
      socket.off("joined", handleJoinedRoom);
    };
  }, [openModal, roomId, router, setAtomRoomId, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = getSocket();
    socket.emit("leave_room");
    setAtomRoomId("");

    return () => {
      setAtomRoomId("");
    };
  }, [setAtomRoomId, isAuthenticated]);

  const handleGoogleLogin = () => {
    setIsLoading(true);
    window.location.href = "/api/auth/google/start";
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      disconnectSocket();
    }

    setIsAuthenticated(false);
    setDisplayName("");
    setRoomId("");
    setAtomRoomId("");
  };

  const handleCreateRoom = () => {
    const socket = getSocket();
    socket.emit("create_room");
  };

  const handleJoinRoom = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (roomId) {
      const socket = getSocket();
      socket.emit("join_room", roomId);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-white via-zinc-50 to-zinc-100 px-6 py-24">
        <h1 className="text-5xl font-extrabold leading-tight sm:text-6xl">
          Digiboard
        </h1>
        <h3 className="text-xl sm:text-2xl text-zinc-600">Real-time whiteboard</h3>

        <p className="mt-3 max-w-md text-center text-sm text-zinc-500">
          Sign in with Google to use your Gmail account and keep your session stored securely on the server.
        </p>

        <button className="btn mt-10 min-w-72" onClick={handleGoogleLogin} disabled={isLoading}>
          {isLoading ? "Redirecting to Google..." : "Continue with Google"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-24">
      <div className="absolute top-5 right-5">
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <span>{displayName || "Signed in"}</span>
          <button className="hover:text-zinc-700" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <h1 className="text-5xl font-extrabold leading-tight sm:text-extra">
        Digiboard
      </h1>
      <h3 className="text-xl sm:text-2xl">Real-time whiteboard</h3>

      <div className="my-8 h-px w-96 bg-zinc-200" />

      <form
        className="flex flex-col items-center gap-3"
        onSubmit={handleJoinRoom}
      >
        <label htmlFor="room-id" className="self-start font-bold leading-tight">
          Enter room id
        </label>
        <input
          className="input"
          id="room-id"
          placeholder="Room id..."
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />
        <button className="btn" type="submit">
          Join
        </button>
      </form>

      <div className="my-8 flex w-96 items-center gap-2">
        <div className="h-px w-full bg-zinc-200" />
        <p className="text-zinc-400">or</p>
        <div className="h-px w-full bg-zinc-200" />
      </div>

      <div className="flex flex-col items-center gap-2">
        <h5 className="self-start font-bold leading-tight">Create new room</h5>

        <button className="btn" onClick={handleCreateRoom}>
          Create
        </button>
      </div>
    </div>
  );
};

export default Home;
