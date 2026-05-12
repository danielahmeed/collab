import { useRef } from "react";

import { motion } from "framer-motion";
import { useInterval, useMouse } from "react-use";

import { getPos } from "@/common/lib/getPos";
import { getSocket } from "@/common/lib/socket";

import { useBoardPosition } from "../../hooks/useBoardPosition";

const MousePosition = () => {
  const { x, y } = useBoardPosition();

  const prevPosition = useRef({ x: 0, y: 0 });

  const ref = useRef<HTMLDivElement>(null);

  const { docX, docY } = useMouse(ref);

  const touchDevice = window.matchMedia("(pointer: coarse)").matches;

  useInterval(() => {
    if (
      (prevPosition.current.x !== docX || prevPosition.current.y !== docY) &&
      !touchDevice
    ) {
      try {
        const socket = getSocket();
        socket.emit("mouse_move", getPos(docX, x), getPos(docY, y));
      } catch {
        // Socket not available
      }
      prevPosition.current = { x: docX, y: docY };
    }
  }, 250);

  if (touchDevice) return null;

  return (
    <motion.div
      ref={ref}
      className="pointer-events-none absolute top-0 left-0 z-50 select-none transition-colors dark:text-white"
      animate={{ x: docX + 15, y: docY + 15 }}
      transition={{ duration: 0.05, ease: "linear" }}
    >
      {getPos(docX, x).toFixed(0)} | {getPos(docY, y).toFixed(0)}
    </motion.div>
  );
};

export default MousePosition;
