import { useCallback, useRef } from "react";
import { useCategoryStore } from "../stores/categoryStore";
import * as service from "../services/categoryService";
import type { CategoryDeleteStrategy } from "../types/category";

export function useCategories(onError: (message: string) => void, onChanged?: () => Promise<void>) {
  const store = useCategoryStore();
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    try { store.setCategories(await service.listCategories()); }
    catch (error) { onError(error instanceof Error ? error.message : "读取类别失败"); }
    finally { store.setLoading(false); }
  }, [onError, store.setCategories, store.setLoading]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (busy.current) return false;
    busy.current = true;
    try {
      await action();
      await refresh();
      if (onChanged) await onChanged();
      return true;
    } catch (error) { onError(error instanceof Error ? error.message : "类别操作失败"); return false; }
    finally { busy.current = false; }
  }, [onChanged, onError, refresh]);

  return {
    categories: store.categories,
    loading: store.loading,
    refresh,
    create: (name: string, color: string) => run(() => service.createCategory(name, color)),
    update: (id: number, name: string, color: string) => run(() => service.updateCategory(id, name, color)),
    move: (id: number, direction: -1 | 1) => run(() => service.moveCategory(id, direction)),
    remove: (id: number, strategy: CategoryDeleteStrategy) => run(() => service.deleteCategory(id, strategy)),
    countNotes: service.countNotesInCategory
  };
}
