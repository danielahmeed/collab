import { useState, useRef } from "react";

import { DEFAULT_MOVE } from "@/common/constants/defaultMove";
import { getPos } from "@/common/lib/getPos";
import { getStringFromRgba } from "@/common/lib/rgba";
import { getSocket } from "@/common/lib/socket";
import { useOptionsValue } from "@/common/recoil/options";
import { useSetSelection } from "@/common/recoil/options/options.hooks";
import { useMyMoves } from "@/common/recoil/room";
import { useSetSavedMoves } from "@/common/recoil/savedMoves";

import { drawRect, drawCircle, drawLine } from "../helpers/Canvas.helpers";
import { useBoardPosition } from "./useBoardPosition";
import { useCtx } from "./useCtx";

let tempMoves: [number, number][] = [];
let tempCircle = { cX: 0, cY: 0, radiusX: 0, radiusY: 0 };
let tempSize = { width: 0, height: 0 };
let tempImageData: ImageData | undefined;

export const useDraw = (blocked: boolean) => {
  const options = useOptionsValue();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const boardPosition = useBoardPosition();
  const boardPositionRef = useRef(boardPosition);
  boardPositionRef.current = boardPosition;

  const { clearSavedMoves } = useSetSavedMoves();
  const { handleAddMyMove } = useMyMoves();
  const { setSelection, clearSelection } = useSetSelection();

  const [drawing, setDrawing] = useState(false);
  const ctx = useCtx();

  const setupCtxOptions = () => {
    if (ctx) {
      ctx.lineWidth = optionsRef.current.lineWidth;
      ctx.strokeStyle = getStringFromRgba(optionsRef.current.lineColor);
      ctx.fillStyle = getStringFromRgba(optionsRef.current.fillColor);
      if (optionsRef.current.mode === "eraser")
        ctx.globalCompositeOperation = "destination-out";
      else ctx.globalCompositeOperation = "source-over";
    }
  };

  const drawAndSet = () => {
    if (!tempImageData)
      tempImageData = ctx?.getImageData(
        0,
        0,
        ctx.canvas.width,
        ctx.canvas.height
      );

    if (tempImageData) ctx?.putImageData(tempImageData, 0, 0);
  };

  const handleStartDrawing = (x: number, y: number) => {
    if (!ctx || blocked || blocked) return;

    const movedX = boardPositionRef.current.x;
    const movedY = boardPositionRef.current.y;

    const [finalX, finalY] = [getPos(x, movedX), getPos(y, movedY)];

    setDrawing(true);
    setupCtxOptions();
    drawAndSet();

    if (optionsRef.current.shape === "line" && optionsRef.current.mode !== "select") {
      ctx.beginPath();
      ctx.lineTo(finalX, finalY);
      ctx.stroke();
    }

    tempMoves.push([finalX, finalY]);
  };

  const handleDraw = (x: number, y: number, shift?: boolean) => {
    if (!ctx || !drawing || blocked) return;

    const movedX = boardPositionRef.current.x;
    const movedY = boardPositionRef.current.y;

    const [finalX, finalY] = [getPos(x, movedX), getPos(y, movedY)];

    setupCtxOptions();
    drawAndSet();

    if (optionsRef.current.mode === "select") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      drawRect(ctx, tempMoves[0], finalX, finalY, false, true);
      tempMoves.push([finalX, finalY]);

      setupCtxOptions();

      return;
    }

    switch (optionsRef.current.shape) {
      case "line":
        if (shift) tempMoves = tempMoves.slice(0, 1);

        drawLine(ctx, tempMoves[0], finalX, finalY, shift);

        tempMoves.push([finalX, finalY]);
        break;

      case "circle":
        tempCircle = drawCircle(ctx, tempMoves[0], finalX, finalY, shift);
        break;

      case "rect":
        tempSize = drawRect(ctx, tempMoves[0], finalX, finalY, shift);
        break;

      default:
        break;
    }
  };

  const clearOnYourMove = () => {
    drawAndSet();
    tempImageData = undefined;
  };

  const handleEndDrawing = () => {
    if (!ctx || blocked) return;

    setDrawing(false);

    ctx.closePath();

    const move: Move = {
      ...DEFAULT_MOVE,
      rect: {
        ...tempSize,
      },
      circle: {
        ...tempCircle,
      },
      path: tempMoves,
      options: optionsRef.current,
    };

    let addMove = true;
    if (optionsRef.current.mode === "select" && tempMoves.length) {
      clearOnYourMove();
      let x = tempMoves[0][0];
      let y = tempMoves[0][1];
      let width = tempMoves[tempMoves.length - 1][0] - x;
      let height = tempMoves[tempMoves.length - 1][1] - y;

      if (width < 0) {
        width -= 4;
        x += 2;
      } else {
        width += 4;
        x -= 2;
      }
      if (height < 0) {
        height -= 4;
        y += 2;
      } else {
        height += 4;
        y -= 2;
      }

      if ((width < 4 || width > 4) && (height < 4 || height > 4))
        setSelection({ x, y, width, height });
      else {
        clearSelection();
        addMove = false;
      }
    } else if (optionsRef.current.mode !== "select") {
      try {
        const socket = getSocket();
        socket.emit("draw", move);
      } catch {
        // Socket not available
      }
      clearSavedMoves();
    } else if (addMove) handleAddMyMove(move);

    tempMoves = [];
    tempCircle = { cX: 0, cY: 0, radiusX: 0, radiusY: 0 };
    tempSize = { width: 0, height: 0 };
  };

  return {
    handleEndDrawing,
    handleDraw,
    handleStartDrawing,
    drawing,
    clearOnYourMove,
  };
};
