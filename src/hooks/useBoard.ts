import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardColumn } from "../types/board";
import * as service from "../services/boardService";

export function useBoard(onError: (message: string) => void, refreshNotes: () => Promise<void>) {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const queue = useRef(Promise.resolve());

  const refresh = useCallback(async () => {
    try {
      setColumns(await service.listBoardColumns());
    } catch (error) {
      onError(error instanceof Error ? error.message : "读取看板栏目失败");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback((action: () => Promise<void>) => {
    let result = false;
    const operation = queue.current.catch(() => undefined).then(async () => {
      try {
        await action();
        await Promise.all([refresh(), refreshNotes()]);
        result = true;
      } catch (error) {
        onError(error instanceof Error ? error.message : "看板操作失败");
      }
    });
    queue.current = operation;
    return operation.then(() => result);
  }, [onError, refresh, refreshNotes]);

  return {
    columns,
    loading,
    refresh,
    create: (name: string) => run(() => service.createBoardColumn(name)),
    rename: (id: string, name: string) => run(() => service.renameBoardColumn(id, name)),
    reorder: (id: string, targetId: string, position: "before" | "after") =>
      run(() => service.reorderBoardColumn(id, targetId, position)),
    remove: (id: string, moveToId?: string) => run(() => service.deleteBoardColumn(id, moveToId)),
    moveNote: (noteId: number, columnId: string, targetId: number | null, position: "before" | "after" = "after") =>
      run(() => service.moveBoardNote(noteId, columnId, targetId, position))
  };
}

