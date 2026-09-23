import { useCallback, useEffect, useMemo, useState } from "react";
import type { Database, FollowUpRecord, VisitInput } from "../types";
import {
  addSchedule,
  confirmVersion,
  deleteRecord,
  upsertVisit,
  type UpsertResult,
} from "../domain/rules";
import {
  clearDatabase,
  emptyDatabase,
  loadDatabase,
  parseDatabase,
  saveDatabase,
  seedDatabase,
  serializeDatabase,
} from "../domain/storage";

// 数据层：React 状态与 localStorage 之间的唯一桥梁；判定逻辑不放在这里

export function useStore() {
  const [db, setDb] = useState<Database>(() => {
    // 首次打开（无数据）时放入示例；之后可用「清空 / 导出 / 导入」管理
    const existing = loadDatabase();
    if (existing.records.length === 0) {
      const seededDb = seedDatabase();
      saveDatabase(seededDb);
      return seededDb;
    }
    return existing;
  });

  // 任何变更都落盘：记录、设备占用、版本链刷新后依然存在
  useEffect(() => {
    saveDatabase(db);
  }, [db]);

  const saveVisit = useCallback(
    (input: VisitInput, reason: string): UpsertResult["outcome"] => {
      let outcome: UpsertResult["outcome"] = { type: "unchanged" };
      setDb((prev) => {
        const result = upsertVisit(prev.records, input, reason);
        outcome = result.outcome;
        return { ...prev, records: result.records };
      });
      return outcome;
    },
    []
  );

  const confirm = useCallback(
    (recordId: string, operator: string, isSpecialist: boolean) => {
      setDb((prev) => ({
        ...prev,
        records: confirmVersion(prev.records, recordId, operator, isSpecialist),
      }));
    },
    []
  );

  const schedule = useCallback(
    (
      recordId: string,
      slotDate: string,
      slot: string,
      operator: string
    ) => {
      setDb((prev) => ({
        ...prev,
        records: addSchedule(prev.records, recordId, slotDate, slot, operator),
      }));
    },
    []
  );

  const remove = useCallback((recordId: string) => {
    setDb((prev) => ({
      ...prev,
      records: deleteRecord(prev.records, recordId),
    }));
  }, []);

  const replaceAll = useCallback((records: FollowUpRecord[]) => {
    setDb({ version: 1, records });
  }, []);

  const loadSeeds = useCallback(() => {
    setDb(seedDatabase());
  }, []);

  const clearAll = useCallback(() => {
    clearDatabase();
    setDb(emptyDatabase());
  }, []);

  const exportText = useCallback(() => serializeDatabase(db), [db]);

  const importText = useCallback((text: string) => {
    const parsed = parseDatabase(text);
    setDb(parsed);
  }, []);

  return useMemo(
    () => ({
      records: db.records,
      saveVisit,
      confirm,
      schedule,
      remove,
      replaceAll,
      loadSeeds,
      clearAll,
      exportText,
      importText,
    }),
    [
      db.records,
      saveVisit,
      confirm,
      schedule,
      remove,
      replaceAll,
      loadSeeds,
      clearAll,
      exportText,
      importText,
    ]
  );
}

export type Store = ReturnType<typeof useStore>;
