import { FormEvent, useEffect, useState } from "react";

import { useRouter } from "next/router";

import { initSocket, getSocket } from "@/common/lib/socket";
import { useModal } from "@/common/recoil/modal";
import { useSetRoomId } from "@/common/recoil/room";

import NotFoundModal from "../modals/NotFound";

const Home = () => {
  const { openModal } = useModal();
  const setAtomRoomId = useSetRoomId();

  const [roomId, setRoomId] = useState("");
  const [username, setUsername] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const router = useRouter();

  useEffect(() => {
    document.body.style.backgroundColor = "white";

    // Check if token exists in localStorage
    const storedToken = localStorage.getItem("auth_token");
    if (storedToken) {
      initSocket(storedToken);
      setIsAuthenticated(true);
    }
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

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      if (!response.ok) {
        throw new Error("Login failed");
      }

      const { token } = await response.json();
      localStorage.setItem("auth_token", token);
      initSocket(token);
      setIsAuthenticated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    setIsAuthenticated(false);
    setUsername("");
    setRoomId("");
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
      <div className="flex flex-col items-center py-24">
        <h1 className="text-5xl font-extrabold leading-tight sm:text-extra">
          Digiboard
        </h1>
        <h3 className="text-xl sm:text-2xl">Real-time whiteboard</h3>

        <form
          className="mt-10 flex flex-col items-center gap-3 w-96"
          onSubmit={handleLogin}
        >
          <label className="self-start font-bold leading-tight">
            Enter your name to continue
          </label>
          <input
            className="input"
            id="username"
            placeholder="Username..."
            value={username}
            onChange={(e) => setUsername(e.target.value.slice(0, 15))}
            disabled={isLoading}
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button className="btn" type="submit" disabled={isLoading || !username}>
            {isLoading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-24">
      <div className="absolute top-5 right-5">
        <button
          className="text-sm text-zinc-500 hover:text-zinc-700"
          onClick={handleLogout}
        >
          Logout
        </button>
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
